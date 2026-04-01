// ElevenLabs: Lily voice (pFZP5JQG7iQjIQuC4Bku) — redeploy trigger
// Env vars provided by Railway (locally, use .env with dotenv)
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const RSSParser = require('rss-parser');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

// Internal base URL for self-calls (scanner â autosignal, autosignal â adr-asr)
function getInternalUrl(req) {
  if (req) return `${req.protocol}://${req.get('host')}`;
  return process.env.BACKEND_URL || `http://localhost:${PORT}`;
}
const FRED_KEY = process.env.FRED_API_KEY;

// ââ HEALTH ROUTES (before any middleware) âââââââââââââââââââââââââââââââââââââ
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'axiom-backend' });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    ts: new Date().toISOString(),
    fredEnabled: !!FRED_KEY,
    aiEnabled: !!process.env.ANTHROPIC_KEY,
  });
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const rss = new RSSParser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  customFields: { item: ['media:content', 'media:thumbnail'] },
});

// ââ KEYWORD AUTO-TAGGING âââââââââââââââââââââââââââââââââââââââââââââââââââââââ
function autoTag(text) {
  const t = text.toLowerCase();
  if (/\b(fed|fomc|rate cut|rate hike|inflation|cpi|pce|unemployment|gdp|recession|monetary policy|fiscal|powell|basis point|soft landing|stagflation)\b/.test(t)) return 'MACRO';
  if (/\b(treasury|yield curve|10y|2y|t-bill|t-note|bond yield|duration|spread|bund|gilt)\b/.test(t)) return 'RATES';
  if (/\b(option|put|call|\bvix\b|volatility|gamma|theta|expiry|implied vol|skew|hedge|derivatives)\b/.test(t)) return 'OPTIONS';
  if (/\b(nasdaq|dow jones|s&p 500|earnings|upgrade|downgrade|buyback|dividend|ipo|equity|shares|short)\b/.test(t)) return 'EQUITY';
  if (/\b(tech|artificial intelligence|\bai\b|semiconductor|nvidia|apple|google|microsoft|meta|amazon|chip|silicon|openai|llm)\b/.test(t)) return 'TECH';
  if (/\b(oil|gold|silver|copper|commodity|crude|brent|wti|energy|natural gas|wheat|corn|lithium|metal)\b/.test(t)) return 'CMDTY';
  if (/\b(china|europe|ecb|boj|japan|yuan|yen|euro|emerging market|imf|world bank|geopolit|russia|ukraine|taiwan)\b/.test(t)) return 'INTL';
  return 'MACRO';
}

function impactLevel(text) {
  const t = text.toLowerCase();
  if (/\b(fed|fomc|cpi|gdp|recession|crash|crisis|rate hike|rate cut|emergency|collapse|default|systemic|meltdown)\b/.test(t)) return 'high';
  if (/\b(earnings|upgrade|downgrade|merger|acquisition|guidance|layoff|bankruptcy|restructure)\b/.test(t)) return 'medium';
  return 'low';
}

// ââ RSS FEEDS âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const RSS_FEEDS = [
  { url: 'https://feeds.reuters.com/reuters/businessNews', source: 'RTR' },
  { url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', source: 'CNBC' },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', source: 'MW' },
  { url: 'https://finance.yahoo.com/news/rssindex', source: 'YF' },
];

// ââ /api/news âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.get('/api/news', async (req, res) => {
  try {
    const settled = await Promise.allSettled(
      RSS_FEEDS.map(f =>
        rss.parseURL(f.url).then(feed => ({ feed, source: f.source }))
      )
    );

    const items = [];
    for (const r of settled) {
      if (r.status !== 'fulfilled') {
        console.warn(`RSS feed failed: ${r.reason?.message}`);
        continue;
      }
      const { feed, source } = r.value;
      for (const item of (feed.items || []).slice(0, 10)) {
        const title = item.title?.trim();
        if (!title) continue;
        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
        const ny = new Date(pubDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const h = ny.getHours().toString().padStart(2, '0');
        const m = ny.getMinutes().toString().padStart(2, '0');
        const combined = `${title} ${item.contentSnippet || ''}`;
        items.push({
          time: `${h}:${m}`,
          source,
          headline: title,
          link: item.link || '',
          tag: autoTag(combined),
          impact: impactLevel(title),
          pubDate: pubDate.toISOString(),
        });
      }
    }

    items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    const unique = items.filter((item, idx) =>
      items.findIndex(x => x.headline === item.headline) === idx
    );

    res.json({ success: true, data: unique.slice(0, 25), count: Math.min(unique.length, 25) });
  } catch (err) {
    console.error('News error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ââ dxFeed REAL-TIME via dxLink WebSocket ââââââââââââââââââââââââââââââââââââ
const WebSocket = require('ws');
const dxCache = {}; // { ES: { price, ts }, NQ: { price, ts }, GC: { price, ts }, CL: { price, ts } }
const DX_SYMBOL_MAP = { '/ES:XCME': 'ES', '/NQ:XCME': 'NQ', '/GC:XCEC': 'GC', '/CL:XNYM': 'CL' };
const DX_SUBSCRIBE_SYMBOLS = Object.keys(DX_SYMBOL_MAP);

function connectDxFeed() {
  const url = process.env.DXFEED_URL;
  if (!url) { console.warn('dxFeed: DXFEED_URL not set, skipping WebSocket'); return; }
  let ws;
  let keepaliveTimer;
  let firstPriceLogged = false;

  function open() {
    ws = new WebSocket(url);
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'SETUP', channel: 0, keepaliveTimeout: 60, acceptKeepaliveTimeout: 60, version: '0.1' }));
    });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'SETUP') {
        const token = process.env.DXFEED_TOKEN || ((process.env.DXFEED_USERNAME || '') + ':' + (process.env.DXFEED_PASSWORD || ''));
        ws.send(JSON.stringify({ type: 'AUTH', channel: 0, token }));
      } else if (msg.type === 'AUTH_STATE' && msg.state === 'AUTHORIZED') {
        console.log('dxFeed connected â');
        ws.send(JSON.stringify({ type: 'CHANNEL_REQUEST', channel: 1, service: 'FEED', parameters: { contract: 'AUTO' } }));
        // Start keepalive ping every 30s
        clearInterval(keepaliveTimer);
        keepaliveTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KEEPALIVE', channel: 0 }));
        }, 30000);
      } else if (msg.type === 'CHANNEL_OPENED' && msg.channel === 1) {
        ws.send(JSON.stringify({
          type: 'FEED_SUBSCRIPTION', channel: 1,
          add: DX_SUBSCRIBE_SYMBOLS.map(s => ({ type: 'Quote', symbol: s })),
        }));
      } else if (msg.type === 'FEED_DATA' && msg.channel === 1) {
        parseFeedData(msg.data, firstPriceLogged);
        if (!firstPriceLogged && Object.keys(dxCache).length > 0) {
          firstPriceLogged = true;
          for (const [sym, v] of Object.entries(dxCache)) {
            console.log(`dxFeed LIVE: ${sym} ${v.price.toFixed(2)}`);
          }
        }
      }
    });
    ws.on('close', () => {
      clearInterval(keepaliveTimer);
      console.warn('dxFeed disconnected, reconnecting in 5sâ¦');
      setTimeout(open, 5000);
    });
    ws.on('error', (err) => {
      console.error('dxFeed error:', err.message);
      ws.close();
    });
  }
  open();
}

function parseFeedData(data) {
  if (!Array.isArray(data)) return;
  // dxLink FEED_DATA format: ["Quote", [fields...], [values...], [values...], ...]
  // The first element after type is the field names array, followed by value arrays
  let i = 0;
  while (i < data.length) {
    if (data[i] === 'Quote') {
      i++; // move to fields or first value array
      // Collect all value arrays that follow until next type string or end
      while (i < data.length && Array.isArray(data[i])) {
        const arr = data[i];
        // arr format: [eventSymbol, eventTime, sequence, timeNanoPart, bidTime, bidExchangeCode, bidPrice, bidSize, askTime, askExchangeCode, askPrice, askSize]
        // We need: arr[0]=symbol, arr[6]=bidPrice, arr[10]=askPrice
        const symbol = arr[0];
        const bid = arr[6];
        const ask = arr[10];
        const mapped = DX_SYMBOL_MAP[symbol];
        if (mapped && typeof bid === 'number' && typeof ask === 'number' && bid > 0 && ask > 0) {
          dxCache[mapped] = { price: +((bid + ask) / 2).toFixed(2), ts: Date.now() };
        }
        i++;
      }
    } else {
      i++;
    }
  }
}

// Start dxFeed connection on server boot
connectDxFeed();

async function getLivePrice(symbol, yahooFallbackSymbol) {
  // Check dxFeed cache first (valid if < 30s old)
  const cached = dxCache[symbol];
  if (cached && (Date.now() - cached.ts) < 30000) {
    return { price: cached.price, source: 'dxfeed' };
  }
  // Fallback to Yahoo
  const yq = await yahooQuote(yahooFallbackSymbol || symbol);
  return { price: yq.price, source: 'yahoo', chg: yq.chg, pct: yq.pct, prev: yq.prev, high: yq.high, low: yq.low };
}

// ââ YAHOO FINANCE HELPER ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function yahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!r.ok) throw new Error(`Yahoo ${symbol} HTTP ${r.status}`);
  const data = await r.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta || !meta.regularMarketPrice) throw new Error(`No price data for ${symbol}`);
  const price = meta.regularMarketPrice;
  const prev = meta.previousClose || meta.chartPreviousClose || price;
  const chg = price - prev;
  const pct = prev !== 0 ? (chg / prev) * 100 : 0;
  return {
    price: +price.toFixed(2),
    chg: +chg.toFixed(2),
    pct: +pct.toFixed(2),
    prev: +prev.toFixed(2),
    high: meta.regularMarketDayHigh || null,
    low: meta.regularMarketDayLow || null,
  };
}

// ââ /api/market â VIX, ES, NQ + ETFs (SPY/QQQ/IWM/GLD/TLT) ââââââââââââââââââ
const ETF_SYMBOLS = [
  { sym: 'SPY', name: 'S&P 500 ETF',        yahoo: 'SPY'  },
  { sym: 'QQQ', name: 'Nasdaq 100 ETF',     yahoo: 'QQQ'  },
  { sym: 'IWM', name: 'Russell 2000 ETF',   yahoo: 'IWM'  },
  { sym: 'GLD', name: 'Gold ETF',           yahoo: 'GLD'  },
  { sym: 'TLT', name: '20Y Treasury ETF',   yahoo: 'TLT'  },
];

app.get('/api/market', async (req, res) => {
  try {
    // Futures + VIX via Yahoo
    const [vixR, esR, nqR, gcR, clR, ...etfResults] = await Promise.allSettled([
      yahooQuote('^VIX'),
      getLivePrice('ES', 'ES=F'),
      getLivePrice('NQ', 'NQ=F'),
      getLivePrice('GC', 'GC=F'),
      getLivePrice('CL', 'CL=F'),
      ...ETF_SYMBOLS.map(e => yahooQuote(e.yahoo)),
    ]);

    const etfs = ETF_SYMBOLS.map((meta, i) => ({
      sym:  meta.sym,
      name: meta.name,
      ...(etfResults[i].status === 'fulfilled'
        ? etfResults[i].value
        : { price: 0, chg: 0, pct: 0, prev: 0 }),
    }));

    const makeFutures = (sym, result) => {
      if (result.status !== 'fulfilled') return null;
      const v = result.value;
      return { symbol: sym, price: v.price, source: v.source || 'yahoo', delayMin: v.delayMin || null, chg: v.chg || 0, pct: v.pct || 0, prev: v.prev || 0, high: v.high || null, low: v.low || null };
    };

    const data = {
      vix:  vixR.status === 'fulfilled' ? { symbol: 'VIX', ...vixR.value, source: 'yahoo' } : null,
      es:   makeFutures('ES', esR),
      nq:   makeFutures('NQ', nqR),
      gc:   makeFutures('GC', gcR),
      cl:   makeFutures('CL', clR),
      etfs,
    };

    if (!data.vix && !data.es && !data.nq && etfs.every(e => e.price === 0)) {
      throw new Error('All market data sources failed');
    }

    if (vixR.status === 'rejected') console.warn('VIX failed:', vixR.reason?.message);
    if (esR.status  === 'rejected') console.warn('ES failed:',  esR.reason?.message);
    if (nqR.status  === 'rejected') console.warn('NQ failed:',  nqR.reason?.message);
    if (gcR.status  === 'rejected') console.warn('GC failed:',  gcR.reason?.message);
    if (clR.status  === 'rejected') console.warn('CL failed:',  clR.reason?.message);

    res.json({ success: true, data, ts: new Date().toISOString() });
  } catch (err) {
    console.error('Market error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ââ /api/futures (legacy endpoint â kept for compatibility) âââââââââââââââââââ
app.get('/api/futures', async (req, res) => {
  try {
    const [esR, nqR] = await Promise.allSettled([
      yahooQuote('ES=F'),
      yahooQuote('NQ=F'),
    ]);
    const results = {};
    if (esR.status === 'fulfilled') results.ES = { symbol: 'ES', ...esR.value };
    if (nqR.status === 'fulfilled') results.NQ = { symbol: 'NQ', ...nqR.value };
    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Futures error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ââ FRED HELPER âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function fredSeries(seriesId) {
  if (!FRED_KEY) return null;
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&limit=3&sort_order=desc&api_key=${FRED_KEY}&file_type=json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`FRED ${seriesId} HTTP ${r.status}`);
  const d = await r.json();
  const obs = (d.observations || []).filter(o => o.value !== '.' && o.value !== '');
  if (obs.length === 0) throw new Error(`No FRED data for ${seriesId}`);
  return obs;
}

// ââ /api/macro â Full economic indicators ââââââââââââââââââââââââââââââââââââ
// Helper: fetch FRED series and format as macro object
async function fredMacro(seriesId, name, fmt) {
  const obs = await fredSeries(seriesId);
  if (!obs) return null;
  const cur = parseFloat(obs[0].value);
  const prev = obs[1] ? parseFloat(obs[1].value) : cur;
  const value = fmt ? fmt(cur) : `${cur.toFixed(2)}%`;
  const prevStr = fmt ? fmt(prev) : `${prev.toFixed(2)}%`;
  return {
    value, prev: prevStr,
    trend: cur > prev + 0.01 ? 'up' : cur < prev - 0.01 ? 'down' : 'neutral',
    next: 'Live', live: true,
  };
}

// Helper: fetch Yahoo Finance rate (for treasury yields â no API key needed)
async function yahooMacro(symbol) {
  const q = await yahooQuote(symbol);
  return {
    value: `${q.price.toFixed(2)}%`,
    prev: `${q.prev.toFixed(2)}%`,
    trend: q.chg > 0.01 ? 'up' : q.chg < -0.01 ? 'down' : 'neutral',
    next: 'Live', live: true,
  };
}

app.get('/api/macro', async (req, res) => {
  try {
    const macro = {};

    // All fetches in parallel â each wrapped in try/catch so one failure doesn't kill the rest
    const jobs = [
      // 10Y Treasury â Yahoo (^TNX) primary, FRED (DGS10) fallback
      (async () => {
        try { macro['10Y Treasury'] = await yahooMacro('^TNX'); }
        catch { try { const m = await fredMacro('DGS10', '10Y'); if (m) macro['10Y Treasury'] = m; } catch (e) { console.warn('10Y failed:', e.message); } }
      })(),
      // 2Y Treasury â FRED (DGS2) primary, Yahoo (^TYX is 30Y so skip)
      (async () => {
        try { const m = await fredMacro('DGS2'); if (m) macro['2Y Treasury'] = m; }
        catch (e) { console.warn('2Y failed:', e.message); }
      })(),
      // Fed Funds Rate â FRED (FEDFUNDS)
      (async () => {
        try { const m = await fredMacro('FEDFUNDS'); if (m) macro['Fed Funds Rate'] = m; }
        catch (e) { console.warn('Fed Funds failed:', e.message); }
      })(),
      // CPI YoY â FRED (CPIAUCSL) â value is index, need YoY calc
      (async () => {
        try {
          const obs = await fredSeries('CPIAUCSL');
          if (obs && obs.length >= 2) {
            // FRED returns latest observations; for YoY we'd need 12-month lag
            // Use the latest value and show as index for now
            const cur = parseFloat(obs[0].value);
            const prev = parseFloat(obs[1].value);
            const yoy = ((cur - prev) / prev * 100);
            macro['CPI YoY'] = {
              value: `${yoy.toFixed(1)}%`, prev: `${((prev - parseFloat((obs[2] || obs[1]).value)) / parseFloat((obs[2] || obs[1]).value) * 100).toFixed(1)}%`,
              trend: yoy > 3 ? 'up' : yoy < 2 ? 'down' : 'neutral',
              next: 'Live', live: true,
            };
          }
        } catch (e) { console.warn('CPI failed:', e.message); }
      })(),
      // Core PCE â FRED (PCEPILFE)
      (async () => {
        try {
          const obs = await fredSeries('PCEPILFE');
          if (obs && obs.length >= 2) {
            const cur = parseFloat(obs[0].value);
            const prev = parseFloat(obs[1].value);
            const chg = ((cur - prev) / prev * 100);
            macro['Core PCE'] = {
              value: `${chg.toFixed(1)}%`, prev: `${prev.toFixed(1)}`,
              trend: chg > 0.3 ? 'up' : chg < 0 ? 'down' : 'neutral',
              next: 'Live', live: true,
            };
          }
        } catch (e) { console.warn('Core PCE failed:', e.message); }
      })(),
      // Unemployment â FRED (UNRATE)
      (async () => {
        try { const m = await fredMacro('UNRATE'); if (m) macro['Unemployment'] = m; }
        catch (e) { console.warn('Unemployment failed:', e.message); }
      })(),
      // GDP Growth â FRED (A191RL1Q225SBEA = Real GDP % change)
      (async () => {
        try {
          const m = await fredMacro('A191RL1Q225SBEA', 'GDP', v => `${v.toFixed(1)}%`);
          if (m) macro['GDP Growth (Q4)'] = m;
        } catch (e) { console.warn('GDP failed:', e.message); }
      })(),
      // ISM Manufacturing â try multiple FRED series (NAPM discontinued, try alternatives)
      (async () => {
        const seriesIds = ['NAPM', 'MANEMP', 'AMTMNO'];
        for (const sid of seriesIds) {
          try {
            const fmt = sid === 'MANEMP' ? (v => `${(v/1000).toFixed(0)}K`) : (v => v.toFixed(1));
            const m = await fredMacro(sid, 'ISM', fmt);
            if (m) { macro['ISM Manuf.'] = m; return; }
          } catch {}
        }
        // All failed â show N/A gracefully
        macro['ISM Manuf.'] = { value: 'N/A', prev: 'N/A', trend: 'neutral', next: 'â', live: false };
      })(),
    ];

    await Promise.allSettled(jobs);

    res.json({ success: true, data: macro, fredEnabled: !!FRED_KEY, ts: new Date().toISOString() });
  } catch (err) {
    console.error('Macro error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ââ /api/ai â Claude streaming proxy âââââââââââââââââââââââââââââââââââââââââ
// Keeps the Anthropic key server-side; streams SSE back to the browser.
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
function todayDateStr() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
const DEFAULT_SYSTEM = "You are a senior macro strategist and options trader at a top hedge fund. Provide sharp, data-driven market commentary in Bloomberg terminal style. Use specific numbers. Format with ALL CAPS headers. Under 300 words.";

app.post('/api/ai', async (req, res) => {
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY not set in backend .env' });
  }

  const { prompt, systemPrompt, maxTokens = 1000 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  // SSE headers â forward the raw Anthropic stream to the browser
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        stream: true,
        system: `Today's date is ${todayDateStr()}. All analysis must be based on current conditions as of this date.\n\n${systemPrompt || DEFAULT_SYSTEM}`,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Anthropic error:', aiRes.status, errText);
      res.write(`data: {"type":"error","message":"Anthropic ${aiRes.status}"}\n\n`);
      return res.end();
    }

    // node-fetch v2: response.body is a Node.js Readable stream â pipe it straight through
    aiRes.body.on('data', chunk => res.write(chunk));
    aiRes.body.on('end', () => res.end());
    aiRes.body.on('error', err => { console.error('AI stream error:', err); res.end(); });
    req.on('close', () => aiRes.body.destroy());
  } catch (err) {
    console.error('AI endpoint error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

// ââ /api/signals â Axiom Edge AI Signal Analyser âââââââââââââââââââââââââââââ
// Shared system prompt for both /api/signals and /api/autosignal
const AXIOM_EDGE_SYSTEM = `You are the Axiom Edge signal engine. You evaluate market conditions against 4 specific playbooks in strict order. Each playbook has completely separate criteria, targets, and session rules. NEVER mix criteria between playbooks. Respond ONLY with valid JSON â no markdown, no code fences, no extra text.

TRADER PROFILE:
- Instruments: ES, NQ, DAX, Gold (XAU), Oil (CL)
- Value Area: TPO-based (Market Profile time letters)
- ADR: 20-day True Range average
- 1R = 14-period ATR on D1
- IB windows: ES/NQ = 9:30\u201310:30am ET | DAX = 9:00\u201310:00am CET | Gold = 8:20\u20139:20am ET | Oil = 9:00\u201310:00am ET
- Active sessions: NY DRF 10:00am ET \u00b7 NY Close 4:00pm ET
- Phase 1 (bullish trigger): Bullish engulf OR consolidation breaking above swing high on M15/M30/H4
- Phase 3 (bearish trigger): 3-bar reversal pattern on M15/M30/H4
- Consolidation entries require minimum 4 candles within the range (Rule of Fours). Fewer than 4 candles = not a valid consolidation.
- Trader experience: SEASONED (uses D1 QP levels)

D1/H4 QP LEVELS \u2014 MARKET STALKERS SWING QUARTILES:
These are NOT quarterly pivot points. They are swing-based quartile levels derived from the most recent confirmed swing high/low where price has retraced 50% (the trigger).
- d1SwingHigh / h4SwingHigh = 100% \u2014 top of confirmed swing range
- d1QHi / h4QHi = 75th percentile \u2014 Q Point High
- d1QP / h4QP = 50th percentile \u2014 Middle Trigger (the 50% retracement that activates Q Points)
- d1QMid / h4QMid = 25th percentile \u2014 Q Point Low
- d1QLo / h4QLo = 0% \u2014 Swing Low (bottom of confirmed swing range)
Trend UP confirmed: price above QP (50%) + QMid (25%) \u2014 upper half of swing range
Trend DOWN confirmed: price below QP (50%) + QMid (25%) \u2014 lower half of swing range
At QHi in uptrend \u2192 price at 75% of swing = extended, route to PB3
At QLo in downtrend \u2192 price at 0% of swing = extended, route to PB3

CONTERMINOUS CHECK \u2014 PRE-CALCULATED:
The backend has already mathematically verified whether H4 supply/demand zones align with VAH/VAL within per-instrument tick tolerance. Use these boolean flags directly \u2014 do NOT re-evaluate conterminous alignment yourself:
- h4_supply_conterminous: true/false \u2014 H4 supply zone is conterminous with VAL (within tolerance)
- h4_demand_conterminous: true/false \u2014 H4 demand zone is conterminous with VAH (within tolerance)
- h4_supply_distance_from_val: exact point distance from VAL
- h4_demand_distance_from_vah: exact point distance from VAH
- conterminous_tolerance: instrument-specific tolerance in points
When prompt says "pre-validated mathematically", trust these flags as ground truth.

C-LINE QUALITY: C-lines must come from reversal formation zones (DBR demand or RBD supply). Continuation formations (DBD/RBR) are weaker \u2014 treat a weak c-line (from continuation formation) as no c-line \u2192 NO TRADE.

H4 ZONE DATA \u2014 AUTO-DETECTED:
- h4_supply_nearest: nearest supply zone level above current price
- h4_demand_nearest: nearest demand zone level below current price
- h4_supply_zones: array of all detected supply zones [{level, low, high, strength}]
- h4_demand_zones: array of all detected demand zones [{level, low, high, strength}]
Use h4_supply_nearest and h4_demand_nearest as the reference levels for conterminous checks and entry zone targeting.

STEP 0 \u2014 ADR EXHAUSTION CHECK (before any playbook evaluation):
Check if ADR is exhausted: has price moved \u2265100% of ADR from the daily open in one direction?
- If YES \u2192 skip PB1 and PB2 entirely, go directly to PB3 (countertrend ADR exhaustion).
- If NO \u2192 continue to Step 1.

STEP 1 \u2014 DETERMINE IB STATUS
Check current ET time against instrument IB window:
- BEFORE IB window opens \u2192 ib_status: "not_started"
- DURING IB window \u2192 ib_status: "forming" (show current H/L so far)
- AFTER IB window closes \u2192 ib_status: "set" (use confirmed H/L)

STEP 2 \u2014 EVALUATE PLAYBOOKS IN THIS EXACT ORDER

PLAYBOOK #2 \u2014 WITH THE TREND \u2014 RETURN TO VAH/VAL
IB REQUIREMENT: NONE \u2014 PB2 can fire from the open, even before IB forms.
SESSION: Must be within a DTTZ window \u2014 London Open (07:00\u201309:00 GMT), NY Open (13:00\u201315:00 GMT), or NY Cut/DRF (15:00\u201316:00 GMT). Entry outside these windows \u2192 NO TRADE.
NOTE: PB2 fires BEFORE checking PB1. Evaluate it first, always.

PB2 UPTREND path (Open Above VAH):
1. Trend UP confirmed (price above D1 QP + QMid \u2014 upper half of swing range)
2. Value Area Open = ABOVE VAH
3. H4 or D1 QP level \u2014 ONLY qualifies if price RECENTLY REJECTED QLo (within last 3\u20135 sessions). QMid and QHi do NOT qualify for PB2 \u2014 route to PB3 instead. If at QLo without recent rejection \u2192 NO TRADE on PB2.
4. D1/H4 Conterminous Demand Line ABOVE or AT VAH (use h4_demand_conterminous flag \u2014 must be true)
5. M30 bull engulf OR consolidation at/around demand line or VAH
6. In DTTZ window (London Open 07:00\u201309:00 GMT, NY Open 13:00\u201315:00 GMT, or NY Cut/DRF 15:00\u201316:00 GMT)
7. Profit margin: 2\u20133x up to ADR exhaustion or first supply
\u2192 SIGNAL: LONG \u2014 INTRADAY TRADE 2R
\u2192 If not in DTTZ: NO TRADE (session gate). If h4_demand_conterminous is false: NO TRADE. If no M30 pattern: NO TRADE (wait).

PB2 DOWNTREND path (Open Below VAL):
1. Trend DOWN confirmed (price below D1 QP + QMid \u2014 lower half of swing range)
2. Value Area Open = BELOW VAL
3. ONLY qualifies if price RECENTLY REJECTED QHi (within last 3\u20135 sessions). QMid and QLo do NOT qualify.
4. D1/H4 Conterminous Supply Line BELOW or AT VAL (use h4_supply_conterminous flag \u2014 must be true)
5. M30 bear engulf OR consolidation at/around supply line or VAL
6. In DTTZ window
7. Profit margin: 3\u20135x down to ADR exhaustion or first demand
\u2192 SIGNAL: SHORT \u2014 INTRADAY TRADE 2\u20133R

PLAYBOOK #1 \u2014 WITH THE TREND \u2014 IB EXTENSION
SESSION: NO session gate for PB1 \u2014 can trade outside DRF/Close windows.

PB1 has three paths based on VA Open:
- ABOVE VA: Look for sustained auction upside \u2192 check conterminous demand \u2192 M30 engulf. IB NOT required.
- INSIDE VA: Look for rejection of value \u2192 check IB extension \u2192 M30 engulf. IB REQUIRED \u2014 must be set.
- BELOW VA: Look for failed auction downside \u2192 check conterminous demand \u2192 M30 engulf. IB NOT required.

If ib_status = "forming" or "not_started" AND VA Open is INSIDE VA \u2192 Report: "PB1 PENDING \u2014 IB not yet confirmed. Re-evaluate after [IB close time] ET." ABOVE VA and BELOW VA paths can still be evaluated.

PB1-A: MAIN IB EXTENSION PATH (INSIDE VA path \u2014 requires IB)
1. Trend confirmed via D1 QP levels:
   - At D1 QHi (trend up) \u2192 route to PB3 (not PB1)
   - At D1 QMid or QLo \u2192 continue PB1 evaluation
   - Trend UP: price above D1 QP + QMid. Trend DOWN: price below D1 QP + QMid
2. ADR NOT exhausted in trend direction (if exhausted \u2192 NO TRADE on PB1-A, check PB3)
3. Rejection of VA in trend direction
4. IB extended in trend direction (confirmed, IB set)
5. H4 Conterminous Supply (downtrend) or Demand (uptrend) at/above VAL or VAH \u2014 use h4_supply_conterminous or h4_demand_conterminous flag (must be true). Reference h4_supply_nearest / h4_demand_nearest for exact level.
6. M30 bear engulf/consolidation (short) or bull engulf/consolidation (long) at conterminous level
7. Profit margin: 3\u20135x to ADR exhaustion or first opposing S/D
\u2192 SIGNAL: LONG or SHORT \u2014 INTRADAY TRADE 2R

PB1-B: EARLY VA ROTATION PATH (separate criteria, different target)
- Triggers when VA rotation rule applies (early M30 acceptance of VA)
- Does NOT need IB extension
- Profit margin: 3\u20135x to ADR exhaustion / first supply/demand
\u2192 SIGNAL: LONG or SHORT \u2014 INTRADAY TRADE MAX 2\u20133R (lower target than PB1-A)
Report PB1-A as "PB1 Main Path" and PB1-B as "PB1 Early VA Rotation Path" separately. If both qualify, prefer PB1-A.

PLAYBOOK #3 \u2014 COUNTERTREND \u2014 ADR EXHAUSTION
IB REQUIREMENT: PARTIAL \u2014 path-specific (see below).
SESSION: CT intraday trades MUST close at end of session (hard rule).

PB3 3/3 TREND ROUTING (check before paths):
- 3/3 aligned (H4+D1+W1 same direction) AND D1 engulf present \u2192 trend is REVERSING \u2192 route to PB1 (treat as with-trend in new direction)
- 3/3 aligned AND no D1 engulf \u2192 NO TRADE (trend reversing but no confirmation)
- NOT 3/3 aligned \u2192 continue PB3 countertrend evaluation below

PB3 PATH A: VA REJECTION (no IB required)
1. ADR exhausted in countertrend direction (CT Long = ADR exhausted UPSIDE, CT Short = ADR exhausted DOWNSIDE)
2. NOT 3/3 aligned (confirmed above \u2014 otherwise would have routed to PB1)
3. D1 engulf in CT direction (if no D1 engulf \u2192 route to PB4, not NO TRADE)
4. VA rejection in CT direction
5. Phase 1 (CT long) or Phase 3 (CT short) on M15/M30/H4
6. Profit margin: 3\u20135x to Value or H4 conterminous S/D (use h4_supply_nearest / h4_demand_nearest)
\u2192 SIGNAL: CT LONG 2R MAX or CT SHORT 2\u20133R. MANDATORY: "Close at end of session"

PB3 PATH B: IB EXTENSION (IB must be set)
- CT Long: IB extended DOWNSIDE + buying tail. CT Short: IB extended UPSIDE + selling tail.
- Then same Phase 1/3 trigger + profit margin check
\u2192 Same targets. If no buying/selling tail \u2192 NO TRADE on PB3, check PB4.

PB3 \u2192 PB4 WATERFALL: 3/3 trend NOT confirmed \u2192 skip to PB4. No D1 engulf \u2192 go to PB4. Both paths fail \u2192 go to PB4. NEVER return NO TRADE from PB3 failure alone \u2014 always check PB4 first.

PLAYBOOK #4 \u2014 COUNTERTREND \u2014 SWING/INTRADAY DECISION
IB REQUIREMENT: PATH-SPECIFIC. Intraday closes at end of session. Swing can hold overnight.
ARRIVES HERE: When PB3 conditions not met, or routed from PB3 waterfall.

ENTRY GATE: Trend DOWN \u2192 must have RECENTLY REJECTED D1 QLo (swing low, 0% level). If no rejection \u2192 go to PB1, not PB4. Trend UP \u2192 must have RECENTLY REJECTED D1 QHi (75% level).

PB4 PATH A: SWING (IB not required)
1. D1 QLo rejection (CT long) or QHi rejection (CT short)
2. ADR exhausted in CT direction
3. IB extension UP or NONE (CT long) / DOWN or NONE (CT short) \u2192 check D1 engulf
4. Recent D1 bullish engulf c-line (CT long) or bearish (CT short)
5. Profit margin: 3\u20135x to ADR/ASR or first S/D (use h4_supply_nearest / h4_demand_nearest)
\u2192 SIGNAL: CT SWING LONG or SHORT \u2014 3\u20135R. Can hold overnight.

PB4 PATH B: INTRADAY (IB must be set)
- IB extended DOWN + buying tail (CT long) or UP + selling tail (CT short)
- Bull/bear engulf on M15/M30 with TPO close BACK TO IB
- Profit margin: 3\u20135x to opposing IB edge / ADR\u2013ASR / H4 S/D
\u2192 SIGNAL: CT INTRADAY \u2014 2\u20133R. MANDATORY: "Close at end of session"

PB4 PATH C: VAH/VAL RETURN
- Price returned to VAH (CT long) or VAL (CT short)
- Bull/bear engulf on D1/H4/M30 at VAH/VAL or D1 c-dem/c-sup
\u2192 SIGNAL: CT INTRADAY \u2014 2\u20133R. MANDATORY: "Close at end of session"

PROFIT TAKING (applies to all playbooks):
- At 1R \u2192 move stop to breakeven
- At 2R \u2192 take 50\u201375% partial profit (PB3: close full position at 2R)
- Hard ceiling: close at ADR or ASR exhaustion level regardless of R-multiple
- Trail stop to new M30 swing structure after 2R

SECOND CHANCE ENTRY:
If initial entry was missed, a pullback to the entry zone with a new M15/M30 engulf or consolidation is valid \u2014 provided all original conditions (c-line, QP, VA open, profit margin) still hold. Flag as "second chance" in criteria.

CRITICAL RULES \u2014 NEVER VIOLATE:
1. NEVER mix PB1 and PB2 criteria in the same checklist
2. NEVER apply the session gate to PB1 \u2014 PB1 has NO session requirement
3. ALWAYS apply the session gate to PB2
4. NEVER return NO TRADE from PB3 failure \u2014 always waterfall to PB4
5. ALWAYS separate PB1-A (main IB path) from PB1-B (early VA rotation)
6. PB1-A target is 2R. PB1-B target is MAX 2\u20133R. NEVER confuse these.
7. PB3/PB4 intraday trades ALWAYS include "close at end of session" warning
8. PB4 swing trades do NOT have the session close rule
9. ADR direction in PB3: CT Long = ADR exhausted UPSIDE. CT Short = DOWNSIDE.
10. PB2: QMid does NOT qualify \u2014 only recently rejected QLo (uptrend) or QHi (downtrend)
11. Seasoned trader: D1 QHi in uptrend \u2192 routes to PB3 not PB1
12. IB pending message must include exact time IB confirms for the instrument
13. NEVER re-calculate conterminous alignment \u2014 use pre-calculated h4_supply_conterminous / h4_demand_conterminous boolean flags as ground truth
14. ALWAYS reference h4_supply_nearest and h4_demand_nearest for zone levels \u2014 do not estimate or guess H4 levels
15. ADR \u2265100% from daily open \u2192 skip PB1 and PB2, go directly to PB3 (Step 0)
16. PB2 session gate uses DTTZ windows (London Open, NY Open, NY Cut/DRF) \u2014 not the old DRF/Close gate
17. PB3 3/3 aligned + D1 engulf \u2192 route to PB1 (trend reversing). 3/3 + no engulf \u2192 NO TRADE
18. PB1 ABOVE/BELOW VA paths do NOT require IB. Only INSIDE VA requires IB set
19. Consolidation = minimum 4 candles in range (Rule of Fours). Fewer = invalid
20. C-lines from continuation formations (DBD/RBR) are weak \u2192 treat as no c-line

RESPONSE FORMAT:
{
  "playbooks_evaluated": ["PB2","PB1","PB3","PB4"],
  "playbook_selected": "PB2",
  "playbook_path": "PB2 Uptrend \u2014 Open Above VAH",
  "reason_selected": "<why this PB was chosen>",
  "signal": "LONG" or "SHORT" or "NO TRADE",
  "direction": "With Trend" or "Countertrend Intraday" or "Countertrend Swing" or "None",
  "target_r": "2R" or "2-3R" or "3-5R" or "None",
  "ib_status": "forming" or "set" or "not_started",
  "time_context": "<current ET time + what is evaluable>",
  "session_active": true/false,
  "session_name": "NY DRF" or "NY Close" or "None",
  "countertrend_close_rule": true/false,
  "stop": <number>,
  "target_1r": <number>,
  "target_2r": <number>,
  "target_3r": <number>,
  "conterminous_used": {
    "supply_conterminous": <true/false from pre-calc>,
    "demand_conterminous": <true/false from pre-calc>,
    "supply_level": <h4_supply_nearest>,
    "demand_level": <h4_demand_nearest>
  },
  "criteria": [{"playbook":"PB2","condition":"<text>","met":true/false,"note":"<detail>"}],
  "failed_playbooks": [{"playbook":"PB1","reason":"<why it failed or is pending>"}],
  "reasoning": "<2-3 sentence explanation>",
  "confidence": "High" or "Medium" or "Low",
  "warnings": ["<any warnings like missing M30 trigger, session gate, or IB pending>"]
}`;

app.post('/api/signals', async (req, res) => {
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY not set' });
  }

  const data = req.body;
  if (!data || !data.instrument || !data.currentPrice) {
    return res.status(400).json({ error: 'instrument and currentPrice are required' });
  }

  // Pre-compute conterminous if H4 levels and VA levels provided
  const inst = data.instrument || 'ES';
  let conterminousInfo = '';
  if (data.vah && data.val) {
    const vah = parseFloat(data.vah), val = parseFloat(data.val);
    // Check H4 QP levels against VA
    const h4Levels = [data.h4QP, data.h4QHi, data.h4QMid, data.h4QLo].filter(Boolean).map(Number);
    if (h4Levels.length > 0) {
      const nearVAH = h4Levels.reduce((best, l) => {
        const c = isConterminous(l, vah, inst);
        return (!best || c.distance < best.distance) ? { level: l, ...c } : best;
      }, null);
      const nearVAL = h4Levels.reduce((best, l) => {
        const c = isConterminous(l, val, inst);
        return (!best || c.distance < best.distance) ? { level: l, ...c } : best;
      }, null);
      conterminousInfo = `
CONTERMINOUS CHECK (pre-calculated, tolerance: ${nearVAH?.tolerance ?? 'N/A'} pts):
- Nearest H4 level to VAH: ${nearVAH ? `${nearVAH.level} (distance: ${nearVAH.distance} pts) â ${nearVAH.conterminous ? 'CONTERMINOUS' : 'NOT conterminous'}` : 'No H4 levels provided'}
- Nearest H4 level to VAL: ${nearVAL ? `${nearVAL.level} (distance: ${nearVAL.distance} pts) â ${nearVAL.conterminous ? 'CONTERMINOUS' : 'NOT conterminous'}` : 'No H4 levels provided'}
NOTE: Conterminous values are pre-validated. Use directly.`;
    }
  }

  const userPrompt = `Analyse this market setup and determine the correct Axiom Edge playbook signal:

INSTRUMENT: ${inst}
CURRENT PRICE: ${data.currentPrice}
D1 ATR (14-period, 20-day TR): ${data.atr || 'Not provided'}

VALUE AREA (TPO-based):
- VAH: ${data.vah || 'Not provided'}
- VAL: ${data.val || 'Not provided'}
- VA Open Position: ${data.vaOpen || 'Not provided'}

QUARTERLY PIVOTS:
- D1: QP: ${data.d1QP || 'N/A'} | QHi: ${data.d1QHi || 'N/A'} | QMid: ${data.d1QMid || 'N/A'} | QLo: ${data.d1QLo || 'N/A'}
- H4: QP: ${data.h4QP || data.d1QP || 'N/A'} | QHi: ${data.h4QHi || data.d1QHi || 'N/A'} | QMid: ${data.h4QMid || data.d1QMid || 'N/A'} | QLo: ${data.h4QLo || data.d1QLo || 'N/A'}
${conterminousInfo}

INITIAL BALANCE (per instrument IB window):
- IB High: ${data.ibHigh || 'Not provided / not yet formed'}
- IB Low: ${data.ibLow || 'Not provided / not yet formed'}
- IB Status: ${data.ibHigh && data.ibLow ? 'SET' : 'Not formed or not provided'}

TREND: ${data.trend || 'Not provided'}
M30 PATTERN: ${data.m30Pattern || 'None'}
ADR EXHAUSTED (>= 80% of 20-day TR): ${data.adrExhausted ? 'YES' : 'NO'}
CURRENT TIME (ET): ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true })}

IMPORTANT: Check IB status and time. PB2 does NOT require IB. PB1 requires IB set.
Calculate stop and targets using the ATR value provided.`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: `Today's date is ${todayDateStr()}. All analysis must be based on current conditions as of this date.\n\n${AXIOM_EDGE_SYSTEM}`,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Signals AI error:', aiRes.status, errText);
      return res.status(502).json({ error: `Anthropic returned ${aiRes.status}` });
    }

    const aiData = await aiRes.json();
    const text = aiData?.content?.[0]?.text || '';

    // Parse the JSON response â strip markdown fences if present
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    let signal;
    try {
      signal = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse AI signal response:', cleaned);
      return res.status(500).json({ error: 'AI returned invalid JSON', raw: cleaned });
    }

    res.json({ success: true, signal, ts: new Date().toISOString() });
  } catch (err) {
    console.error('Signals endpoint error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ââ /api/analyse-chart â Chart Screenshot Analyser (Vision) ââââââââââââââââââ
const CHART_ANALYSIS_SYSTEM = `You are an Axiom Edge chart analysis engine. You extract trading levels from chart screenshots. The user will upload a screenshot from any charting platform (TradingView, Deepcharts, Sierra Chart, NinjaTrader, ThinkOrSwim, etc.).

Your job is to identify and extract ALL visible levels from the chart image:

EXTRACT THESE LEVELS (return null if not visible):
- current_price: The last traded price or most recent candle close
- vah: Value Area High (from TPO/Market Profile or volume profile)
- val: Value Area Low
- poc: Point of Control (highest volume node)
- ib_high: Initial Balance High (first hour of session)
- ib_low: Initial Balance Low
- d1_qp: Daily Quarterly Pivot
- d1_qhi: Daily Q High
- d1_qmid: Daily Q Mid
- d1_qlo: Daily Q Low
- h4_qp: H4 Quarterly Pivot
- h4_qhi, h4_qmid, h4_qlo: H4 Q levels

ALSO DETERMINE:
- trend: UP/DOWN/NEUTRAL based on price position vs key levels, moving averages, or structure
- va_open: "Above VAH" / "Inside VA" / "Below VAL" based on where price opened relative to VA
- m30_pattern: Look for Bull Engulf, Bear Engulf, 3-Bar Reversal, Consolidation, or None
- adr_exhausted: true if price appears near daily range extremes
- session: What session appears active based on any timestamps/time axis visible

IB windows by instrument:
- ES/NQ: 9:30-10:30am ET Â· DAX: 9:00-10:00am CET Â· Gold: 8:20-9:20am ET Â· Oil: 9:00-10:00am ET

Look for:
- Price labels on the Y-axis
- Horizontal lines with labels (VAH, VAL, POC, pivot levels)
- Volume profile / TPO profile histograms
- Time axis to determine session
- Candlestick patterns on M30/H1 timeframes
- Any text labels, annotations, or level markers

Respond ONLY with valid JSON (no markdown, no code fences):
{
  "instrument": "<detected or provided>",
  "current_price": <number or null>,
  "vah": <number or null>,
  "val": <number or null>,
  "poc": <number or null>,
  "ib_high": <number or null>,
  "ib_low": <number or null>,
  "d1_qp": <number or null>,
  "d1_qhi": <number or null>,
  "d1_qmid": <number or null>,
  "d1_qlo": <number or null>,
  "h4_qp": <number or null>,
  "h4_qhi": <number or null>,
  "h4_qmid": <number or null>,
  "h4_qlo": <number or null>,
  "trend": "UP" or "DOWN" or "NEUTRAL",
  "va_open": "Above VAH" or "Inside VA" or "Below VAL",
  "m30_pattern": "Bull Engulf" or "Bear Engulf" or "3-Bar Reversal" or "Consolidation" or "None",
  "adr_exhausted": true or false,
  "confidence": "high" or "medium" or "low",
  "notes": "<2-3 sentences explaining what you could see and what you estimated>"
}`;

app.post('/api/analyse-chart', async (req, res) => {
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });

  const { image, instrument } = req.body;
  if (!image) return res.status(400).json({ error: 'image (base64) is required' });

  // Extract media type and base64 data
  let mediaType = 'image/png';
  let base64Data = image;
  if (image.startsWith('data:')) {
    const match = image.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) { mediaType = match[1]; base64Data = match[2]; }
  }

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: `Today's date is ${todayDateStr()}.\n\n${CHART_ANALYSIS_SYSTEM}`,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
            { type: 'text', text: `Analyse this chart screenshot. Instrument: ${instrument || 'detect from chart'}. Extract all visible trading levels. Return JSON only.` },
          ],
        }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Chart analysis AI error:', aiRes.status, errText);
      return res.status(502).json({ error: `Anthropic returned ${aiRes.status}` });
    }

    const aiData = await aiRes.json();
    const text = aiData?.content?.[0]?.text || '';
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    let analysis;
    try {
      analysis = JSON.parse(cleaned);
    } catch (e) {
      console.error('Chart analysis JSON parse failed:', cleaned);
      return res.status(500).json({ error: 'AI returned invalid JSON', raw: cleaned });
    }

    res.json({ success: true, analysis, ts: new Date().toISOString() });
  } catch (err) {
    console.error('Chart analysis error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ââ /api/autosignal â Fully Automated Axiom Edge Signal Engine âââââââââââââââ
const AUTO_SYMBOL_MAP = { ES: 'ES=F', NQ: 'NQ=F', DAX: '^GDAXI', XAU: 'GC=F', OIL: 'CL=F' };
const TICK_SIZE = { ES: 0.25, NQ: 0.25, DAX: 0.5, XAU: 0.10, OIL: 0.01 };

async function yahooChart(symbol, interval, range) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&includePrePost=true`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!r.ok) throw new Error(`Yahoo chart ${symbol} ${interval} HTTP ${r.status}`);
  const d = await r.json();
  const result = d?.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${symbol}`);
  return result;
}

function calcTPOValueArea(bars, tickSize) {
  // bars = [{ open, high, low, close }] â 30min RTH bars
  if (!bars || bars.length === 0) return { vah: 0, val: 0, poc: 0 };
  const tpoMap = {};
  for (const bar of bars) {
    const lo = Math.floor(bar.low / tickSize) * tickSize;
    const hi = Math.ceil(bar.high / tickSize) * tickSize;
    for (let p = lo; p <= hi; p = +(p + tickSize).toFixed(4)) {
      const key = p.toFixed(4);
      tpoMap[key] = (tpoMap[key] || 0) + 1;
    }
  }
  const levels = Object.entries(tpoMap).map(([p, c]) => ({ price: parseFloat(p), count: c }));
  levels.sort((a, b) => b.count - a.count || a.price - b.price);
  const totalTPOs = levels.reduce((s, l) => s + l.count, 0);
  const target = Math.ceil(totalTPOs * 0.70);
  const poc = levels[0].price;

  // Build VA: expand from POC alternating bigger side
  const byPrice = [...levels].sort((a, b) => a.price - b.price);
  const pocIdx = byPrice.findIndex(l => l.price === poc);
  let lo = pocIdx, hi = pocIdx;
  let accumulated = byPrice[pocIdx].count;
  while (accumulated < target && (lo > 0 || hi < byPrice.length - 1)) {
    const upCount = hi < byPrice.length - 1 ? byPrice[hi + 1].count : -1;
    const dnCount = lo > 0 ? byPrice[lo - 1].count : -1;
    if (upCount >= dnCount) { hi++; accumulated += byPrice[hi].count; }
    else { lo--; accumulated += byPrice[lo].count; }
  }
  return {
    vah: +byPrice[hi].price.toFixed(2),
    val: +byPrice[lo].price.toFixed(2),
    poc: +poc.toFixed(2),
  };
}

function calcATR(dailyBars, period) {
  if (dailyBars.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < dailyBars.length; i++) {
    const h = dailyBars[i].high, l = dailyBars[i].low, pc = dailyBars[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const n = Math.min(period, trs.length);
  const slice = trs.slice(-n);
  return +(slice.reduce((s, v) => s + v, 0) / slice.length).toFixed(2);
}

function calcQuarterlyPivots(qHigh, qLow, qClose) {
  const qp = (qHigh + qLow + qClose) / 3;
  const range = qHigh - qLow;
  return {
    qp: +qp.toFixed(2),
    qhi: +(qp + range).toFixed(2),
    qmid: +((qp + (qp - range)) / 2).toFixed(2),
    qlo: +(qp - range).toFixed(2),
  };
}

// ââ CONTERMINOUS CHECK (GAP 3) âââââââââââââââââââââââââââââââââââââââââââââââ
const TICK_TOLERANCE = { ES: 10, NQ: 10, DAX: 10, XAU: 10, OIL: 10 };
const TICK_VALUE_MAP = { ES: 0.25, NQ: 0.25, DAX: 1.0, XAU: 0.1, OIL: 0.01 };

function isConterminous(h4Level, vaLevel, instrument) {
  const tv = TICK_VALUE_MAP[instrument] || 0.25;
  const tol = (TICK_TOLERANCE[instrument] || 10) * tv;
  const distance = Math.abs(h4Level - vaLevel);
  return { conterminous: distance <= tol, distance: +distance.toFixed(2), tolerance: +tol.toFixed(2) };
}

// ââ H4 SWING ZONE DETECTION (GAP 2) âââââââââââââââââââââââââââââââââââââââââ
function classifyFormation(bars, idx, type) {
  // type = 'supply' or 'demand'
  // Look at 3 bars before and 3 bars after the swing point
  if (idx < 3 || idx >= bars.length - 3) return { formation: 'unknown', formation_strength: 'unknown' };
  const before = bars.slice(idx - 3, idx);
  const after = bars.slice(idx + 1, idx + 4);
  const rising = (b) => b[b.length - 1].close > b[0].open;
  const falling = (b) => b[b.length - 1].close < b[0].open;

  if (type === 'supply') {
    // RBD: rising before, drop after â reversal (strong)
    if (rising(before) && falling(after)) return { formation: 'RBD', formation_strength: 'reversal' };
    // RBR: rising before, rising after â continuation (weak)
    if (rising(before) && rising(after)) return { formation: 'RBR', formation_strength: 'continuation' };
  } else {
    // DBR: falling before, rally after â reversal (strong)
    if (falling(before) && rising(after)) return { formation: 'DBR', formation_strength: 'reversal' };
    // DBD: falling before, falling after â continuation (weak)
    if (falling(before) && falling(after)) return { formation: 'DBD', formation_strength: 'continuation' };
  }
  return { formation: 'unknown', formation_strength: 'unknown' };
}

function detectSwingZones(bars, atr, ibHigh, ibLow) {
  // bars = [{open, high, low, close}] â H4 bars (RTH only)
  const LB = 3;
  if (!bars || bars.length < LB * 2 + 1) return { supply: [], demand: [] };

  const maxRange = atr > 0 ? atr * 3 : Infinity;
  const clean = bars.filter(b => (b.high - b.low) <= maxRange);
  if (clean.length < LB * 2 + 1) return { supply: [], demand: [] };

  const totalBars = clean.length;
  const supply = [], demand = [];

  for (let i = LB; i < clean.length - LB; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= LB; j++) {
      if (clean[i].high <= clean[i - j].high || clean[i].high <= clean[i + j].high) isHigh = false;
      if (clean[i].low >= clean[i - j].low || clean[i].low >= clean[i + j].low) isLow = false;
    }

    if (isHigh) {
      const body = clean[i].open > clean[i].close ? clean[i].close : clean[i].open;
      const { formation, formation_strength } = classifyFormation(clean, i, 'supply');
      // Departure speed: bar after the swing
      const depBar = clean[i + 1];
      const depRange = depBar ? depBar.high - depBar.low : 0;
      const departure_pct = atr > 0 ? +(depRange / atr).toFixed(2) : 0;
      const departure_speed = departure_pct > 1.5 ? 'explosive' : departure_pct >= 0.8 ? 'normal' : 'slow';
      // Freshness
      const bars_ago = totalBars - 1 - i;
      const freshness = bars_ago < 20 ? 'fresh' : bars_ago <= 60 ? 'recent' : 'aged';
      // Times tested: count returns to within 0.5 ATR after formation
      let times_tested = 0;
      const zoneLevel = clean[i].high;
      const testThreshold = atr > 0 ? atr * 0.5 : 5;
      for (let k = i + LB + 1; k < clean.length; k++) {
        if (Math.abs(clean[k].high - zoneLevel) < testThreshold || Math.abs(clean[k].low - zoneLevel) < testThreshold) { times_tested++; }
      }
      // Quality score
      let score = 0;
      score += formation_strength === 'reversal' ? 4 : formation_strength === 'continuation' ? 1 : 2;
      score += departure_speed === 'explosive' ? 3 : departure_speed === 'normal' ? 2 : 1;
      score += freshness === 'fresh' ? 2 : freshness === 'recent' ? 1 : 0;
      score += times_tested === 0 ? 1 : times_tested >= 2 ? -1 : 0;
      score = Math.max(0, Math.min(10, score));
      // SIIB/WIIB
      let siib_wiib = null;
      if (ibHigh && ibLow && zoneLevel >= ibLow && zoneLevel <= ibHigh) {
        siib_wiib = score >= 6 ? 'SIIB' : 'WIIB';
      }
      supply.push({
        price_high: +clean[i].high.toFixed(2), price_low: +body.toFixed(2),
        formation, formation_strength, departure_speed, departure_pct,
        freshness, bars_ago, times_tested, quality_score: score,
        tradeable: score >= 5, siib_wiib, merge_count: 1, idx: i,
      });
    }

    if (isLow) {
      const body = clean[i].open > clean[i].close ? clean[i].open : clean[i].close;
      const { formation, formation_strength } = classifyFormation(clean, i, 'demand');
      const depBar = clean[i + 1];
      const depRange = depBar ? depBar.high - depBar.low : 0;
      const departure_pct = atr > 0 ? +(depRange / atr).toFixed(2) : 0;
      const departure_speed = departure_pct > 1.5 ? 'explosive' : departure_pct >= 0.8 ? 'normal' : 'slow';
      const bars_ago = totalBars - 1 - i;
      const freshness = bars_ago < 20 ? 'fresh' : bars_ago <= 60 ? 'recent' : 'aged';
      let times_tested = 0;
      const zoneLevel = clean[i].low;
      const testThreshold = atr > 0 ? atr * 0.5 : 5;
      for (let k = i + LB + 1; k < clean.length; k++) {
        if (Math.abs(clean[k].low - zoneLevel) < testThreshold || Math.abs(clean[k].high - zoneLevel) < testThreshold) { times_tested++; }
      }
      let score = 0;
      score += formation_strength === 'reversal' ? 4 : formation_strength === 'continuation' ? 1 : 2;
      score += departure_speed === 'explosive' ? 3 : departure_speed === 'normal' ? 2 : 1;
      score += freshness === 'fresh' ? 2 : freshness === 'recent' ? 1 : 0;
      score += times_tested === 0 ? 1 : times_tested >= 2 ? -1 : 0;
      score = Math.max(0, Math.min(10, score));
      let siib_wiib = null;
      if (ibHigh && ibLow && zoneLevel >= ibLow && zoneLevel <= ibHigh) {
        siib_wiib = score >= 6 ? 'SIIB' : 'WIIB';
      }
      demand.push({
        price_high: +body.toFixed(2), price_low: +clean[i].low.toFixed(2),
        formation, formation_strength, departure_speed, departure_pct,
        freshness, bars_ago, times_tested, quality_score: score,
        tradeable: score >= 5, siib_wiib, merge_count: 1, idx: i,
      });
    }
  }

  // Cluster nearby zones (within 0.5 ATR) â keep best quality score
  const cluster = (zones, key) => {
    if (zones.length === 0) return zones;
    const threshold = atr > 0 ? atr * 0.5 : 999999;
    const sorted = [...zones].sort((a, b) => a[key] - b[key]);
    const clustered = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
      const prev = clustered[clustered.length - 1];
      if (Math.abs(sorted[i][key] - prev[key]) < threshold) {
        prev.price_high = Math.max(prev.price_high, sorted[i].price_high);
        prev.price_low = Math.min(prev.price_low, sorted[i].price_low);
        prev.merge_count = (prev.merge_count || 1) + 1;
        // Keep the higher quality score
        if (sorted[i].quality_score > prev.quality_score) {
          prev.formation = sorted[i].formation;
          prev.formation_strength = sorted[i].formation_strength;
          prev.departure_speed = sorted[i].departure_speed;
          prev.departure_pct = sorted[i].departure_pct;
          prev.quality_score = sorted[i].quality_score;
          prev.siib_wiib = sorted[i].siib_wiib;
        }
        // Freshness: keep the freshest
        if (sorted[i].bars_ago < prev.bars_ago) {
          prev.bars_ago = sorted[i].bars_ago;
          prev.freshness = sorted[i].freshness;
        }
        prev.times_tested = Math.min(prev.times_tested, sorted[i].times_tested);
      } else {
        clustered.push({ ...sorted[i] });
      }
    }
    // Merge count bonus
    return clustered.map(z => {
      let bonus = z.merge_count >= 3 ? 1 : z.merge_count >= 2 ? 0.5 : 0;
      z.quality_score = Math.min(10, +(z.quality_score + bonus).toFixed(1));
      z.tradeable = z.quality_score >= 5;
      delete z.idx;
      return z;
    });
  };

  return {
    supply: cluster(supply, 'price_high'),
    demand: cluster(demand, 'price_low'),
  };
}

function getNearestZones(zones, currentPrice, count) {
  // Tradeable zones first (score >= 5), sorted by quality then distance
  const above = zones.supply
    .filter(z => z.price_low > currentPrice)
    .sort((a, b) => b.quality_score - a.quality_score || a.price_low - b.price_low)
    .slice(0, count)
    .map(z => ({ ...z, distance: +(z.price_low - currentPrice).toFixed(2) }));
  const below = zones.demand
    .filter(z => z.price_high < currentPrice)
    .sort((a, b) => b.quality_score - a.quality_score || b.price_high - a.price_high)
    .slice(0, count)
    .map(z => ({ ...z, distance: +(currentPrice - z.price_high).toFixed(2) }));
  return { supply: above, demand: below };
}

async function fetchH4Bars(yahooSymbol) {
  // Fetch 1h RTH-only bars (no pre/post market spikes), then group into 4h
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1h&range=30d&includePrePost=false`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!r.ok) throw new Error(`Yahoo H4 ${yahooSymbol} HTTP ${r.status}`);
  const d = await r.json();
  const chart = d?.chart?.result?.[0];
  if (!chart) throw new Error(`No H4 chart data for ${yahooSymbol}`);
  const ts = chart.timestamp || [];
  const q = chart.indicators?.quote?.[0] || {};
  const hourBars = [];
  for (let i = 0; i < ts.length; i++) {
    if (q.open?.[i] != null && q.high?.[i] != null && q.low?.[i] != null && q.close?.[i] != null) {
      hourBars.push({ ts: ts[i], open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] });
    }
  }
  // Group into 4h bars
  const h4Bars = [];
  for (let i = 0; i < hourBars.length; i += 4) {
    const group = hourBars.slice(i, Math.min(i + 4, hourBars.length));
    if (group.length === 0) continue;
    h4Bars.push({
      ts: group[0].ts,
      open: group[0].open,
      high: Math.max(...group.map(b => b.high)),
      low: Math.min(...group.map(b => b.low)),
      close: group[group.length - 1].close,
    });
  }
  return h4Bars;
}

function detectM30Pattern(bars, atr) {
  if (!bars || bars.length < 3) return 'None';
  const curr = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  // Bull Engulf
  if (curr.close > prev.high && curr.open < prev.low) return 'Bull Engulf';
  // Bear Engulf
  if (curr.close < prev.low && curr.open > prev.high) return 'Bear Engulf';
  // 3-Bar Reversal (bearish): 3 consecutive lower closes after up
  if (bars.length >= 3) {
    const b3 = bars[bars.length - 3], b2 = bars[bars.length - 2], b1 = bars[bars.length - 1];
    if (b1.close < b2.close && b2.close < b3.close && b3.close > b3.open) return '3-Bar Reversal';
  }
  // Consolidation: range of last 3 bars < 0.3x ATR
  if (bars.length >= 3 && atr > 0) {
    const last3 = bars.slice(-3);
    const rangeHi = Math.max(...last3.map(b => b.high));
    const rangeLo = Math.min(...last3.map(b => b.low));
    if ((rangeHi - rangeLo) < 0.3 * atr) return 'Consolidation';
  }
  return 'None';
}

// ââ DAY TYPE CLASSIFICATION âââââââââââââââââââââââââââââââââââââââââââââââââââ
function classifyDayType(todayBars, vah, val, ibHigh, ibLow, adr20, dailyOpen) {
  const unknown = {
    dayType: 'UNKNOWN', confidence: 'LOW', auction_type: 'unknown',
    ib_range_pct: 0, failed_auction: false, sustained_auction: false,
    playbook_bias: 'UNKNOWN', reasoning: 'IB not yet set â cannot classify day type',
  };

  if (!ibHigh || !ibLow || !adr20 || adr20 === 0) return unknown;

  const ibRange = ibHigh - ibLow;
  const ibRangePct = +(ibRange / adr20).toFixed(3);

  // Failed auction detection: price broke VAH/VAL then returned within 2 bars
  let failedAuctionUpside = false, failedAuctionDownside = false;
  if (todayBars && todayBars.length >= 3 && vah && val) {
    for (let i = 1; i < todayBars.length; i++) {
      // Broke above VAH
      if (todayBars[i].high > vah) {
        // Check if returned below VAH within next 2 bars
        const next1 = todayBars[i + 1];
        const next2 = todayBars[i + 2];
        if ((next1 && next1.close < vah) || (next2 && next2.close < vah)) {
          failedAuctionUpside = true;
        }
      }
      // Broke below VAL
      if (todayBars[i].low < val) {
        const next1 = todayBars[i + 1];
        const next2 = todayBars[i + 2];
        if ((next1 && next1.close > val) || (next2 && next2.close > val)) {
          failedAuctionDownside = true;
        }
      }
    }
  }

  // Sustained auction: IB extended and price hasn't returned to VA in last 4 bars
  let sustainedAuction = false;
  if (todayBars && todayBars.length >= 4 && vah && val) {
    const last4 = todayBars.slice(-4);
    const allAboveVA = last4.every(b => b.low > vah);
    const allBelowVA = last4.every(b => b.high < val);
    const ibExtended = (ibHigh && last4[last4.length - 1].high > ibHigh) ||
                       (ibLow && last4[last4.length - 1].low < ibLow);
    if (ibExtended && (allAboveVA || allBelowVA)) sustainedAuction = true;
  }

  // Classification
  let dayType, confidence, auction_type, playbook_bias, reasoning;

  if (failedAuctionUpside || failedAuctionDownside) {
    dayType = 'ASYMMETRICAL_NEUTRAL';
    confidence = 'HIGH';
    auction_type = failedAuctionUpside ? 'failed_upside' : 'failed_downside';
    playbook_bias = 'PB3_PB4';
    reasoning = `Failed auction ${failedAuctionUpside ? 'upside (broke VAH, returned)' : 'downside (broke VAL, returned)'} â countertrend setups dominate`;
  } else if (sustainedAuction) {
    dayType = 'TRENDING';
    confidence = 'HIGH';
    auction_type = 'sustained';
    playbook_bias = 'PB1_PB2';
    reasoning = 'Sustained auction â IB extended, price not returning to VA. Trend continuation plays.';
  } else if (ibRangePct < 0.35) {
    dayType = 'LIMITED_AUCTION';
    confidence = 'MEDIUM';
    auction_type = 'normal';
    playbook_bias = 'PB3_ONLY';
    reasoning = `Narrow IB (${(ibRangePct * 100).toFixed(0)}% of ADR) â limited range, reduced opportunity`;
  } else if (ibRangePct > 0.65) {
    dayType = 'TRENDING';
    confidence = 'MEDIUM';
    auction_type = 'normal';
    playbook_bias = 'PB1_PB2';
    reasoning = `Wide IB (${(ibRangePct * 100).toFixed(0)}% of ADR) â likely trending day`;
  } else {
    dayType = 'NORMAL_VARIATION';
    confidence = 'LOW';
    auction_type = 'normal';
    playbook_bias = 'PB1_PB2';
    reasoning = `Normal IB range (${(ibRangePct * 100).toFixed(0)}% of ADR) â default with-trend evaluation`;
  }

  return {
    dayType, confidence, auction_type, ib_range_pct: ibRangePct,
    failed_auction: failedAuctionUpside || failedAuctionDownside,
    sustained_auction: sustainedAuction, playbook_bias, reasoning,
  };
}

function getESTMins() {
  const now = new Date();
  const est = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return est.getHours() * 60 + est.getMinutes();
}

// IB windows per instrument (all times in ET minutes-since-midnight)
const IB_WINDOWS = {
  ES:  { start: 570, end: 630, label: '9:30-10:30am ET' },    // 9:30-10:30 ET
  NQ:  { start: 570, end: 630, label: '9:30-10:30am ET' },    // 9:30-10:30 ET
  DAX: { start: 180, end: 240, label: '9:00-10:00am CET' },   // 3:00-4:00am ET (= 9-10 CET)
  XAU: { start: 500, end: 560, label: '8:20-9:20am ET' },     // 8:20-9:20 ET (COMEX open)
  OIL: { start: 540, end: 600, label: '9:00-10:00am ET' },    // 9:00-10:00 ET (NYMEX pit)
};

function getIBWindow(sym) {
  return IB_WINDOWS[sym] || IB_WINDOWS.ES;
}

function getIBStatus(sym) {
  const mins = getESTMins();
  const ib = getIBWindow(sym);
  if (mins < ib.start) return 'IB Not Started';
  if (mins < ib.end) return 'IB Forming...';
  return 'IB SET';
}

function getCurrentSession(sym) {
  const mins = getESTMins();
  const ib = getIBWindow(sym || 'ES');
  if (mins >= ib.start && mins < ib.end) return `IB (${ib.label})`;
  if (mins >= 570 && mins < 630) return 'NY DRF (10:00am)';
  if (mins >= 930 && mins < 970) return 'NY Close (4:00pm)';
  if (mins >= ib.end && mins < 570) return 'Post-IB';
  if (mins >= 630 && mins < 930) return 'NY Mid-Day';
  if (mins < ib.start) return 'Pre-Market';
  return 'After Hours';
}

// AUTOSIGNAL uses the same shared prompt as /api/signals
const AUTOSIGNAL_SYSTEM = AXIOM_EDGE_SYSTEM;

app.get('/api/autosignal', async (req, res) => {
  const sym = (req.query.symbol || 'ES').toUpperCase();
  const yahooSym = AUTO_SYMBOL_MAP[sym];
  if (!yahooSym) return res.status(400).json({ error: `Unknown symbol: ${sym}. Use ES/NQ/DAX/XAU/OIL` });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });

  const tick = TICK_SIZE[sym] || 0.25;

  try {
    // Parallel fetch: 30m bars (5d), daily bars (3mo), intraday 5m (1d)
    const [chart30m, chartDaily] = await Promise.all([
      yahooChart(yahooSym, '30m', '5d'),
      yahooChart(yahooSym, '1d', '3mo'),
    ]);

    const ts30 = chart30m.timestamp || [];
    const q30 = chart30m.indicators?.quote?.[0] || {};
    const tsD = chartDaily.timestamp || [];
    const qD = chartDaily.indicators?.quote?.[0] || {};
    const meta = chart30m.meta || {};
    const yahooPrice = meta.regularMarketPrice || 0;

    // Get live price (dxFeed â Yahoo fallback)
    const AUTOSIGNAL_LIVE_MAP = { ES: 'ES', NQ: 'NQ', XAU: 'GC', OIL: 'CL' };
    const liveKey = AUTOSIGNAL_LIVE_MAP[sym];
    let currentPrice = yahooPrice;
    let priceSource = 'yahoo';
    if (liveKey) {
      const live = await getLivePrice(liveKey, yahooSym);
      currentPrice = live.price;
      priceSource = live.source;
    }
    // ProjectX live price takes highest priority
    const projectxPrice = req.query.livePrice ? parseFloat(req.query.livePrice) : null;
    if (projectxPrice) { currentPrice = projectxPrice; priceSource = 'projectx'; }

    // ââ Build daily OHLC bars ââ
    const dailyBars = [];
    for (let i = 0; i < tsD.length; i++) {
      if (qD.open?.[i] != null && qD.high?.[i] != null && qD.low?.[i] != null && qD.close?.[i] != null) {
        dailyBars.push({ ts: tsD[i], open: qD.open[i], high: qD.high[i], low: qD.low[i], close: qD.close[i] });
      }
    }

    // ATR (14-period) and ADR (20-day)
    const atr14 = calcATR(dailyBars, 14);
    const adr20 = calcATR(dailyBars, 20);

    // ââ Quarterly pivots from last completed quarter ââ
    const lastBar = dailyBars[dailyBars.length - 1];
    const lastDate = lastBar ? new Date(lastBar.ts * 1000) : new Date();
    const curQtr = Math.floor(lastDate.getMonth() / 3);
    const prevQtrEnd = new Date(lastDate.getFullYear(), curQtr * 3, 0);
    const prevQtrStart = new Date(prevQtrEnd.getFullYear(), prevQtrEnd.getMonth() - 2, 1);
    const qtrBars = dailyBars.filter(b => {
      const d = new Date(b.ts * 1000);
      return d >= prevQtrStart && d <= prevQtrEnd;
    });
    let d1Pivots = { qp: 0, qhi: 0, qmid: 0, qlo: 0 };
    if (qtrBars.length > 0) {
      const qHigh = Math.max(...qtrBars.map(b => b.high));
      const qLow = Math.min(...qtrBars.map(b => b.low));
      const qClose = qtrBars[qtrBars.length - 1].close;
      d1Pivots = calcQuarterlyPivots(qHigh, qLow, qClose);
    }

    // ââ Build 30m bars and filter RTH yesterday ââ
    const bars30m = [];
    for (let i = 0; i < ts30.length; i++) {
      if (q30.open?.[i] != null && q30.high?.[i] != null && q30.low?.[i] != null && q30.close?.[i] != null) {
        bars30m.push({ ts: ts30[i], open: q30.open[i], high: q30.high[i], low: q30.low[i], close: q30.close[i] });
      }
    }

    // Separate yesterday RTH (9:30-16:00 EST) and today's bars
    const nowEST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayStr = `${nowEST.getFullYear()}-${String(nowEST.getMonth() + 1).padStart(2, '0')}-${String(nowEST.getDate()).padStart(2, '0')}`;

    const yesterdayRTH = [];
    const todayBars = [];
    const todayIBBars = [];
    const todayM30Bars = [];

    for (const bar of bars30m) {
      const d = new Date(bar.ts * 1000);
      const est = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const dateStr = `${est.getFullYear()}-${String(est.getMonth() + 1).padStart(2, '0')}-${String(est.getDate()).padStart(2, '0')}`;
      const hhmm = est.getHours() * 60 + est.getMinutes();

      if (dateStr === todayStr) {
        todayBars.push(bar);
        const ib = getIBWindow(sym);
        if (hhmm >= ib.start && hhmm < ib.end) todayIBBars.push(bar);
        todayM30Bars.push(bar);
      } else if (hhmm >= 570 && hhmm < 960) {
        // RTH: 9:30 (570min) to 16:00 (960min)
        yesterdayRTH.push(bar);
      }
    }

    // Keep only last day's RTH bars
    if (yesterdayRTH.length > 0) {
      const lastRTHDate = new Date(yesterdayRTH[yesterdayRTH.length - 1].ts * 1000)
        .toLocaleString('en-US', { timeZone: 'America/New_York' }).split(',')[0];
      const filtered = yesterdayRTH.filter(b => {
        const d = new Date(b.ts * 1000).toLocaleString('en-US', { timeZone: 'America/New_York' }).split(',')[0];
        return d === lastRTHDate;
      });
      yesterdayRTH.length = 0;
      yesterdayRTH.push(...filtered);
    }

    // ââ Calculate TPO Value Area ââ
    const va = calcTPOValueArea(yesterdayRTH, tick);

    // ââ IB High/Low ââ
    let ibHigh = null, ibLow = null;
    if (todayIBBars.length > 0) {
      ibHigh = +Math.max(...todayIBBars.map(b => b.high)).toFixed(2);
      ibLow = +Math.min(...todayIBBars.map(b => b.low)).toFixed(2);
    }

    // ââ M30 pattern ââ
    const m30Pattern = detectM30Pattern(todayM30Bars, atr14);

    // ââ Context derivation ââ
    let vaOpen = 'Inside VA';
    if (currentPrice > va.vah) vaOpen = 'Above VAH';
    else if (currentPrice < va.val) vaOpen = 'Below VAL';

    let trend = 'NEUTRAL';
    if (currentPrice > d1Pivots.qp && currentPrice > d1Pivots.qmid) trend = 'UP';
    else if (currentPrice < d1Pivots.qp && currentPrice < d1Pivots.qmid) trend = 'DOWN';

    const todayHigh = todayBars.length > 0 ? Math.max(...todayBars.map(b => b.high)) : currentPrice;
    const todayLow = todayBars.length > 0 ? Math.min(...todayBars.map(b => b.low)) : currentPrice;
    const todayRange = todayHigh - todayLow;
    const adrExhausted = adr20 > 0 && todayRange > 0.8 * adr20;

    let ibExtension = 'NONE';
    if (ibHigh && currentPrice > ibHigh) ibExtension = 'UP';
    else if (ibLow && currentPrice < ibLow) ibExtension = 'DOWN';

    const session = getCurrentSession(sym);
    const ibStatus = getIBStatus(sym);
    const ibWindow = getIBWindow(sym);

    // ââ Day type classification ââ
    const dayClassification = classifyDayType(todayBars, va.vah, va.val, ibHigh, ibLow, adr20, todayBars[0]?.open || currentPrice);

    // ââ H4 zones (GAP 2 + 4) ââ
    let h4Zones = { supply: [], demand: [] };
    try {
      const h4Bars = await fetchH4Bars(yahooSym);
      const h4atr = calcATR(h4Bars, 14);
      const rawZones = detectSwingZones(h4Bars, h4atr, ibHigh, ibLow);
      h4Zones = getNearestZones(rawZones, currentPrice, 3);
    } catch (e) { console.warn('H4 zones failed:', e.message); }

    // H4 QP = D1 QP (same quarterly pivot values, different timeframe context â GAP 1)
    const h4Pivots = { ...d1Pivots };

    // ââ Conterminous checks (GAP 3) ââ
    const nearestDemand = h4Zones.demand[0];
    const nearestSupply = h4Zones.supply[0];
    const defaultTol = (TICK_TOLERANCE[sym] || 10) * (TICK_VALUE_MAP[sym] || 0.25);
    let demandConterminous = nearestDemand
      ? isConterminous(nearestDemand.price_high, va.vah, sym)
      : { conterminous: false, distance: null, tolerance: defaultTol };
    let supplyConterminous = nearestSupply
      ? isConterminous(nearestSupply.price_low, va.val, sym)
      : { conterminous: false, distance: null, tolerance: defaultTol };
    // Reject weak zones as c-lines (quality < 5 = not tradeable)
    if (nearestDemand && !nearestDemand.tradeable) demandConterminous = { ...demandConterminous, conterminous: false };
    if (nearestSupply && !nearestSupply.tradeable) supplyConterminous = { ...supplyConterminous, conterminous: false };

    // ââ ADR/ASR levels ââ
    let asrData = null;
    try {
      const asrRes = await fetch(`${getInternalUrl(req)}/api/adr-asr?symbol=${sym}`, { headers: { 'User-Agent': 'AxiomAutoSignal/1.0' } });
      const asrJson = await asrRes.json();
      if (asrJson.success) asrData = asrJson;
    } catch (e) { console.warn('ASR fetch failed:', e.message); }

    // ââ Data object to return + send to AI ââ
    const curSess = asrData?.currentSession || 'NY';
    const curSessData = asrData?.sessions?.[curSess] || {};
    const dataUsed = {
      vah: va.vah, val: va.val, poc: va.poc,
      atr: atr14, adr: adr20,
      ib_high: ibHigh, ib_low: ibLow, ib_status: ibStatus, ib_window: ibWindow.label,
      current_price: +currentPrice.toFixed(2),
      trend, va_open: vaOpen,
      m30_pattern: m30Pattern,
      adr_exhausted: adrExhausted,
      ib_extension: ibExtension,
      session,
      d1_qp: d1Pivots.qp, d1_qhi: d1Pivots.qhi, d1_qmid: d1Pivots.qmid, d1_qlo: d1Pivots.qlo,
      h4_qp: h4Pivots.qp, h4_qhi: h4Pivots.qhi, h4_qmid: h4Pivots.qmid, h4_qlo: h4Pivots.qlo,
      h4_supply_nearest: nearestSupply || null,
      h4_demand_nearest: nearestDemand || null,
      h4_supply_conterminous: supplyConterminous.conterminous,
      h4_supply_distance_from_val: supplyConterminous.distance,
      h4_demand_conterminous: demandConterminous.conterminous,
      h4_demand_distance_from_vah: demandConterminous.distance,
      conterminous_tolerance: demandConterminous.tolerance,
      h4_supply_zones: h4Zones.supply,
      h4_demand_zones: h4Zones.demand,
      today_high: +todayHigh.toFixed(2), today_low: +todayLow.toFixed(2),
      today_range: +todayRange.toFixed(2),
      yesterday_rth_bars: yesterdayRTH.length,
      today_bars: todayBars.length,
      // Day type
      day_type: dayClassification.dayType,
      day_type_confidence: dayClassification.confidence,
      auction_type: dayClassification.auction_type,
      ib_range_pct: dayClassification.ib_range_pct,
      playbook_bias: dayClassification.playbook_bias,
      day_type_reasoning: dayClassification.reasoning,
      failed_auction: dayClassification.failed_auction,
      sustained_auction: dayClassification.sustained_auction,
      // ASR data
      current_session_name: curSess,
      adr_target_high: asrData?.daily?.targetHigh || null,
      adr_target_low: asrData?.daily?.targetLow || null,
      adr_exhaustion_pct: asrData?.daily?.exhaustion?.totalPct || null,
      asr_current_session: curSess,
      asr_target_high: curSessData.targetHigh || null,
      asr_target_low: curSessData.targetLow || null,
      asr_exhaustion_pct: curSessData.exhaustion?.totalPct || null,
      asr_sessions: asrData ? {
        TK: { target_high: asrData.sessions?.TK?.targetHigh, target_low: asrData.sessions?.TK?.targetLow, exhaustion_pct: asrData.sessions?.TK?.exhaustion?.totalPct },
        LN: { target_high: asrData.sessions?.LN?.targetHigh, target_low: asrData.sessions?.LN?.targetLow, exhaustion_pct: asrData.sessions?.LN?.exhaustion?.totalPct },
        NY: { target_high: asrData.sessions?.NY?.targetHigh, target_low: asrData.sessions?.NY?.targetLow, exhaustion_pct: asrData.sessions?.NY?.exhaustion?.totalPct },
      } : null,
    };

    // ââ Pre-calculate stops & targets ââ
    const entryPrice = currentPrice;
    const r = Math.round(atr14 * 0.5 * 100) / 100;  // 0.5x ATR14 for intraday default
    const preCalc = {
      entry: entryPrice,
      r_value: r,
      long_stop:       Math.round((entryPrice - r) * 100) / 100,
      long_target_1r:  Math.round((entryPrice + r) * 100) / 100,
      long_target_2r:  Math.round((entryPrice + r * 2) * 100) / 100,
      long_target_3r:  Math.round((entryPrice + r * 3) * 100) / 100,
      short_stop:      Math.round((entryPrice + r) * 100) / 100,
      short_target_1r: Math.round((entryPrice - r) * 100) / 100,
      short_target_2r: Math.round((entryPrice - r * 2) * 100) / 100,
      short_target_3r: Math.round((entryPrice - r * 3) * 100) / 100,
    };
    dataUsed.entry_price = preCalc.entry;
    dataUsed.r_value = preCalc.r_value;
    dataUsed.price_source = priceSource;

    // ââ Call Claude ââ
    const userPrompt = `Analyse this LIVE market data for ${sym} and determine the correct Axiom Edge playbook signal:

INSTRUMENT: ${sym}
CURRENT PRICE: ${dataUsed.current_price}

D1 ATR (14-period): ${dataUsed.atr}
ADR (20-day TR): ${dataUsed.adr}
TODAY'S RANGE: ${dataUsed.today_range} (${adrExhausted ? 'EXHAUSTED >80% ADR' : 'Not exhausted'})

VALUE AREA (TPO-based, yesterday RTH 30min bars, ${yesterdayRTH.length} periods):
- VAH: ${dataUsed.vah}
- VAL: ${dataUsed.val}
- POC: ${dataUsed.poc}
- VA Open: ${dataUsed.va_open}

QUARTERLY PIVOTS:
- D1: QP: ${dataUsed.d1_qp} | QHi: ${dataUsed.d1_qhi} | QMid: ${dataUsed.d1_qmid} | QLo: ${dataUsed.d1_qlo}
- H4: QP: ${dataUsed.h4_qp} | QHi: ${dataUsed.h4_qhi} | QMid: ${dataUsed.h4_qmid} | QLo: ${dataUsed.h4_qlo}

H4 SUPPLY/DEMAND ZONES (auto-detected from swing highs/lows):
- Nearest Supply (above): ${dataUsed.h4_supply_nearest ? `${dataUsed.h4_supply_nearest.price_low}-${dataUsed.h4_supply_nearest.price_high} (distance: ${dataUsed.h4_supply_nearest.distance}, ${dataUsed.h4_supply_nearest.formation || 'unknown'} formation, ${dataUsed.h4_supply_nearest.departure_speed || 'unknown'} departure, score ${dataUsed.h4_supply_nearest.quality_score}/10, ${dataUsed.h4_supply_nearest.tradeable ? 'TRADEABLE' : 'WEAK'}, ${dataUsed.h4_supply_nearest.siib_wiib || 'outside IB'})` : 'None detected'}
- Nearest Demand (below): ${dataUsed.h4_demand_nearest ? `${dataUsed.h4_demand_nearest.price_high}-${dataUsed.h4_demand_nearest.price_low} (distance: ${dataUsed.h4_demand_nearest.distance}, ${dataUsed.h4_demand_nearest.formation || 'unknown'} formation, ${dataUsed.h4_demand_nearest.departure_speed || 'unknown'} departure, score ${dataUsed.h4_demand_nearest.quality_score}/10, ${dataUsed.h4_demand_nearest.tradeable ? 'TRADEABLE' : 'WEAK'}, ${dataUsed.h4_demand_nearest.siib_wiib || 'outside IB'})` : 'None detected'}
- All Supply: ${dataUsed.h4_supply_zones.map(z => `${z.price_low}-${z.price_high}`).join(' | ') || 'None'}
- All Demand: ${dataUsed.h4_demand_zones.map(z => `${z.price_low}-${z.price_high}`).join(' | ') || 'None'}

CONTERMINOUS CHECK (pre-calculated, tolerance: ${dataUsed.conterminous_tolerance} pts):
- H4 Demand vs VAH: ${dataUsed.h4_demand_conterminous ? 'CONTERMINOUS' : 'NOT conterminous'} (distance: ${dataUsed.h4_demand_distance_from_vah ?? 'N/A'} pts)
- H4 Supply vs VAL: ${dataUsed.h4_supply_conterminous ? 'CONTERMINOUS' : 'NOT conterminous'} (distance: ${dataUsed.h4_supply_distance_from_val ?? 'N/A'} pts)
NOTE: Conterminous values are pre-validated mathematically. Use these directly â do not re-evaluate.

INITIAL BALANCE (${dataUsed.ib_window} â ${dataUsed.ib_status}):
- IB High: ${dataUsed.ib_high || 'Not yet formed'}
- IB Low: ${dataUsed.ib_low || 'Not yet formed'}
- IB Extension: ${dataUsed.ib_extension}

TREND: ${dataUsed.trend}
M30 PATTERN (last completed bar): ${dataUsed.m30_pattern}
ADR EXHAUSTED: ${dataUsed.adr_exhausted ? 'YES' : 'NO'}
DAY TYPE: ${dataUsed.day_type} (${dataUsed.day_type_confidence} confidence) \u2014 ${dataUsed.day_type_reasoning}. Playbook bias: ${dataUsed.playbook_bias}. Auction: ${dataUsed.auction_type}. IB range: ${((dataUsed.ib_range_pct || 0) * 100).toFixed(0)}% of ADR.
CURRENT SESSION: ${dataUsed.session}
CURRENT TIME (ET): ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true })}
IB STATUS: ${dataUsed.ib_status}

ADR/ASR TARGET LEVELS:
- ADR Target High: ${dataUsed.adr_target_high || 'N/A'} | ADR Target Low: ${dataUsed.adr_target_low || 'N/A'} | ADR Exhaustion: ${dataUsed.adr_exhaustion_pct ?? 'N/A'}%
- Current Session: ${dataUsed.asr_current_session}
- ${dataUsed.asr_current_session} ASR Target High: ${dataUsed.asr_target_high || 'N/A'} | ASR Target Low: ${dataUsed.asr_target_low || 'N/A'} | ASR Exhaustion: ${dataUsed.asr_exhaustion_pct ?? 'N/A'}%
${dataUsed.asr_sessions ? `- TK ASR: ${dataUsed.asr_sessions.TK?.target_high || 'N/A'} / ${dataUsed.asr_sessions.TK?.target_low || 'N/A'} (${dataUsed.asr_sessions.TK?.exhaustion_pct ?? 'N/A'}%)
- LN ASR: ${dataUsed.asr_sessions.LN?.target_high || 'N/A'} / ${dataUsed.asr_sessions.LN?.target_low || 'N/A'} (${dataUsed.asr_sessions.LN?.exhaustion_pct ?? 'N/A'}%)
- NY ASR: ${dataUsed.asr_sessions.NY?.target_high || 'N/A'} / ${dataUsed.asr_sessions.NY?.target_low || 'N/A'} (${dataUsed.asr_sessions.NY?.exhaustion_pct ?? 'N/A'}%)` : ''}
ASR exhaustion for current session (${dataUsed.asr_current_session}): ${dataUsed.asr_exhaustion_pct ?? 'N/A'}% \u2014 if >100%, session range is exhausted, treat as hard ceiling for profit targets.

IMPORTANT: Check time context. If IB not yet formed, PB2 may still fire (no IB required). PB1 requires IB set.

PRE-CALCULATED STOPS & TARGETS (use these exact values \u2014 do NOT recalculate):
Entry (current price): ${preCalc.entry}
1R value (0.5x D1 ATR14): ${preCalc.r_value}
D1 ATR14 (full): ${atr14}
If signal is LONG:
  stop = ${preCalc.long_stop}
  target_1r = ${preCalc.long_target_1r}
  target_2r = ${preCalc.long_target_2r}
  target_3r = ${preCalc.long_target_3r}
If signal is SHORT:
  stop = ${preCalc.short_stop}
  target_1r = ${preCalc.short_target_1r}
  target_2r = ${preCalc.short_target_2r}
  target_3r = ${preCalc.short_target_3r}
Stop is pre-calculated at 0.5x ATR14 for intraday setups. For PB4 swing path, you may note that a wider 1x ATR stop is appropriate but use the provided values for the JSON fields.
CRITICAL: Use ONLY these pre-calculated values in the stop, target_1r, target_2r, target_3r JSON fields. Never estimate or adjust these numbers.`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        temperature: 0,
        system: `Today's date is ${todayDateStr()}. All analysis must be based on current conditions as of this date.\n\n${AUTOSIGNAL_SYSTEM}`,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('AutoSignal AI error:', aiRes.status, errText);
      // Return data even if AI fails
      return res.json({ success: true, signal: null, data_used: dataUsed, ai_error: `Anthropic ${aiRes.status}`, ts: new Date().toISOString() });
    }

    const aiData = await aiRes.json();
    const text = aiData?.content?.[0]?.text || '';
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    let signal;
    try {
      signal = JSON.parse(cleaned);
    } catch (e) {
      console.error('AutoSignal JSON parse failed:', cleaned);
      return res.json({ success: true, signal: null, data_used: dataUsed, ai_error: 'Invalid AI response', raw: cleaned, ts: new Date().toISOString() });
    }

    // Override stop/target with pre-calculated values â never trust Claude's math
    if (signal && preCalc) {
      if (signal.signal === 'LONG') {
        signal.stop = preCalc.long_stop;
        signal.target_1r = preCalc.long_target_1r;
        signal.target_2r = preCalc.long_target_2r;
        signal.target_3r = preCalc.long_target_3r;
      } else if (signal.signal === 'SHORT') {
        signal.stop = preCalc.short_stop;
        signal.target_1r = preCalc.short_target_1r;
        signal.target_2r = preCalc.short_target_2r;
        signal.target_3r = preCalc.short_target_3r;
      }
    }

    // Attach data_used to signal
    signal.data_used = dataUsed;
    res.json({ success: true, signal, data_used: dataUsed, ts: new Date().toISOString() });

  } catch (err) {
    console.error('AutoSignal error:', err);
    res.status(500).json({ error: err.message, symbol: sym });
  }
});

// ââ /api/tpo â TPO Value Area Calculator (yesterday RTH) âââââââââââââââââââââ
app.get('/api/tpo', async (req, res) => {
  const instrument = (req.query.instrument || 'ES').toUpperCase();
  const tickerMap = { ES: 'ES=F', NQ: 'NQ=F', DAX: '^GDAXI', XAU: 'GC=F', OIL: 'CL=F' };
  const ticker = tickerMap[instrument];
  if (!ticker) return res.status(400).json({ error: `Unknown instrument: ${instrument}` });

  const tick = TICK_SIZE[instrument] || 0.25;

  try {
    // Fetch 30m bars for last 5 days
    const chart = await yahooChart(ticker, '30m', '5d');
    const ts = chart.timestamp || [];
    const q = chart.indicators?.quote?.[0] || {};
    const meta = chart.meta || {};
    const currentPrice = meta.regularMarketPrice || 0;

    const bars30m = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.open?.[i] != null && q.high?.[i] != null && q.low?.[i] != null && q.close?.[i] != null) {
        bars30m.push({ ts: ts[i], open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i] });
      }
    }

    // Find yesterday's RTH bars (9:30-16:00 ET)
    const nowEST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayStr = `${nowEST.getFullYear()}-${String(nowEST.getMonth() + 1).padStart(2, '0')}-${String(nowEST.getDate()).padStart(2, '0')}`;

    const yesterdayRTH = [];
    for (const bar of bars30m) {
      const d = new Date(bar.ts * 1000);
      const est = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const dateStr = `${est.getFullYear()}-${String(est.getMonth() + 1).padStart(2, '0')}-${String(est.getDate()).padStart(2, '0')}`;
      const hhmm = est.getHours() * 60 + est.getMinutes();
      // RTH: 9:30 (570min) to 16:00 (960min), exclude today
      if (dateStr !== todayStr && hhmm >= 570 && hhmm < 960) {
        yesterdayRTH.push(bar);
      }
    }

    // Keep only the most recent RTH day
    if (yesterdayRTH.length > 0) {
      const lastDate = new Date(yesterdayRTH[yesterdayRTH.length - 1].ts * 1000)
        .toLocaleString('en-US', { timeZone: 'America/New_York' }).split(',')[0];
      const filtered = yesterdayRTH.filter(b => {
        const d = new Date(b.ts * 1000).toLocaleString('en-US', { timeZone: 'America/New_York' }).split(',')[0];
        return d === lastDate;
      });
      yesterdayRTH.length = 0;
      yesterdayRTH.push(...filtered);
    }

    if (yesterdayRTH.length === 0) {
      return res.json({ success: false, reason: 'No RTH bars found for previous session' });
    }

    // Calculate TPO Value Area
    const va = calcTPOValueArea(yesterdayRTH, tick);

    // Determine VA open position
    let vaOpen = 'Inside VA';
    if (currentPrice > va.vah) vaOpen = 'Above VAH';
    else if (currentPrice < va.val) vaOpen = 'Below VAL';

    const r = v => Math.round(v * 100) / 100;

    res.json({
      success: true,
      instrument,
      vah: r(va.vah),
      val: r(va.val),
      poc: r(va.poc),
      vaOpen,
      currentPrice: r(currentPrice),
      rthBarsUsed: yesterdayRTH.length,
      tickSize: tick,
      fields: {
        vah: r(va.vah),
        val: r(va.val),
        vaOpen,
      },
    });
  } catch (err) {
    console.error('[TPO]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ââ /api/qp-calculate â D1 Q Point Calculator (swing-based quartile levels) ââ
app.get('/api/qp-calculate', async (req, res) => {
  const { instrument } = req.query;
  const tickerMap = { ES: 'ES=F', NQ: 'NQ=F', DAX: '^GDAXI', XAU: 'GC=F', OIL: 'CL=F' };
  const ticker = tickerMap[instrument];
  if (!ticker) return res.status(400).json({ error: `Unknown instrument: ${instrument}` });

  try {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - (180 * 24 * 60 * 60);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`Yahoo Finance returned ${response.status}`);
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('No data from Yahoo Finance');

    const quotes = result.indicators.quote[0];
    const timestamps = result.timestamp;
    const candles = timestamps.map((t, i) => ({
      time: new Date(t * 1000).toISOString().split('T')[0],
      open: quotes.open[i], high: quotes.high[i], low: quotes.low[i], close: quotes.close[i],
    })).filter(c => c.high && c.low && c.close);

    if (candles.length < 20) throw new Error('Not enough candle data');

    const LOOKBACK = 5;
    const swingHighs = [], swingLows = [];

    for (let i = LOOKBACK; i < candles.length - LOOKBACK; i++) {
      const c = candles[i];
      const isSwingHigh = candles.slice(i - LOOKBACK, i).every(x => x.high <= c.high) &&
                          candles.slice(i + 1, i + LOOKBACK + 1).every(x => x.high <= c.high);
      const isSwingLow = candles.slice(i - LOOKBACK, i).every(x => x.low >= c.low) &&
                         candles.slice(i + 1, i + LOOKBACK + 1).every(x => x.low >= c.low);
      if (isSwingHigh) swingHighs.push({ index: i, price: c.high, time: c.time });
      if (isSwingLow) swingLows.push({ index: i, price: c.low, time: c.time });
    }

    if (!swingHighs.length || !swingLows.length) {
      return res.json({ valid: false, reason: 'No confirmed swings found on D1' });
    }

    const currentPrice = candles[candles.length - 1].close;
    let bestPair = null;
    const recentHighs = [...swingHighs].sort((a, b) => b.index - a.index);
    const recentLows = [...swingLows].sort((a, b) => b.index - a.index);

    for (const sh of recentHighs.slice(0, 5)) {
      for (const sl of recentLows.slice(0, 5)) {
        const H = sh.price, L = sl.price;
        if (H <= L) continue;
        const range = H - L;
        const middle = L + range * 0.50;
        const highFirst = sh.index < sl.index;
        const triggered = highFirst ? currentPrice <= middle : currentPrice >= middle;
        if (triggered) { bestPair = { H, L, sh, sl, highFirst, range }; break; }
      }
      if (bestPair) break;
    }

    const r = v => Math.round(v * 100) / 100;

    if (!bestPair) {
      const sh = recentHighs[0], sl = recentLows[0];
      const H = sh.price, L = sl.price, range = H - L, middle = L + range * 0.50;
      return res.json({
        valid: false,
        reason: `50% retracement not yet triggered. Price (${r(currentPrice)}) hasn't crossed Middle Trigger (${r(middle)})`,
        pendingLevels: {
          swingHigh: r(H), qPointHigh: r(L + range * 0.75), middleTrigger: r(middle),
          qPointLow: r(L + range * 0.25), swingLow: r(L),
          swingHighTime: sh.time, swingLowTime: sl.time,
        },
        fields: {
          d1QHi: r(L + range * 0.75), d1QP: r(middle),
          d1QMid: r(L + range * 0.25), d1QLo: r(L),
          h4QHi: r(L + range * 0.75), h4QP: r(middle),
          h4QMid: r(L + range * 0.25), h4QLo: r(L),
        },
      });
    }

    const { H, L, sh, sl, highFirst, range } = bestPair;
    const levels = {
      swingHigh: r(H), qPointHigh: r(L + range * 0.75), middleTrigger: r(L + range * 0.50),
      qPointLow: r(L + range * 0.25), swingLow: r(L),
    };
    // Map to frontend form field names
    const fieldMap = {
      d1QHi: r(L + range * 0.75), d1QP: r(L + range * 0.50),
      d1QMid: r(L + range * 0.25), d1QLo: r(L),
      h4QHi: r(L + range * 0.75), h4QP: r(L + range * 0.50),
      h4QMid: r(L + range * 0.25), h4QLo: r(L),
    };

    res.json({
      valid: true, instrument, ticker,
      direction: highFirst ? 'bearish' : 'bullish',
      trigger: 'confirmed \u2014 price crossed 50% of swing',
      swingHighTime: sh.time, swingLowTime: sl.time,
      currentPrice: r(currentPrice), levels, fields: fieldMap,
    });
  } catch (err) {
    console.error('[QP Calc]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ââ /api/h4-zones â H4 Supply/Demand Zone Detection âââââââââââââââââââââââââ
app.get('/api/h4-zones', async (req, res) => {
  const symbol = req.query.symbol || 'ES=F';
  const currentPrice = parseFloat(req.query.current_price) || 0;
  const instrument = req.query.instrument || 'ES';

  try {
    const h4Bars = await fetchH4Bars(symbol);
    const atr = calcATR(h4Bars, 14);
    const rawZones = detectSwingZones(h4Bars, atr, null, null);
    const nearest = getNearestZones(rawZones, currentPrice, 3);
    res.json({ success: true, supply: nearest.supply, demand: nearest.demand, h4_bars_count: h4Bars.length, atr_h4: +atr.toFixed(2) });
  } catch (err) {
    console.error('H4 zones error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ââ BLAHTECH ADR/ASR LEVEL CALCULATIONS ââââââââââââââââââââââââââââââââââââââ
// Equity instrument definitions (CQG symbols from Blahtech Levels)
const EQUITY_TICK_SIZE = { ES: 0.25, NQ: 0.25, YM: 1, FDXM: 1, DAX: 0.5, XAU: 0.10, OIL: 0.01 };
const EQUITY_YAHOO_MAP = { ES: 'ES=F', NQ: 'NQ=F', YM: 'YM=F', FDXM: '^GDAXI', DAX: '^GDAXI', XAU: 'GC=F', OIL: 'CL=F' };
const EQUITY_INSTRUMENTS = ['ES', 'NQ', 'YM', 'FDXM', 'DAX', 'XAU', 'OIL'];

// Session open times in GMT hours
const SESSION_TIMES = { TK: 0, LN: 7, NY: 13 };

function getBlahTechSession(gmtHour) {
  if (gmtHour >= SESSION_TIMES.NY) return 'NY';
  if (gmtHour >= SESSION_TIMES.LN) return 'LN';
  return 'TK';
}

function ticksToPrice(ticks, tickSize) {
  return ticks * tickSize;
}

function computeDailyRangeLevels(dailyOpen, adrTicks, tickSize) {
  const adrPrice = ticksToPrice(adrTicks, tickSize);
  return {
    dailyOpen,
    adrTicks,
    adrPrice: +adrPrice.toFixed(4),
    targetHigh: +(dailyOpen + adrPrice).toFixed(2),
    targetLow: +(dailyOpen - adrPrice).toFixed(2),
  };
}

function computeSessionRangeLevels(sessionOpen, asrTicks, tickSize) {
  const asrPrice = ticksToPrice(asrTicks, tickSize);
  return {
    sessionOpen,
    asrTicks,
    asrPrice: +asrPrice.toFixed(4),
    targetHigh: +(sessionOpen + asrPrice).toFixed(2),
    targetLow: +(sessionOpen - asrPrice).toFixed(2),
  };
}

function computeRangeExhaustion(openPrice, currentHigh, currentLow, rangeTicks, tickSize) {
  const rangePrice = ticksToPrice(rangeTicks, tickSize);
  if (rangePrice === 0) return { aboveOpenPct: 0, belowOpenPct: 0, totalPct: 0 };
  const aboveOpen = Math.max(0, currentHigh - openPrice);
  const belowOpen = Math.max(0, openPrice - currentLow);
  const actualRange = currentHigh - currentLow;
  return {
    aboveOpenPct: +((aboveOpen / rangePrice) * 100).toFixed(1),
    belowOpenPct: +((belowOpen / rangePrice) * 100).toFixed(1),
    totalPct: +((actualRange / rangePrice) * 100).toFixed(1),
  };
}

// ââ /api/adr-asr â Blahtech ADR/ASR Target Levels âââââââââââââââââââââââââââ
app.get('/api/adr-asr', async (req, res) => {
  try {
    const sym = (req.query.symbol || 'ES').toUpperCase();
    if (!EQUITY_INSTRUMENTS.includes(sym)) {
      return res.status(400).json({ error: `Invalid symbol. Supported: ${EQUITY_INSTRUMENTS.join(', ')}` });
    }
    const yahooSym = EQUITY_YAHOO_MAP[sym];
    const tickSize = EQUITY_TICK_SIZE[sym];
    const lookback = parseInt(req.query.lookback) || 5;

    // Fetch daily bars (3 months) and intraday 30m bars (5 days)
    const [chartDaily, chart30m] = await Promise.all([
      yahooChart(yahooSym, '1d', '3mo'),
      yahooChart(yahooSym, '30m', '5d'),
    ]);

    // Build daily OHLC bars
    const tsD = chartDaily.timestamp || [];
    const qD = chartDaily.indicators?.quote?.[0] || {};
    const dailyBars = [];
    for (let i = 0; i < tsD.length; i++) {
      if (qD.open?.[i] != null && qD.high?.[i] != null && qD.low?.[i] != null && qD.close?.[i] != null) {
        dailyBars.push({ ts: tsD[i], open: qD.open[i], high: qD.high[i], low: qD.low[i], close: qD.close[i] });
      }
    }

    if (dailyBars.length < 2) {
      return res.status(400).json({ error: 'Insufficient daily data' });
    }

    // ADR: average of (high - low) over lookback days
    const recentDaily = dailyBars.slice(-lookback);
    const adrPrice = recentDaily.reduce((s, b) => s + (b.high - b.low), 0) / recentDaily.length;
    const adrTicks = Math.round(adrPrice / tickSize);

    // Current price and today's open
    const meta = chart30m.meta || chartDaily.meta || {};
    const currentPrice = meta.regularMarketPrice || dailyBars[dailyBars.length - 1].close;
    const todayBar = dailyBars[dailyBars.length - 1];
    const dailyOpen = todayBar.open;

    // Daily range levels
    const dailyRange = computeDailyRangeLevels(dailyOpen, adrTicks, tickSize);

    // Today's high/low for exhaustion
    const ts30 = chart30m.timestamp || [];
    const q30 = chart30m.indicators?.quote?.[0] || {};
    const nowEST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayStr = `${nowEST.getFullYear()}-${String(nowEST.getMonth() + 1).padStart(2, '0')}-${String(nowEST.getDate()).padStart(2, '0')}`;
    let todayHigh = todayBar.high, todayLow = todayBar.low;
    for (let i = 0; i < ts30.length; i++) {
      if (q30.high?.[i] != null && q30.low?.[i] != null) {
        const d = new Date(ts30[i] * 1000);
        const est = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const ds = `${est.getFullYear()}-${String(est.getMonth() + 1).padStart(2, '0')}-${String(est.getDate()).padStart(2, '0')}`;
        if (ds === todayStr) {
          todayHigh = Math.max(todayHigh, q30.high[i]);
          todayLow = Math.min(todayLow, q30.low[i]);
        }
      }
    }

    const dailyExhaustion = computeRangeExhaustion(dailyOpen, todayHigh, todayLow, adrTicks, tickSize);

    // Session ranges â compute ASR per session from intraday bars grouped by session
    const gmtNow = new Date();
    const gmtHour = gmtNow.getUTCHours();
    const currentSession = getBlahTechSession(gmtHour);

    // Group recent daily bars by session windows to compute per-session high/low
    // Use 30m bars for session-based ASR calculation
    const sessionBuckets = { TK: [], LN: [], NY: [] };
    const bars30m = [];
    for (let i = 0; i < ts30.length; i++) {
      if (q30.open?.[i] != null && q30.high?.[i] != null && q30.low?.[i] != null && q30.close?.[i] != null) {
        bars30m.push({ ts: ts30[i], open: q30.open[i], high: q30.high[i], low: q30.low[i], close: q30.close[i] });
      }
    }

    // Group bars by date and session
    const daySessionMap = {}; // { 'YYYY-MM-DD': { TK: {high, low}, LN: {high, low}, NY: {high, low} } }
    for (const bar of bars30m) {
      const d = new Date(bar.ts * 1000);
      const utcH = d.getUTCHours();
      const session = getBlahTechSession(utcH);
      const dateKey = d.toISOString().slice(0, 10);
      if (!daySessionMap[dateKey]) daySessionMap[dateKey] = {};
      if (!daySessionMap[dateKey][session]) daySessionMap[dateKey][session] = { high: -Infinity, low: Infinity, open: bar.open };
      daySessionMap[dateKey][session].high = Math.max(daySessionMap[dateKey][session].high, bar.high);
      daySessionMap[dateKey][session].low = Math.min(daySessionMap[dateKey][session].low, bar.low);
    }

    // Calculate ASR per session: average session range over available days
    const sessionRanges = {};
    for (const sess of ['TK', 'LN', 'NY']) {
      const ranges = [];
      for (const [dateKey, sessions] of Object.entries(daySessionMap)) {
        if (sessions[sess] && sessions[sess].high > -Infinity) {
          ranges.push(sessions[sess].high - sessions[sess].low);
        }
      }
      const asrPrice = ranges.length > 0 ? ranges.reduce((s, r) => s + r, 0) / ranges.length : 0;
      const asrTicks = Math.round(asrPrice / tickSize);
      sessionBuckets[sess] = { asrTicks, asrPrice: +asrPrice.toFixed(4), days: ranges.length };
    }

    // Current session open + levels
    const todayKey = gmtNow.toISOString().slice(0, 10);
    const todaySessionData = daySessionMap[todayKey] || {};
    const sessionLevels = {};
    for (const sess of ['TK', 'LN', 'NY']) {
      const sd = todaySessionData[sess];
      if (sd && sd.open && sessionBuckets[sess].asrTicks > 0) {
        const levels = computeSessionRangeLevels(sd.open, sessionBuckets[sess].asrTicks, tickSize);
        const exh = computeRangeExhaustion(sd.open, sd.high, sd.low, sessionBuckets[sess].asrTicks, tickSize);
        sessionLevels[sess] = { ...levels, exhaustion: exh, sessionHigh: +sd.high.toFixed(2), sessionLow: +sd.low.toFixed(2) };
      } else {
        sessionLevels[sess] = null;
      }
    }

    res.json({
      success: true,
      symbol: sym,
      tickSize,
      currentPrice: +currentPrice.toFixed(2),
      currentSession,
      daily: {
        ...dailyRange,
        exhaustion: dailyExhaustion,
        todayHigh: +todayHigh.toFixed(2),
        todayLow: +todayLow.toFixed(2),
        lookbackDays: recentDaily.length,
      },
      sessions: sessionLevels,
      sessionASR: sessionBuckets,
    });
  } catch (err) {
    console.error('ADR/ASR error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ââ /api/scanner â Multi-Instrument Scanner ââââââââââââââââââââââââââââââââââ
app.get('/api/scanner', async (req, res) => {
  const instruments = ['ES', 'NQ', 'DAX', 'XAU', 'OIL'];
  const TIMEOUT_MS = 15000;
  // Accept live prices forwarded from frontend: ?liveES=5900&liveNQ=21000 etc.
  const scannerLiveMap = { ES: req.query.liveES, NQ: req.query.liveNQ, GC: req.query.liveGC, CL: req.query.liveCL, XAU: req.query.liveGC, OIL: req.query.liveCL };

  const baseUrl = getInternalUrl(req);

  const scanOne = async (sym) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const lp = scannerLiveMap[sym];
      const url = `${baseUrl}/api/autosignal?symbol=${sym}${lp ? `&livePrice=${lp}` : ''}`;
      const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'AxiomScanner/1.0' } });
      clearTimeout(timer);
      const d = await r.json();
      if (!d.success) return { instrument: sym, error: d.error || 'Failed', signal: null };
      const s = d.signal || {};
      const du = d.data_used || {};
      return {
        instrument: sym,
        signal: s.signal || 'NO TRADE',
        playbook_selected: s.playbook_selected || s.playbook || null,
        playbook_path: s.playbook_path || null,
        confidence: s.confidence || null,
        target_r: s.target_r || null,
        direction: s.direction || null,
        ib_status: du.ib_status || null,
        session_active: s.session_active ?? null,
        adr_exhausted: du.adr_exhausted || false,
        vah: du.vah || null,
        val: du.val || null,
        current_price: du.current_price || null,
        stop: s.stop || null,
        target_1r: s.target_1r || null,
        reasoning: s.reasoning || null,
      };
    } catch (e) {
      clearTimeout(timer);
      return { instrument: sym, error: e.name === 'AbortError' ? 'Timeout (15s)' : e.message, signal: null };
    }
  };

  try {
    const results = await Promise.all(instruments.map(scanOne));
    const byInstrument = {};
    for (const r of results) byInstrument[r.instrument] = r;
    res.json({ success: true, results: byInstrument, ts: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ââ /api/journal â Trade Journal CRUD âââââââââââââââââââââââââââââââââââââââââ
const JOURNAL_FILE = path.join(__dirname, 'journal.json');

function readJournal() {
  try { return JSON.parse(fs.readFileSync(JOURNAL_FILE, 'utf8')); }
  catch { return []; }
}

function writeJournal(entries) {
  try { fs.writeFileSync(JOURNAL_FILE, JSON.stringify(entries, null, 2)); }
  catch (e) { console.error('Journal write error:', e.message); }
}

app.get('/api/journal', (req, res) => {
  const entries = readJournal().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ success: true, entries, count: entries.length });
});

app.post('/api/journal', (req, res) => {
  const d = req.body;
  if (!d.instrument || !d.direction) return res.status(400).json({ error: 'instrument and direction required' });
  const entry = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    date: d.date || new Date().toISOString().split('T')[0],
    time: d.time || new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }),
    instrument: d.instrument,
    playbook: d.playbook || null,
    direction: d.direction,
    entry_price: d.entry_price != null ? Number(d.entry_price) : null,
    stop_price: d.stop_price != null ? Number(d.stop_price) : null,
    target_price: d.target_price != null ? Number(d.target_price) : null,
    exit_price: d.exit_price != null ? Number(d.exit_price) : null,
    pnl_r: null,
    day_type: d.day_type || null,
    notes: d.notes || '',
    screenshot: d.screenshot || null,
    status: d.status || 'open',
    // Conviction fields (captured at trade-log time)
    conviction_label: d.conviction_label || null,
    conviction_score: d.conviction_score != null ? Number(d.conviction_score) : null,
    conviction_votes: d.conviction_votes || null,
    session_bias: d.session_bias || null,
    session_bias_confidence: d.session_bias_confidence != null ? Number(d.session_bias_confidence) : null,
    agent_verdict: null,
  };
  // Calculate PnL in R
  if (entry.exit_price != null && entry.entry_price != null && entry.stop_price != null) {
    const risk = Math.abs(entry.entry_price - entry.stop_price);
    if (risk > 0) {
      const pnl = entry.direction === 'LONG' ? entry.exit_price - entry.entry_price : entry.entry_price - entry.exit_price;
      entry.pnl_r = +(pnl / risk).toFixed(2);
    }
  }
  const entries = readJournal();
  entries.push(entry);
  writeJournal(entries);
  res.json({ success: true, entry });
});

app.put('/api/journal/:id', (req, res) => {
  const entries = readJournal();
  const idx = entries.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Entry not found' });
  const d = req.body;
  const entry = entries[idx];
  // Update allowed fields
  if (d.exit_price !== undefined) entry.exit_price = d.exit_price != null ? Number(d.exit_price) : null;
  if (d.notes !== undefined) entry.notes = d.notes;
  if (d.status !== undefined) entry.status = d.status;
  if (d.stop_price !== undefined) entry.stop_price = d.stop_price != null ? Number(d.stop_price) : null;
  if (d.target_price !== undefined) entry.target_price = d.target_price != null ? Number(d.target_price) : null;
  if (d.screenshot !== undefined) entry.screenshot = d.screenshot;
  // Conviction fields (can be set on create or update)
  if (d.conviction_label !== undefined) entry.conviction_label = d.conviction_label || null;
  if (d.conviction_score !== undefined) entry.conviction_score = d.conviction_score != null ? Number(d.conviction_score) : null;
  if (d.conviction_votes !== undefined) entry.conviction_votes = d.conviction_votes || null;
  if (d.session_bias !== undefined) entry.session_bias = d.session_bias || null;
  if (d.session_bias_confidence !== undefined) entry.session_bias_confidence = d.session_bias_confidence != null ? Number(d.session_bias_confidence) : null;
  // Recalculate PnL
  if (entry.exit_price != null && entry.entry_price != null && entry.stop_price != null) {
    const risk = Math.abs(entry.entry_price - entry.stop_price);
    if (risk > 0) {
      const pnl = entry.direction === 'LONG' ? entry.exit_price - entry.entry_price : entry.entry_price - entry.exit_price;
      entry.pnl_r = +(pnl / risk).toFixed(2);
      entry.status = 'closed';
      // Auto-calculate agent_verdict when closing a conviction-tracked trade
      const cl = entry.conviction_label;
      if (cl && cl !== 'NEUTRAL') {
        const positive = cl === 'CONFIRM' || cl === 'HIGH CONFIRM';
        const profitable = entry.pnl_r > 0;
        entry.agent_verdict = (positive === profitable) ? 'AGENTS RIGHT' : 'AGENTS WRONG';
      } else {
        entry.agent_verdict = 'NEUTRAL OUTCOME';
      }
    }
  }
  entries[idx] = entry;
  writeJournal(entries);
  res.json({ success: true, entry });
});

app.delete('/api/journal/:id', (req, res) => {
  let entries = readJournal();
  const len = entries.length;
  entries = entries.filter(e => e.id !== req.params.id);
  if (entries.length === len) return res.status(404).json({ error: 'Entry not found' });
  writeJournal(entries);
  res.json({ success: true });
});

// ── /api/setup-monitor — Conditional Setup Monitor ───────────────────────────
const SETUP_INSTRUMENTS = [
  { symbol: 'ES', ticker: 'ES=F' },
  { symbol: 'NQ', ticker: 'NQ=F' },
  { symbol: 'GC', ticker: 'GC=F' },
  { symbol: 'CL', ticker: 'CL=F' },
];

function getRTHWindow(symbol, date) {
  // date is a Date object at midnight UTC of the session date
  const month = date.getUTCMonth() + 1; // 1-12
  const offset = (month >= 3 && month <= 11) ? -4 : -5; // EDT / EST
  const windows = {
    ES: { startH: 9, startM: 30, endH: 16, endM: 0 },
    NQ: { startH: 9, startM: 30, endH: 16, endM: 0 },
    GC: { startH: 8, startM: 20, endH: 13, endM: 30 },
    CL: { startH: 9, startM: 0,  endH: 14, endM: 30 },
  };
  const w = windows[symbol] || windows.ES;
  const start = new Date(date);
  start.setUTCHours(w.startH - offset, w.startM, 0, 0);
  const end = new Date(date);
  end.setUTCHours(w.endH - offset, w.endM, 0, 0);
  return { start, end };
}

async function fetchInstrumentContext(symbol, ticker, livePriceOverride) {
  const now = new Date();
  const todayMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterdayMidnight = new Date(todayMidnight.getTime() - 86400000);
  const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

  // A) Fetch yesterday's 15-min bars for VA/POC
  const p1 = Math.floor(yesterdayMidnight.getTime() / 1000);
  const p2 = Math.floor(todayMidnight.getTime() / 1000);
  const yesterdayUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p1}&period2=${p2}&interval=15m`;
  const yRes = await fetch(yesterdayUrl, { headers });
  if (!yRes.ok) throw new Error(`Yahoo yesterday ${ticker} HTTP ${yRes.status}`);
  const yData = await yRes.json();
  const yChart = yData?.chart?.result?.[0];
  if (!yChart) throw new Error(`No yesterday chart data for ${ticker}`);
  const yTs = yChart.timestamp || [];
  const yQ = yChart.indicators?.quote?.[0] || {};

  // Filter to RTH bars only for volume profile
  const rthWindow = getRTHWindow(symbol, yesterdayMidnight);

  // Build volume profile and prev stats (RTH only)
  const volumeProfile = {};
  let prevHigh = -Infinity, prevLow = Infinity, prevClose = 0;
  for (let i = 0; i < yTs.length; i++) {
    const h = yQ.high?.[i], l = yQ.low?.[i], c = yQ.close?.[i], v = yQ.volume?.[i];
    if (h == null || l == null || c == null) continue;
    const barTime = new Date(yTs[i] * 1000);
    if (barTime < rthWindow.start || barTime >= rthWindow.end) continue;
    if (h > prevHigh) prevHigh = h;
    if (l < prevLow) prevLow = l;
    prevClose = c;
    const level = c.toFixed(2);
    volumeProfile[level] = (volumeProfile[level] || 0) + (v || 0);
  }

  // POC = highest volume price level
  const levels = Object.entries(volumeProfile).map(([p, v]) => ({ price: +p, vol: v }));
  levels.sort((a, b) => b.vol - a.vol);
  const totalVol = levels.reduce((s, l) => s + l.vol, 0);
  const poc = levels.length > 0 ? levels[0].price : prevClose;

  // Value Area: accumulate 70% of volume
  let accumulated = 0;
  const vaLevels = [];
  for (const l of levels) {
    vaLevels.push(l.price);
    accumulated += l.vol;
    if (accumulated >= totalVol * 0.7) break;
  }
  const vah = vaLevels.length > 0 ? +Math.max(...vaLevels).toFixed(2) : prevHigh;
  const val = vaLevels.length > 0 ? +Math.min(...vaLevels).toFixed(2) : prevLow;
  const prevAdr = +(prevHigh - prevLow).toFixed(2);

  // B) Fetch today's 1-min bars
  const p3 = p2; // today midnight
  const p4 = Math.floor(now.getTime() / 1000);
  const todayUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${p3}&period2=${p4}&interval=1m`;
  const tRes = await fetch(todayUrl, { headers });
  if (!tRes.ok) throw new Error(`Yahoo today ${ticker} HTTP ${tRes.status}`);
  const tData = await tRes.json();
  const tChart = tData?.chart?.result?.[0];
  const tTs = tChart?.timestamp || [];
  const tQ = tChart?.indicators?.quote?.[0] || {};

  // Filter today's bars to RTH only for open/session stats
  const todayRTH = getRTHWindow(symbol, todayMidnight);
  const ibEnd = new Date(todayRTH.start.getTime() + 60 * 60 * 1000); // RTH start + 60 min
  let todayOpen = null, sessionHigh = -Infinity, sessionLow = Infinity, currentPrice = null;
  let ibHigh = -Infinity, ibLow = Infinity;
  let hasIBBars = false;
  for (let i = 0; i < tTs.length; i++) {
    const h = tQ.high?.[i], l = tQ.low?.[i], c = tQ.close?.[i];
    if (h == null || l == null || c == null) continue;
    const barTime = new Date(tTs[i] * 1000);
    if (barTime < todayRTH.start || barTime >= todayRTH.end) continue;
    if (todayOpen === null) todayOpen = c;
    if (h > sessionHigh) sessionHigh = h;
    if (l < sessionLow) sessionLow = l;
    currentPrice = c;
    // IB bars: first 60 min of RTH
    if (barTime >= todayRTH.start && barTime < ibEnd) {
      hasIBBars = true;
      if (h > ibHigh) ibHigh = h;
      if (l < ibLow) ibLow = l;
    }
  }
  if (todayOpen === null) {
    // Pre-RTH: use yesterday's close
    todayOpen = prevClose;
    sessionHigh = prevClose;
    sessionLow = prevClose;
    currentPrice = prevClose;
  }
  // Override with live price from ProjectX when provided
  if (livePriceOverride) currentPrice = livePriceOverride;
  const ibComplete = now >= ibEnd;
  const ibMinutesRemaining = ibComplete ? 0 : Math.ceil((ibEnd.getTime() - now.getTime()) / 60000);
  const adrConsumedPct = prevAdr > 0 ? Math.round(((sessionHigh - sessionLow) / prevAdr) * 100) : 0;

  // Gap detection
  const gapSize = +(todayOpen - prevClose).toFixed(2);
  const gapType = todayOpen > prevHigh ? 'gap_up' : todayOpen < prevLow ? 'gap_down' : 'no_gap';
  const gapSizePctAdr = prevAdr > 0 ? +(Math.abs(gapSize) / prevAdr * 100).toFixed(1) : 0;

  // Open vs value area
  const openVsValue = todayOpen > vah ? 'above_vah' : todayOpen < val ? 'below_val' : 'inside_value';

  const dateStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  return {
    instrument: symbol,
    date: dateStr,
    session: 'RTH',
    prev: { high: +prevHigh.toFixed(2), low: +prevLow.toFixed(2), close: +prevClose.toFixed(2), vah, val, poc: +poc.toFixed(2), adr: prevAdr },
    today: {
      open: +todayOpen.toFixed(2),
      ib_high: hasIBBars ? +ibHigh.toFixed(2) : null,
      ib_low: hasIBBars ? +ibLow.toFixed(2) : null,
      ib_complete: ibComplete,
      ib_minutes_remaining: ibMinutesRemaining,
      adr_consumed_pct: adrConsumedPct,
      current_price: +currentPrice.toFixed(2), session_high: +sessionHigh.toFixed(2), session_low: +sessionLow.toFixed(2),
      gap: { type: gapType, size: gapSize, size_pct_adr: gapSizePctAdr },
      open_vs_value: openVsValue,
    },
  };
}

// ── Conviction scoring agent personas ─────────────────────────────────────────
const MACRO_SCORER_PERSONA = `You are the Macro Regime agent for the Axiom Terminal. Your job is to score a specific futures trading setup based purely on macro conditions: overnight news, economic calendar risk, VIX/risk sentiment, DXY direction, and whether the broad macro environment supports or fades the proposed trade direction. You receive a setup description and current market context. Respond ONLY with valid JSON, no markdown: {"vote": "CONFIRM|FADE|NEUTRAL", "confidence": <number 0-100>, "reason": "<one sentence max>"}`;

const TECHNICAL_SCORER_PERSONA = `You are the Technical Structure agent for the Axiom Terminal. Your job is to score a specific futures trading setup based purely on technical structure: price location relative to value area, key levels, gap fill probability, ADR remaining, prior day high/low, and whether the technical picture supports or fades the proposed trade direction. You receive a setup description and current market context. Respond ONLY with valid JSON, no markdown: {"vote": "CONFIRM|FADE|NEUTRAL", "confidence": <number 0-100>, "reason": "<one sentence max>"}`;

const ORDERFLOW_SCORER_PERSONA = `You are the Order Flow agent for the Axiom Terminal. Your job is to score a specific futures trading setup based on order flow logic: where stop clusters likely sit, liquidity pools, whether the setup direction is with or against likely institutional positioning, and sweep risk. You receive a setup description and current market context. Respond ONLY with valid JSON, no markdown: {"vote": "CONFIRM|FADE|NEUTRAL", "confidence": <number 0-100>, "reason": "<one sentence max>"}`;

// ── Shared single-agent caller (used by conviction scoring) ───────────────────
async function runAgentCall(persona, userContent) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      temperature: 0,
      system: `Today's date is ${todayDateStr()}.\n\n${persona}`,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}`);
  const d = await r.json();
  const text = (d?.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  return JSON.parse(text);
}

// ── scoreSetup — runs 3 scoring agents in parallel for one setup ──────────────
async function scoreSetup(setup, instrumentContext) {
  const brief = `SETUP TO SCORE:
Playbook: ${setup.playbook} — ${setup.name}
Direction: ${(setup.direction || '').toUpperCase()}
Trigger condition: ${setup.trigger_condition}
Targets: ${(setup.targets || []).join(', ')}
Invalidation: ${setup.invalidation}
Context already met: ${(setup.context_met || []).join('; ')}
Context not yet met: ${(setup.context_not_met || []).join('; ')}

INSTRUMENT CONTEXT:
Symbol: ${instrumentContext.instrument}
Open location: ${instrumentContext.open_location}
Day type hypothesis: ${instrumentContext.day_type_hypothesis}
ADR consumed: ${instrumentContext.adr_state?.consumed_pct ?? 'N/A'}%
Prior VAH: ${instrumentContext._context?.prev?.vah ?? 'N/A'}
Prior VAL: ${instrumentContext._context?.prev?.val ?? 'N/A'}
Prior POC: ${instrumentContext._context?.prev?.poc ?? 'N/A'}
Current price: ${instrumentContext._context?.today?.current_price ?? 'N/A'}
Session bias: ${instrumentContext.session_bias ?? 'N/A'}

Vote CONFIRM if macro/technical/order flow supports this setup.
Vote FADE if conditions actively oppose it.
Vote NEUTRAL if insufficient edge either way.`.trim();

  const [macroScore, techScore, flowScore] = await Promise.all([
    runAgentCall(MACRO_SCORER_PERSONA, brief),
    runAgentCall(TECHNICAL_SCORER_PERSONA, brief),
    runAgentCall(ORDERFLOW_SCORER_PERSONA, brief),
  ]);

  const votes = [macroScore.vote, techScore.vote, flowScore.vote];
  const confirms = votes.filter(v => v === 'CONFIRM').length;
  const fades    = votes.filter(v => v === 'FADE').length;
  const neutrals = votes.filter(v => v === 'NEUTRAL').length;
  const convictionScore = confirms - fades; // -3 to +3

  let convictionLabel;
  if (convictionScore >= 2)      convictionLabel = 'HIGH CONFIRM';
  else if (convictionScore === 1) convictionLabel = 'CONFIRM';
  else if (convictionScore === 0) convictionLabel = 'NEUTRAL';
  else if (convictionScore === -1) convictionLabel = 'FADE';
  else                            convictionLabel = 'STRONG FADE';

  return {
    conviction: convictionLabel,
    convictionScore,
    votes: { macro: macroScore, technical: techScore, orderFlow: flowScore },
    summary: `${confirms}✓ ${fades}✗ ${neutrals}—`,
  };
}

const SETUP_MONITOR_SYSTEM = `You are the Axiom Terminal setup monitor. You do NOT issue live buy/sell signals. Your job is to read pre-open market context, identify which Market Stalkers playbooks are structurally eligible, and output precise conditional trigger statements the trader watches for manually.

Respond ONLY with valid JSON — no markdown, no preamble.

Output schema:
{
  instrument, timestamp, open_location, day_type_hypothesis,
  adr_state: { consumed_pct, exhaustion, exhaustion_threshold: 80 },
  eligible_setups: [{
    playbook, name, direction, status,
    context_met: [],
    context_not_met: REQUIRED — always populate this array. List the specific conditions that are NOT yet met for the trigger to fire. This must always contain at least one item — the trigger candle itself has not formed yet so minimum entry is always 'Trigger candle not yet confirmed on current bar'. Other examples: 'IB not yet formed — wait until 10:30 EST', 'ADR exhaustion not yet confirmed — X% remaining to threshold', 'Price has not reached the extreme level yet — watching for test of [level]', 'Volume expansion not yet present on bounce attempt'. Never return an empty context_not_met array.,
    trigger_condition, targets: [], invalidation, notes
  }],
  no_trade_conditions: [],
  session_bias
}

open_location values: above_value | inside_value | below_value | above_prev_high | below_prev_low
day_type values: trend_day_long | trend_day_short | range_day | possible_range_day | rotation_day | gap_and_go | gap_and_fail
status values: forming | monitoring | triggered | invalidated
direction values: long | short

Playbook eligibility:

PB1 Trend Continuation: eligible when open inside/above value, ADR <60%. Trigger: 15-min close above IB high (long) or below IB low (short). Not eligible: ADR >80% or open >1 ATR outside value.

PB2 Gap Fill: eligible when today.gap.type is gap_up or gap_down (open outside previous day range entirely). Gap up → short fade back toward prev.high then prev.vah. Gap down → long fade back toward prev.low then prev.val. Trigger: first 15-min RTH candle that closes back inside the previous day range (below prev.high for gap up, above prev.low for gap down). Invalidation: gap extends further — new session high above open (gap up) or new session low below open (gap down). Not eligible: today.gap.type is no_gap.

PB3 Fade Exhaustion to Value: eligible when ADR consumed >= 70% OR price is within 0.5x ADR of prev day high or low. Open location does not need to be outside value — extreme ADR consumption alone qualifies. Long if price near prev low, short if price near prev high. Trigger: bullish/bearish engulfing candle at or near the extreme. Targets: VAL→POC→VAH (long) or VAH→POC→VAL (short). Not eligible: ADR < 50%.

PB4 Failed Auction: eligible when price has already tested and rejected VAH or VAL. Trigger: re-test with smaller range candle. Not eligible: first test of level.

Critical rules:
1. Never emit a signal — only state the trigger condition to watch for
2. Every setup must have an invalidation level
3. All price levels must come from the input — never invent levels
4. If no setup eligible, return eligible_setups: [] and explain in no_trade_conditions
5. If ADR near but below 80%, note how many % remain
6. If ADR consumed >= 80%, always evaluate PB3 as at minimum MONITORING status — never return eligible_setups: [] when ADR is exhausted unless price is already back inside the value area.
7. If today.ib_complete is false, any setup that references IB high or IB low as a trigger must include in context_not_met: 'IB not yet complete — {ib_minutes_remaining} minutes remaining (completes at RTH open + 60 min)'. PB1 triggers (IB breakout) cannot be FORMING until IB is complete — set to MONITORING only.`;

async function runSetupAnalysis(contextObj) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_KEY not set');
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0,
      system: `Today's date is ${todayDateStr()}. All analysis must be based on current conditions as of this date.\n\n${SETUP_MONITOR_SYSTEM}`,
      messages: [{ role: 'user', content: JSON.stringify(contextObj) }],
    }),
  });
  if (!aiRes.ok) {
    const errText = await aiRes.text();
    console.error('Setup monitor AI error:', aiRes.status, errText.slice(0, 300));
    throw new Error(`AI request failed: ${aiRes.status}`);
  }
  const aiData = await aiRes.json();
  let raw = aiData?.content?.[0]?.text || '{}';
  raw = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error('Setup monitor JSON parse error:', e.message, raw.slice(0, 200));
    return { instrument: contextObj.instrument, error: 'AI response not valid JSON', raw: raw.slice(0, 500), eligible_setups: [], no_trade_conditions: ['AI parse error'] };
  }
}

app.get('/api/setup-monitor', async (req, res) => {
  // Accept per-instrument live prices from ProjectX: ?liveES=5900&liveNQ=21000 etc.
  const livePriceMap = {
    ES: req.query.liveES ? parseFloat(req.query.liveES) : null,
    NQ: req.query.liveNQ ? parseFloat(req.query.liveNQ) : null,
    GC: req.query.liveGC ? parseFloat(req.query.liveGC) : null,
    CL: req.query.liveCL ? parseFloat(req.query.liveCL) : null,
  };
  try {
    const results = await Promise.allSettled(
      SETUP_INSTRUMENTS.map(async ({ symbol, ticker }) => {
        const context = await fetchInstrumentContext(symbol, ticker, livePriceMap[symbol] || null);
        const analysis = await runSetupAnalysis(context);
        const withContext = { ...analysis, _context: context };

        // ── Conviction scoring pass (Layer 2) ────────────────────────────────
        if (withContext.eligible_setups && withContext.eligible_setups.length > 0) {
          const scoredSetups = await Promise.all(
            withContext.eligible_setups.map(async (setup) => {
              try {
                const score = await scoreSetup(setup, withContext);
                return { ...setup, conviction: score };
              } catch (err) {
                console.warn(`Conviction scoring failed for ${symbol}/${setup.playbook}:`, err.message);
                return {
                  ...setup,
                  conviction: {
                    conviction: 'NEUTRAL',
                    convictionScore: 0,
                    votes: {},
                    summary: 'Scoring unavailable',
                  },
                };
              }
            })
          );
          withContext.eligible_setups = scoredSetups;
        }

        return withContext;
      })
    );
    const output = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        instrument: SETUP_INSTRUMENTS[i].symbol,
        error: r.reason?.message || 'Failed',
        eligible_setups: [],
        no_trade_conditions: ['Data fetch failed — check connection'],
      };
    });
    res.json({ setups: output, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error('Setup monitor error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── /api/session-bias — 4 Parallel AI Agents + Synthesizer ────────────────────

const SESSION_BIAS_AGENTS = {
  macro: {
    name: 'Macro Regime',
    system: `You are a macro regime analyst. Given overnight market data, determine the current macro regime and its directional bias for intraday futures trading. Consider:
- Overnight range direction and size relative to prior session
- VIX level and change (>20 = elevated fear, <15 = complacent)
- Bond yields (DXY/TLT direction)
- Gap direction and size vs ATR
- Any overnight session extremes (globex high/low vs prior RTH)

Respond ONLY with valid JSON — no markdown, no code fences:
{
  "regime": "RISK_ON" | "RISK_OFF" | "TRANSITIONAL" | "NEUTRAL",
  "bias": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "key_factors": ["<factor1>", "<factor2>", "<factor3>"],
  "vix_read": "<1 sentence VIX interpretation>",
  "overnight_read": "<1 sentence overnight action interpretation>",
  "reasoning": "<2-3 sentence macro thesis>"
}`,
  },
  technical: {
    name: 'Technical Structure',
    system: `You are a technical structure analyst for intraday futures. Given current price, Value Area (VAH/VAL/POC), QP levels, overnight range, and ATR data, determine the structural bias. Consider:
- Where price opens relative to yesterday's Value Area (Above/Inside/Below)
- Distance from key QP levels (QHi/QP/QMid/QLo) and which quartile price sits in
- Gap fill probability (gap into value = high fill probability)
- Overnight range as % of ADR (large = extension likely, small = rotation likely)
- Key levels above and below for targets/support

Respond ONLY with valid JSON — no markdown, no code fences:
{
  "structure": "TRENDING" | "ROTATIONAL" | "BREAKOUT" | "MEAN_REVERT",
  "bias": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "va_open": "ABOVE_VAH" | "INSIDE_VA" | "BELOW_VAL",
  "qp_position": "<which QP quartile price sits in>",
  "gap_analysis": "<gap direction, size, fill probability>",
  "key_levels_above": [<level1>, <level2>],
  "key_levels_below": [<level1>, <level2>],
  "reasoning": "<2-3 sentence structural thesis>"
}`,
  },
  flow: {
    name: 'Order Flow & Positioning',
    system: `You are a positioning and order flow analyst. Given the overnight range, prior session's value area, IB expectations, and ADR data, infer likely positioning and order flow dynamics. Consider:
- Where trapped traders likely are (overnight longs/shorts)
- Likely stop clusters (above overnight high, below overnight low, around VA edges)
- Expected IB behavior based on gap and overnight range
- ADR remaining capacity in each direction
- Session-specific flow patterns (e.g., London open drive, NY reversal)

Respond ONLY with valid JSON — no markdown, no code fences:
{
  "positioning": "LONG_HEAVY" | "SHORT_HEAVY" | "BALANCED" | "UNCLEAR",
  "bias": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "trapped_traders": "<where stops likely are>",
  "stop_clusters": {"above": [<level>], "below": [<level>]},
  "ib_expectation": "<expected IB behavior>",
  "adr_capacity": {"upside_pct": <number>, "downside_pct": <number>},
  "reasoning": "<2-3 sentence flow/positioning thesis>"
}`,
  },
  session: {
    name: 'Session Playbook',
    system: `You are a session playbook specialist for the Axiom Edge framework. Given all market context, determine which playbooks are most likely to trigger today and what the optimal session plan is. Consider:
- Gap direction + VA open → which playbooks are structurally eligible
- ADR capacity remaining → PB3 viability
- IB expectations → PB1 vs PB2 priority
- Day type expectation (trending vs rotational vs limited)
- Optimal DTTZ windows for entries

Respond ONLY with valid JSON — no markdown, no code fences:
{
  "primary_playbook": "PB1" | "PB2" | "PB3" | "PB4" | "NONE",
  "secondary_playbook": "PB1" | "PB2" | "PB3" | "PB4" | "NONE",
  "bias": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "day_type_expectation": "TRENDING" | "NORMAL_VARIATION" | "ROTATIONAL" | "LIMITED",
  "entry_windows": ["<window1>", "<window2>"],
  "watch_for": ["<trigger1>", "<trigger2>", "<trigger3>"],
  "avoid": ["<scenario1>"],
  "reasoning": "<2-3 sentence session game plan>"
}`,
  },
};

const SYNTHESIZER_SYSTEM = `You are the Axiom Session Bias Synthesizer. You receive analysis from 4 specialist agents — Macro Regime, Technical Structure, Order Flow, and Session Playbook. Your job is to synthesize their findings into a single unified pre-session bias.

Rules:
- If 3+ agents agree on direction → HIGH confidence composite bias
- If 2 agents agree, 2 disagree → MEDIUM confidence, note the conflict
- If no majority → LOW confidence, recommend reduced size or flat
- Always identify the PRIMARY risk scenario (what invalidates the bias)
- Provide a clear 1-sentence "bias statement" a trader can act on

Respond ONLY with valid JSON — no markdown, no code fences:
{
  "composite_bias": "BULLISH" | "BEARISH" | "NEUTRAL",
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "bias_statement": "<1 clear actionable sentence>",
  "agent_agreement": {
    "bullish_count": <0-4>,
    "bearish_count": <0-4>,
    "neutral_count": <0-4>
  },
  "primary_risk": "<what would invalidate this bias>",
  "key_level_bull": <price level that confirms bull case>,
  "key_level_bear": <price level that confirms bear case>,
  "size_recommendation": "FULL" | "REDUCED" | "FLAT",
  "session_plan": "<2-3 sentence synthesized game plan>",
  "conflicts": ["<any agent disagreements worth noting>"]
}`;

async function callBiasAgent(agentKey, systemPrompt, userPrompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      temperature: 0,
      system: `Today's date is ${todayDateStr()}.\n\n${systemPrompt}`,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${agentKey} agent: Anthropic ${res.status} — ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data?.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  return JSON.parse(text);
}

app.get('/api/session-bias', async (req, res) => {
  const sym = (req.query.symbol || 'ES').toUpperCase();
  const yahooSym = AUTO_SYMBOL_MAP[sym];
  if (!yahooSym) return res.status(400).json({ error: `Unknown symbol: ${sym}. Use ES/NQ/DAX/XAU/OIL` });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
  const sbLivePrice = req.query.livePrice ? parseFloat(req.query.livePrice) : null;

  const tick = TICK_SIZE[sym] || 0.25;

  try {
    // ── Step 1: Auto-fetch all market data from Yahoo Finance ──
    const [chart30m, chartDaily, liveData, vixData] = await Promise.all([
      yahooChart(yahooSym, '30m', '5d'),
      yahooChart(yahooSym, '1d', '3mo'),
      getLivePrice(sym === 'XAU' ? 'GC' : sym === 'OIL' ? 'CL' : sym, yahooSym),
      yahooQuote('^VIX').catch(() => ({ price: 0, chg: 0, pct: 0 })),
    ]);

    const meta = chart30m.meta || {};
    const currentPrice = sbLivePrice || liveData.price || meta.regularMarketPrice || 0;
    const sbPriceSource = sbLivePrice ? 'projectx' : (liveData.source || 'yahoo');

    // Build daily bars
    const tsD = chartDaily.timestamp || [];
    const qD = chartDaily.indicators?.quote?.[0] || {};
    const dailyBars = [];
    for (let i = 0; i < tsD.length; i++) {
      if (qD.open?.[i] != null && qD.high?.[i] != null && qD.low?.[i] != null && qD.close?.[i] != null) {
        dailyBars.push({ ts: tsD[i], open: qD.open[i], high: qD.high[i], low: qD.low[i], close: qD.close[i] });
      }
    }

    // Build 30m bars
    const ts30 = chart30m.timestamp || [];
    const q30 = chart30m.indicators?.quote?.[0] || {};
    const bars30m = [];
    for (let i = 0; i < ts30.length; i++) {
      if (q30.open?.[i] != null && q30.high?.[i] != null && q30.low?.[i] != null && q30.close?.[i] != null) {
        bars30m.push({ ts: ts30[i], open: q30.open[i], high: q30.high[i], low: q30.low[i], close: q30.close[i] });
      }
    }

    // ATR & ADR
    const atr14 = calcATR(dailyBars, 14);
    const adr20 = calcATR(dailyBars, 20);

    // Yesterday RTH bars for TPO Value Area
    const nowEST = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const todayStr = `${nowEST.getFullYear()}-${String(nowEST.getMonth() + 1).padStart(2, '0')}-${String(nowEST.getDate()).padStart(2, '0')}`;

    const yesterdayRTH = [];
    const todayBars = [];
    for (const bar of bars30m) {
      const d = new Date(bar.ts * 1000);
      const est = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const dateStr = `${est.getFullYear()}-${String(est.getMonth() + 1).padStart(2, '0')}-${String(est.getDate()).padStart(2, '0')}`;
      const hhmm = est.getHours() * 60 + est.getMinutes();
      if (dateStr === todayStr) {
        todayBars.push(bar);
      } else if (hhmm >= 570 && hhmm < 960) {
        yesterdayRTH.push(bar);
      }
    }
    // Keep only last day's RTH
    if (yesterdayRTH.length > 0) {
      const lastRTHDate = new Date(yesterdayRTH[yesterdayRTH.length - 1].ts * 1000)
        .toLocaleString('en-US', { timeZone: 'America/New_York' }).split(',')[0];
      const filtered = yesterdayRTH.filter(b => {
        const d = new Date(b.ts * 1000).toLocaleString('en-US', { timeZone: 'America/New_York' }).split(',')[0];
        return d === lastRTHDate;
      });
      yesterdayRTH.length = 0;
      yesterdayRTH.push(...filtered);
    }

    // Value Area
    const va = calcTPOValueArea(yesterdayRTH, tick);

    // QP levels
    const lastBar = dailyBars[dailyBars.length - 1];
    const lastDate = lastBar ? new Date(lastBar.ts * 1000) : new Date();
    const curQtr = Math.floor(lastDate.getMonth() / 3);
    const prevQtrEnd = new Date(lastDate.getFullYear(), curQtr * 3, 0);
    const prevQtrStart = new Date(prevQtrEnd.getFullYear(), prevQtrEnd.getMonth() - 2, 1);
    const qtrBars = dailyBars.filter(b => {
      const d = new Date(b.ts * 1000);
      return d >= prevQtrStart && d <= prevQtrEnd;
    });
    let d1Pivots = { qp: 0, qhi: 0, qmid: 0, qlo: 0 };
    if (qtrBars.length > 0) {
      const qHigh = Math.max(...qtrBars.map(b => b.high));
      const qLow = Math.min(...qtrBars.map(b => b.low));
      const qClose = qtrBars[qtrBars.length - 1].close;
      d1Pivots = calcQuarterlyPivots(qHigh, qLow, qClose);
    }

    // Overnight range (globex: today's bars before RTH open)
    const overnightBars = todayBars.filter(b => {
      const d = new Date(b.ts * 1000);
      const est = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      return est.getHours() * 60 + est.getMinutes() < 570; // before 9:30 ET
    });
    const overnightHigh = overnightBars.length > 0 ? Math.max(...overnightBars.map(b => b.high)) : null;
    const overnightLow = overnightBars.length > 0 ? Math.min(...overnightBars.map(b => b.low)) : null;

    // Prior session close
    const priorClose = dailyBars.length >= 2 ? dailyBars[dailyBars.length - 2].close : lastBar?.close || currentPrice;
    const priorHigh = dailyBars.length >= 2 ? dailyBars[dailyBars.length - 2].high : lastBar?.high || currentPrice;
    const priorLow = dailyBars.length >= 2 ? dailyBars[dailyBars.length - 2].low : lastBar?.low || currentPrice;

    // Gap
    const gap = currentPrice - priorClose;
    const gapPct = priorClose !== 0 ? (gap / priorClose) * 100 : 0;
    const gapVsATR = atr14 !== 0 ? Math.abs(gap) / atr14 : 0;

    // VA open position
    let vaOpen = 'Inside VA';
    if (currentPrice > va.vah) vaOpen = 'Above VAH';
    else if (currentPrice < va.val) vaOpen = 'Below VAL';

    // Trend from QP
    let trend = 'NEUTRAL';
    if (currentPrice > d1Pivots.qp && currentPrice > d1Pivots.qmid) trend = 'UP';
    else if (currentPrice < d1Pivots.qp && currentPrice < d1Pivots.qmid) trend = 'DOWN';

    // ADR remaining capacity
    const todayOpen = lastBar?.open || currentPrice;
    const upsidePct = adr20 > 0 ? +((currentPrice - todayOpen + (adr20 / 2)) / adr20 * 100).toFixed(0) : 50;
    const downsidePct = adr20 > 0 ? +((todayOpen - currentPrice + (adr20 / 2)) / adr20 * 100).toFixed(0) : 50;

    // Session info
    const session = getCurrentSession(sym);
    const ibStatus = getIBStatus(sym);
    const ibWindow = getIBWindow(sym);

    // ── Build context blob for all agents ──
    const contextBlob = {
      instrument: sym,
      current_price: +currentPrice.toFixed(2),
      price_source: sbPriceSource,
      prior_close: +priorClose.toFixed(2),
      prior_high: +priorHigh.toFixed(2),
      prior_low: +priorLow.toFixed(2),
      gap: +gap.toFixed(2),
      gap_pct: +gapPct.toFixed(3),
      gap_vs_atr: +gapVsATR.toFixed(2),
      overnight_high: overnightHigh ? +overnightHigh.toFixed(2) : null,
      overnight_low: overnightLow ? +overnightLow.toFixed(2) : null,
      overnight_range: overnightHigh && overnightLow ? +(overnightHigh - overnightLow).toFixed(2) : null,
      vah: va.vah, val: va.val, poc: va.poc,
      va_open: vaOpen,
      d1_qp: d1Pivots.qp, d1_qhi: d1Pivots.qhi, d1_qmid: d1Pivots.qmid, d1_qlo: d1Pivots.qlo,
      trend,
      atr14, adr20,
      adr_upside_capacity_pct: upsidePct,
      adr_downside_capacity_pct: downsidePct,
      vix: vixData.price, vix_chg: vixData.chg, vix_pct: +vixData.pct.toFixed(2),
      session, ib_status: ibStatus, ib_window: ibWindow.label,
      current_time_et: new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true }),
    };

    const contextPrompt = `INSTRUMENT: ${sym}
CURRENT PRICE: ${contextBlob.current_price} (${contextBlob.price_source})
PRIOR SESSION: Close ${contextBlob.prior_close} | High ${contextBlob.prior_high} | Low ${contextBlob.prior_low}
GAP: ${contextBlob.gap > 0 ? '+' : ''}${contextBlob.gap} (${contextBlob.gap_pct > 0 ? '+' : ''}${contextBlob.gap_pct}%) — ${contextBlob.gap_vs_atr.toFixed(2)}x ATR
OVERNIGHT RANGE: ${contextBlob.overnight_high || 'N/A'} / ${contextBlob.overnight_low || 'N/A'} (${contextBlob.overnight_range || 'N/A'} pts)
VALUE AREA (yesterday RTH): VAH ${contextBlob.vah} | POC ${contextBlob.poc} | VAL ${contextBlob.val}
VA OPEN: ${contextBlob.va_open}
QP LEVELS: QHi ${contextBlob.d1_qhi} | QP ${contextBlob.d1_qp} | QMid ${contextBlob.d1_qmid} | QLo ${contextBlob.d1_qlo}
TREND (QP): ${contextBlob.trend}
ATR(14): ${contextBlob.atr14} | ADR(20): ${contextBlob.adr20}
ADR CAPACITY: Upside ${contextBlob.adr_upside_capacity_pct}% | Downside ${contextBlob.adr_downside_capacity_pct}%
VIX: ${contextBlob.vix} (${contextBlob.vix_chg > 0 ? '+' : ''}${contextBlob.vix_chg}, ${contextBlob.vix_pct > 0 ? '+' : ''}${contextBlob.vix_pct}%)
SESSION: ${contextBlob.session} | IB: ${contextBlob.ib_status} (${contextBlob.ib_window})
TIME (ET): ${contextBlob.current_time_et}`;

    // ── Step 2: Fire all 4 agents in parallel (Promise.all) ──
    const agentKeys = Object.keys(SESSION_BIAS_AGENTS);
    const agentResults = {};
    const agentErrors = {};

    const settled = await Promise.allSettled(
      agentKeys.map(key =>
        callBiasAgent(key, SESSION_BIAS_AGENTS[key].system, contextPrompt)
          .then(result => ({ key, result }))
      )
    );

    for (const r of settled) {
      if (r.status === 'fulfilled') {
        agentResults[r.value.key] = r.value.result;
      } else {
        const key = agentKeys[settled.indexOf(r)];
        agentErrors[key] = r.reason?.message || 'Unknown error';
        console.error(`Session bias ${key} agent failed:`, r.reason?.message);
      }
    }

    // ── Step 3: Run the Synthesizer ──
    let synthesis = null;
    const successfulAgents = Object.keys(agentResults);
    if (successfulAgents.length >= 2) {
      const synthPrompt = `Here are the outputs from ${successfulAgents.length} specialist agents analysing ${sym}:

${successfulAgents.map(key => `### ${SESSION_BIAS_AGENTS[key].name} Agent
${JSON.stringify(agentResults[key], null, 2)}`).join('\n\n')}

${Object.keys(agentErrors).length > 0 ? `\nFAILED AGENTS: ${Object.keys(agentErrors).join(', ')} — factor the missing perspective into your confidence.\n` : ''}
MARKET CONTEXT:
${contextPrompt}

Synthesize these into a single unified session bias.`;

      try {
        synthesis = await callBiasAgent('synthesizer', SYNTHESIZER_SYSTEM, synthPrompt);
      } catch (e) {
        console.error('Synthesizer failed:', e.message);
        agentErrors.synthesizer = e.message;
      }
    } else {
      agentErrors.synthesizer = `Only ${successfulAgents.length} agents succeeded — need at least 2 for synthesis`;
    }

    // ── Step 4: Return everything ──
    res.json({
      success: true,
      symbol: sym,
      context: contextBlob,
      agents: {
        macro: agentResults.macro || null,
        technical: agentResults.technical || null,
        flow: agentResults.flow || null,
        session: agentResults.session || null,
      },
      synthesis,
      errors: Object.keys(agentErrors).length > 0 ? agentErrors : null,
      ts: new Date().toISOString(),
    });

  } catch (err) {
    console.error('Session bias error:', err);
    res.status(500).json({ error: err.message, symbol: sym });
  }
});

// ── POST /api/session-bias — 4-agent parallel bias analysis ──────────────────

const SB_TICKER_MAP = { ES: 'ES=F', NQ: 'NQ=F', GC: 'GC=F', CL: 'CL=F' };

// Agent personas — each returns { bias, confidence, keyLevel, reasoning, dayType }
const RETAIL_PERSONA = `You are a retail trader analyst. Analyse the market seed and assess what the majority of retail traders are likely doing: their bias, where they are positioned, and whether price will run stops or confirm their view. Respond ONLY with valid JSON, no markdown:
{"bias":"bullish|bearish|neutral","confidence":<0-100>,"keyLevel":"<price level>","reasoning":"<one sentence>","dayType":"<trending|range|gap_and_go|gap_and_fail|rotation>"}`;

const INSTITUTIONAL_PERSONA = `You are an institutional order flow analyst. Analyse the market seed from a large-player perspective: where institutions are likely accumulating or distributing, whether the overnight range represents a trap or genuine positioning, and what the smart-money bias is. Respond ONLY with valid JSON, no markdown:
{"bias":"bullish|bearish|neutral","confidence":<0-100>,"keyLevel":"<price level>","reasoning":"<one sentence>","dayType":"<trending|range|gap_and_go|gap_and_fail|rotation>"}`;

const ALGO_PERSONA = `You are an algorithmic trading systems analyst. Analyse the market seed from a systematic/quant perspective: momentum signals, mean-reversion probability, gap statistics, and whether price action favours trend-following or counter-trend algorithms today. Respond ONLY with valid JSON, no markdown:
{"bias":"bullish|bearish|neutral","confidence":<0-100>,"keyLevel":"<price level>","reasoning":"<one sentence>","dayType":"<trending|range|gap_and_go|gap_and_fail|rotation>"}`;

const MARKETMAKER_PERSONA = `You are a market-maker analyst. Analyse the market seed from a liquidity-provision perspective: where the highest liquidity pools sit, likely gamma/delta hedging flows, bid-ask dynamics around key levels, and whether market-makers will facilitate or resist the prevailing directional move. Respond ONLY with valid JSON, no markdown:
{"bias":"bullish|bearish|neutral","confidence":<0-100>,"keyLevel":"<price level>","reasoning":"<one sentence>","dayType":"<trending|range|gap_and_go|gap_and_fail|rotation>"}`;

const SB_SYNTHESIZER_SYSTEM = `You are the Axiom Session Bias Synthesizer. You receive analysis from 4 market-participant agents. Weight their views as follows: Institutional 40%, Algo 30%, MarketMaker 20%, Retail 10%. Produce a single weighted synthesis. Respond ONLY with valid JSON, no markdown:
{"finalBias":"bullish|bearish|neutral","confidence":<0-100>,"dayType":"<trending|range|gap_and_go|gap_and_fail|rotation>","keyLevel":"<most important price level>","riskWarning":"<one sentence on what invalidates the bias>","analysis":"<2-3 sentence synthesized view>"}`;

async function runSessionBiasAgent(persona, seed, temperature, maxTokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      temperature,
      system: `Today's date is ${todayDateStr()}.\n\n${persona}`,
      messages: [{ role: 'user', content: seed }],
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}`);
  const d = await r.json();
  const text = (d?.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  return JSON.parse(text);
}

app.post('/api/session-bias', async (req, res) => {
  const { instrument, newsContext, priorVAH, priorVAL, priorPOC } = req.body || {};
  if (!instrument) return res.status(400).json({ error: 'instrument required' });
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });

  const ticker = SB_TICKER_MAP[instrument.toUpperCase()];
  if (!ticker) return res.status(400).json({ error: `Unknown instrument: ${instrument}. Use ES/NQ/GC/CL` });

  try {
    // ── STEP 1: Fetch price data ─────────────────────────────────────────────
    const [chart1m, chartDaily] = await Promise.all([
      yahooChart(ticker, '1m', '1d'),
      yahooChart(ticker, '1d', '5d'),
    ]);

    // 1-min bars — current_price, today_open, overnight_high, overnight_low
    const ts1m = chart1m.timestamp || [];
    const q1m  = chart1m.indicators?.quote?.[0] || {};
    let todayOpen = null, overnightHigh = -Infinity, overnightLow = Infinity, currentPrice = null;
    for (let i = 0; i < ts1m.length; i++) {
      const c = q1m.close?.[i], h = q1m.high?.[i], l = q1m.low?.[i];
      if (c == null || h == null || l == null) continue;
      if (todayOpen === null) todayOpen = +c.toFixed(2);
      overnightHigh = Math.max(overnightHigh, h);
      overnightLow  = Math.min(overnightLow, l);
      currentPrice  = +c.toFixed(2);
    }
    // Fallback to meta if bars sparse
    if (currentPrice === null) currentPrice = +(chart1m.meta?.regularMarketPrice || 0).toFixed(2);
    if (todayOpen   === null) todayOpen = currentPrice;
    overnightHigh = overnightHigh === -Infinity ? null : +overnightHigh.toFixed(2);
    overnightLow  = overnightLow  ===  Infinity ? null : +overnightLow.toFixed(2);

    // Daily bars — prior_close, prior_high, prior_low (second-to-last complete day)
    const tsD = chartDaily.timestamp || [];
    const qD  = chartDaily.indicators?.quote?.[0] || {};
    const dailyBars = [];
    for (let i = 0; i < tsD.length; i++) {
      if (qD.open?.[i] != null && qD.close?.[i] != null) {
        dailyBars.push({ open: qD.open[i], high: qD.high[i], low: qD.low[i], close: qD.close[i] });
      }
    }
    const priorDay  = dailyBars.length >= 2 ? dailyBars[dailyBars.length - 2] : dailyBars[dailyBars.length - 1] || {};
    const priorClose = priorDay.close != null ? +priorDay.close.toFixed(2) : null;
    const priorHigh  = priorDay.high  != null ? +priorDay.high.toFixed(2)  : null;
    const priorLow   = priorDay.low   != null ? +priorDay.low.toFixed(2)   : null;
    const gap        = priorClose != null && todayOpen != null ? +(todayOpen - priorClose).toFixed(2) : null;

    const priceData = { currentPrice, todayOpen, overnightHigh, overnightLow, priorClose, priorHigh, priorLow, gap };

    // ── STEP 2: Build seed string ────────────────────────────────────────────
    const seed = `INSTRUMENT: ${instrument.toUpperCase()}
CURRENT PRICE: ${currentPrice}
TODAY OPEN: ${todayOpen}
GAP vs PRIOR CLOSE: ${gap != null ? (gap >= 0 ? '+' : '') + gap : 'N/A'} (prior close: ${priorClose ?? 'N/A'})
OVERNIGHT RANGE: ${overnightHigh ?? 'N/A'} / ${overnightLow ?? 'N/A'}
PRIOR DAY: High ${priorHigh ?? 'N/A'} | Low ${priorLow ?? 'N/A'} | Close ${priorClose ?? 'N/A'}
PRIOR VALUE AREA: VAH ${priorVAH ?? 'N/A'} | VAL ${priorVAL ?? 'N/A'} | POC ${priorPOC ?? 'N/A'}
NEWS CONTEXT: ${newsContext || 'None provided'}`.trim();

    // ── STEP 3: Run 4 agents in parallel ─────────────────────────────────────
    const [retail, institutional, algo, marketmaker] = await Promise.all([
      runSessionBiasAgent(RETAIL_PERSONA,        seed, 0.4, 500),
      runSessionBiasAgent(INSTITUTIONAL_PERSONA, seed, 0.4, 500),
      runSessionBiasAgent(ALGO_PERSONA,          seed, 0.4, 500),
      runSessionBiasAgent(MARKETMAKER_PERSONA,   seed, 0.4, 500),
    ]);

    const agentResults = { retail, institutional, algo, marketmaker };

    // ── STEP 4: Synthesizer ──────────────────────────────────────────────────
    const synthSeed = `${seed}

AGENT RESULTS:
Retail (10% weight): ${JSON.stringify(retail)}
Institutional (40% weight): ${JSON.stringify(institutional)}
Algo (30% weight): ${JSON.stringify(algo)}
MarketMaker (20% weight): ${JSON.stringify(marketmaker)}`;

    const synthesis = await runSessionBiasAgent(SB_SYNTHESIZER_SYSTEM, synthSeed, 0, 600);

    res.json({
      success: true,
      instrument: instrument.toUpperCase(),
      priceData,
      agentResults,
      synthesis,
      generated_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error('Session bias POST error:', err);
    res.status(500).json({ error: err.message, instrument });
  }
});

// ── ELEVENLABS TTS ────────────────────────────────────────────────────────────

app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });
    if (!process.env.ELEVENLABS_API_KEY) return res.status(500).json({ error: 'ElevenLabs not configured' });

    // Lily — Velvety, confident British female voice
    const VOICE_ID = 'pFZP5JQG7iQjIQuC4Bku';

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: text.substring(0, 1000),
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('ElevenLabs error:', err);
      return res.status(500).json({ error: 'TTS failed', detail: err });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Access-Control-Allow-Origin', '*');
    response.body.pipe(res);

  } catch (err) {
    console.error('TTS error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── PROJECTX / TOPSTEPX AUTH ──────────────────────────────────────────────────

app.post('/api/projectx/token', async (req, res) => {
  try {
    const { username, apiKey } = req.body;
    if (!username || !apiKey) {
      return res.status(400).json({ error: 'username and apiKey are required' });
    }
    const r = await fetch('https://api.topstepx.com/api/Auth/loginKey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ userName: username, apiKey }),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('ProjectX auth error:', r.status, data);
      return res.status(r.status).json({ error: data?.message || `Auth failed: ${r.status}` });
    }
    const token = data.token || data.accessToken || data.jwt || data.data?.token;
    if (!token) {
      console.error('ProjectX: no token in response', data);
      return res.status(502).json({ error: 'No token in ProjectX response', raw: data });
    }
    res.json({ token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 });
  } catch (err) {
    console.error('ProjectX token error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projectx/validate', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'token is required' });
    const r = await fetch('https://api.topstepx.com/api/Auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ token }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.message || `Validate failed: ${r.status}` });
    const newToken = data.token || data.accessToken || data.jwt || data.data?.token || token;
    res.json({ token: newToken, expiresAt: Date.now() + 23 * 60 * 60 * 1000 });
  } catch (err) {
    console.error('ProjectX validate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── TRADING BUDDY ─────────────────────────────────────────────────────────────

const TRADING_BUDDY_SYSTEM = `You are the Axiom Trading Buddy — a sharp, experienced futures trader and desk partner using the Market Stalkers (MS) methodology. You are sitting alongside the trader during their live session.

You have full awareness of:
- Current session bias and day type classification
- Active playbook setups (PB1-PB4) and their conviction scores
- Live price relative to value area (VAH/VAL/POC)
- ADR consumed, IB status, key levels, VIX

Your role:
- Be a real-time sounding board for the trader's ideas
- Answer "if this then that" questions with precise MS methodology logic
- Give honest opinions when asked — including telling them to stand aside
- Flag risks the trader may be overlooking
- Confirm or challenge their read using the session context you have
- Reference specific levels from the context in your answers
- Keep responses concise and actionable — this is a live session, not a lecture
- NEVER give generic advice. Always reference the actual levels, setups, and context from the session data provided

Tone: direct, confident, collegial. Like a senior trader sitting next to you. No fluff. No disclaimers. Real desk talk.

You receive the full session context in every message. Use it.`;

app.post('/api/trading-chat', async (req, res) => {
  try {
    const { messages, sessionContext } = req.body;

    const contextBlock = `
LIVE SESSION CONTEXT (${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET):
Instrument: ${sessionContext.instrument} | Price: ${sessionContext.currentPrice}
Session Bias: ${sessionContext.sessionBias?.toUpperCase()} | Day Type: ${sessionContext.dayType}
Gap: ${sessionContext.gap} | VAH: ${sessionContext.vah} | POC: ${sessionContext.poc} | VAL: ${sessionContext.val}
ADR Consumed: ${sessionContext.adrConsumed}% | IB: ${sessionContext.ibStatus} | VIX: ${sessionContext.vix}
Key Watch Level: ${sessionContext.keyLevel}
Active Setups: ${sessionContext.activeSetups?.length
  ? sessionContext.activeSetups.map(s =>
      `${s.playbook} ${s.name} (${s.direction?.toUpperCase()}) — ${s.conviction?.conviction || 'unscored'} — Trigger: ${s.trigger_condition}`
    ).join(' | ')
  : 'None identified'
}`.trim();

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 400,
        temperature: 0.7,
        system: TRADING_BUDDY_SYSTEM + '\n\n' + contextBlock,
        messages: messages,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Trading chat Anthropic error:', aiRes.status, errText);
      return res.status(502).json({ error: `Anthropic ${aiRes.status}: ${errText.slice(0, 200)}` });
    }

    const data = await aiRes.json();
    res.json({
      reply: data.content[0].text,
      usage: data.usage,
    });
  } catch (err) {
    console.error('Trading chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  if (!res.headersSent) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Axiom Backend running on port ${PORT}`);
  console.log(`   /api/news    — Reuters, CNBC, MarketWatch, Yahoo Finance RSS`);
  console.log(`   /api/market  — VIX, ES, NQ, GC, CL (dxFeed → Yahoo fallback) + ETFs`);
  console.log(`   /api/macro   — 10Y Treasury (Yahoo Finance)${FRED_KEY ? ' + 2Y/FFR (FRED)' : ''}`);
  console.log(`   /api/ai      — Claude streaming proxy (key: ${ANTHROPIC_KEY ? '✓ set' : '✗ MISSING'})`);
  console.log(`   /api/signals — Axiom Edge AI Signal Analyser`);
  console.log(`   /api/autosignal — Axiom Edge Auto Signal (ES/NQ/DAX/XAU/OIL)`);
  console.log(`   /api/analyse-chart — Chart Screenshot Analyser (Vision)`);
  console.log(`   /api/journal     — Trade Journal CRUD`);
  console.log(`   /api/scanner     — Multi-Instrument Scanner (ES/NQ/DAX/XAU/OIL)`);
  console.log(`   /api/setup-monitor — Conditional Setup Monitor (ES/NQ/GC/CL)`);
  console.log(`   /api/session-bias — 4-Agent Session Bias Synthesizer (ES/NQ/DAX/XAU/OIL)`);
  console.log(`   /api/tpo         — TPO Value Area Calculator (yesterday RTH)`);
  console.log(`   /api/qp-calculate — D1 Q Point Calculator (swing quartiles)`);
  console.log(`   /api/adr-asr     — Blahtech ADR/ASR Target Levels (ES/NQ/YM/FDXM)`);
  if (!FRED_KEY) {
    console.log(`\n   â   FRED_API_KEY not set â 2Y Treasury & Fed Funds will use static fallback`);
    console.log(`      Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html`);
  }
  console.log('');
});

