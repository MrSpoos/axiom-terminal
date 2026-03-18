require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const RSSParser = require('rss-parser');

const app = express();
const PORT = process.env.PORT || 3001;
const FRED_KEY = process.env.FRED_API_KEY;

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, Railway health checks)
    if (!origin) return cb(null, true);
    // Allow any Vercel deployment, localhost on any port
    if (/\.vercel\.app$/.test(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    cb(new Error(`CORS: ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false,
}));
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

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'axiom-backend' });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    ts: new Date().toISOString(),
    fredEnabled: !!FRED_KEY,
    aiEnabled: !!ANTHROPIC_KEY,
  });
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
  if (!FRED_KEY) {
    console.log(`\n   ⚠  FRED_API_KEY not set — 2Y Treasury & Fed Funds will use static fallback`);
    console.log(`      Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html`);
  }
  console.log('');
});
