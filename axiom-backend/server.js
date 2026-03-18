// Env vars provided by Railway (locally, use .env with dotenv)
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const RSSParser = require('rss-parser');

const app = express();
const PORT = process.env.PORT || 3001;
const FRED_KEY = process.env.FRED_API_KEY;

// ── HEALTH ROUTES (before any middleware) ─────────────────────────────────────
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
app.use(express.json());

const rss = new RSSParser({
  timeout: 10000,
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  customFields: { item: ['media:content', 'media:thumbnail'] },
});

// ── KEYWORD AUTO-TAGGING ───────────────────────────────────────────────────────
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

// ── RSS FEEDS ─────────────────────────────────────────────────────────────────
const RSS_FEEDS = [
  { url: 'https://feeds.reuters.com/reuters/businessNews', source: 'RTR' },
  { url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', source: 'CNBC' },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', source: 'MW' },
  { url: 'https://finance.yahoo.com/news/rssindex', source: 'YF' },
];

// ── /api/news ─────────────────────────────────────────────────────────────────
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

// ── YAHOO FINANCE HELPER ──────────────────────────────────────────────────────
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

// ── /api/market — VIX, ES, NQ + ETFs (SPY/QQQ/IWM/GLD/TLT) ──────────────────
const ETF_SYMBOLS = [
  { sym: 'SPY', name: 'S&P 500 ETF',        yahoo: 'SPY'  },
  { sym: 'QQQ', name: 'Nasdaq 100 ETF',     yahoo: 'QQQ'  },
  { sym: 'IWM', name: 'Russell 2000 ETF',   yahoo: 'IWM'  },
  { sym: 'GLD', name: 'Gold ETF',           yahoo: 'GLD'  },
  { sym: 'TLT', name: '20Y Treasury ETF',   yahoo: 'TLT'  },
];

app.get('/api/market', async (req, res) => {
  try {
    const [vixR, esR, nqR, ...etfResults] = await Promise.allSettled([
      yahooQuote('^VIX'),
      yahooQuote('ES=F'),
      yahooQuote('NQ=F'),
      ...ETF_SYMBOLS.map(e => yahooQuote(e.yahoo)),
    ]);

    const etfs = ETF_SYMBOLS.map((meta, i) => ({
      sym:  meta.sym,
      name: meta.name,
      ...(etfResults[i].status === 'fulfilled'
        ? etfResults[i].value
        : { price: 0, chg: 0, pct: 0, prev: 0 }),
    }));

    const data = {
      vix:  vixR.status === 'fulfilled' ? { symbol: 'VIX', ...vixR.value } : null,
      es:   esR.status  === 'fulfilled' ? { symbol: 'ES',  ...esR.value  } : null,
      nq:   nqR.status  === 'fulfilled' ? { symbol: 'NQ',  ...nqR.value  } : null,
      etfs,
    };

    if (!data.vix && !data.es && !data.nq && etfs.every(e => e.price === 0)) {
      throw new Error('All Yahoo Finance sources failed');
    }

    if (vixR.status === 'rejected') console.warn('VIX failed:', vixR.reason?.message);
    if (esR.status  === 'rejected') console.warn('ES failed:',  esR.reason?.message);
    if (nqR.status  === 'rejected') console.warn('NQ failed:',  nqR.reason?.message);

    res.json({ success: true, data, ts: new Date().toISOString() });
  } catch (err) {
    console.error('Market error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── /api/futures (legacy endpoint — kept for compatibility) ───────────────────
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

// ── FRED HELPER ───────────────────────────────────────────────────────────────
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

// ── /api/macro — 10Y, 2Y Treasuries, Fed Funds ───────────────────────────────
app.get('/api/macro', async (req, res) => {
  try {
    const macro = {};

    // 10Y Treasury from Yahoo Finance (^TNX, no key needed)
    try {
      const tnx = await yahooQuote('^TNX');
      macro['10Y Treasury'] = {
        value: `${tnx.price.toFixed(2)}%`,
        prev: `${tnx.prev.toFixed(2)}%`,
        trend: tnx.chg > 0.01 ? 'up' : tnx.chg < -0.01 ? 'down' : 'neutral',
        next: 'Live',
        live: true,
      };
    } catch (e) { console.warn('10Y Yahoo failed:', e.message); }

    // 2Y Treasury from FRED (requires FRED_API_KEY)
    try {
      const obs = await fredSeries('DGS2');
      if (obs) {
        const cur = parseFloat(obs[0].value);
        const prev = obs[1] ? parseFloat(obs[1].value) : cur;
        macro['2Y Treasury'] = {
          value: `${cur.toFixed(2)}%`,
          prev: `${prev.toFixed(2)}%`,
          trend: cur > prev + 0.01 ? 'up' : cur < prev - 0.01 ? 'down' : 'neutral',
          next: 'Live',
          live: true,
        };
      }
    } catch (e) { console.warn('2Y FRED failed:', e.message); }

    // Fed Funds Rate from FRED (requires FRED_API_KEY)
    try {
      const obs = await fredSeries('FEDFUNDS');
      if (obs) {
        const cur = parseFloat(obs[0].value);
        const prev = obs[1] ? parseFloat(obs[1].value) : cur;
        macro['Fed Funds Rate'] = {
          value: `${cur.toFixed(2)}%`,
          prev: `${prev.toFixed(2)}%`,
          trend: cur > prev + 0.01 ? 'up' : cur < prev - 0.01 ? 'down' : 'neutral',
          next: 'Live',
          live: true,
        };
      }
    } catch (e) { console.warn('Fed Funds FRED failed:', e.message); }

    res.json({ success: true, data: macro, fredEnabled: !!FRED_KEY });
  } catch (err) {
    console.error('Macro error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── /api/ai — Claude streaming proxy ─────────────────────────────────────────
// Keeps the Anthropic key server-side; streams SSE back to the browser.
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const DEFAULT_SYSTEM = "You are a senior macro strategist and options trader at a top hedge fund. Provide sharp, data-driven market commentary in Bloomberg terminal style. Use specific numbers. Format with ALL CAPS headers. Under 300 words.";

app.post('/api/ai', async (req, res) => {
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY not set in backend .env' });
  }

  const { prompt, systemPrompt, maxTokens = 1000 } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });

  // SSE headers — forward the raw Anthropic stream to the browser
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
        system: systemPrompt || DEFAULT_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error('Anthropic error:', aiRes.status, errText);
      res.write(`data: {"type":"error","message":"Anthropic ${aiRes.status}"}\n\n`);
      return res.end();
    }

    // node-fetch v2: response.body is a Node.js Readable stream — pipe it straight through
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

// ── /api/signals — Market Stalkers AI Signal Analyser ─────────────────────────
const SIGNALS_SYSTEM = `You are a Market Stalkers signal analyser. You apply the Market Stalkers playbook method exactly as defined below. You MUST respond ONLY with valid JSON — no markdown, no code fences, no extra text.

## PLAYBOOKS

**PB1 — With the Trend (Trend Continuation)**
Requirements: Higher-timeframe trend confirmed (D1/H4 making HH/HL or LH/LL). Price opened on the trend side of Value Area (above VAH for longs, below VAL for shorts). IB (8:00-9:00am EST) extended in the trend direction. H4 conterminous supply/demand zone aligns at VAH/VAL (tolerance: 5-10 ticks / 1-2 points). M30 trigger pattern present: Phase 1 (bullish engulf OR consolidation breaking above swing high) for longs, Phase 3 (3-bar reversal pattern) for shorts. Session must be NY DRF (10:00am EST) or NY Close (4:00pm EST). Target: 2-3R minimum.

**PB2 — Return to VAH/VAL**
Requirements: Trend confirmed but price opened inside VA. QHi or QLo recently rejected (price tested and bounced). Conterminous H4 supply/demand at target VAH/VAL (tolerance: 5-10 ticks / 1-2 points). M30 trigger present (Phase 1 for long to VAH, Phase 3 for short to VAL). Session check: NY DRF or NY Close. Target: VAH or VAL (typically 2R).

**PB3 — Countertrend ADR Exhaustion (Intraday)**
Requirements: Price has moved >= 80% of ADR (20-day True Range average). 3/3 trend exhaustion check: D1 overextended, H4 losing momentum, M30 showing reversal. D1 engulfing pattern forming or completed. Phase 1 or Phase 3 trigger on M15/M30/H4. HALF SIZE — countertrend. Target: VWAP or POC (not full VA). Minimum 1.5:1 R:R.

**PB4 — Countertrend Swing / Intraday**
Requirements: D1 QHi or QLo rejection (price tested quarterly extreme and reversed). IB extended against the trend. D1 engulfing candle forming. Price returning to VAH/VAL as target. Can be swing (multi-day, 3-5R target) or intraday (same day, 2R target). Phase 1 or Phase 3 trigger required.

## PARAMETERS
- Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL
- Phase 1 (bullish trigger): bullish engulf OR consolidation breaking above swing high on M15/M30/H4
- Phase 3 (bearish trigger): 3-bar reversal pattern on M15/M30/H4
- IB = Initial Balance = 8:00-9:00am EST (first 60 min NY session)
- Active sessions: NY DRF (10:00am EST) · NY Close (4:00pm EST)
- 1R = D1 14-period ATR
- ADR = 20-day True Range average
- VA = TPO-based Value Area (time/Market Profile letters)
- Stop distance = 1x ATR from entry (entry = current price unless otherwise specified)

## RESPONSE FORMAT
Respond with ONLY this JSON object (no markdown, no code fences):
{
  "playbook": "PB1" or "PB2" or "PB3" or "PB4" or "NO TRADE",
  "signal": "LONG" or "SHORT" or "NO TRADE",
  "direction": "With Trend" or "Countertrend Intraday" or "Countertrend Swing" or "None",
  "target_r": "2R" or "2-3R" or "3-5R" or "None",
  "stop": <number - calculated stop price>,
  "target_1": <number - 1R target price>,
  "target_2": <number - 2R target price>,
  "target_3": <number - 3R target price>,
  "criteria": [
    {"condition": "<description>", "met": true/false},
    ...check ALL conditions for the most relevant playbook...
  ],
  "reasoning": "<2-3 sentence explanation of why this signal was chosen or why NO TRADE>"
}`;

app.post('/api/signals', async (req, res) => {
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY not set' });
  }

  const data = req.body;
  if (!data || !data.instrument || !data.currentPrice) {
    return res.status(400).json({ error: 'instrument and currentPrice are required' });
  }

  const userPrompt = `Analyse this market setup and determine the correct Market Stalkers playbook signal:

INSTRUMENT: ${data.instrument}
CURRENT PRICE: ${data.currentPrice}
D1 ATR (14-period, 20-day TR): ${data.atr || 'Not provided'}

VALUE AREA (TPO-based):
- VAH: ${data.vah || 'Not provided'}
- VAL: ${data.val || 'Not provided'}
- VA Open Position: ${data.vaOpen || 'Not provided'}

QUARTERLY PIVOTS:
- D1 QP: ${data.d1QP || 'N/A'} | D1 QHi: ${data.d1QHi || 'N/A'} | D1 QMid: ${data.d1QMid || 'N/A'} | D1 QLo: ${data.d1QLo || 'N/A'}
- H4 QP: ${data.h4QP || 'N/A'} | H4 QHi: ${data.h4QHi || 'N/A'} | H4 QMid: ${data.h4QMid || 'N/A'} | H4 QLo: ${data.h4QLo || 'N/A'}

INITIAL BALANCE (8:00-9:00am EST):
- IB High: ${data.ibHigh || 'N/A'}
- IB Low: ${data.ibLow || 'N/A'}

TREND: ${data.trend || 'Not provided'}
M30 PATTERN: ${data.m30Pattern || 'None'}
ADR EXHAUSTED (>= 80% of 20-day TR): ${data.adrExhausted ? 'YES' : 'NO'}

Calculate stop and targets using the ATR value provided. Apply the playbook rules strictly. If conditions are not met for any playbook, signal NO TRADE.`;

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
        system: SIGNALS_SYSTEM,
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

    // Parse the JSON response — strip markdown fences if present
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
  console.log(`   /api/market  — VIX, ES Futures, NQ Futures (Yahoo Finance)`);
  console.log(`   /api/macro   — 10Y Treasury (Yahoo Finance)${FRED_KEY ? ' + 2Y/FFR (FRED)' : ''}`);
  console.log(`   /api/ai      — Claude streaming proxy (key: ${ANTHROPIC_KEY ? '✓ set' : '✗ MISSING'})`);
  console.log(`   /api/signals — Market Stalkers AI Signal Analyser`);
  if (!FRED_KEY) {
    console.log(`\n   ⚠  FRED_API_KEY not set — 2Y Treasury & Fed Funds will use static fallback`);
    console.log(`      Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html`);
  }
  console.log('');
});
