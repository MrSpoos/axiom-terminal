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
app.use(express.json({ limit: '10mb' }));

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

// ── /api/macro — Full economic indicators ────────────────────────────────────
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

// Helper: fetch Yahoo Finance rate (for treasury yields — no API key needed)
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

    // All fetches in parallel — each wrapped in try/catch so one failure doesn't kill the rest
    const jobs = [
      // 10Y Treasury — Yahoo (^TNX) primary, FRED (DGS10) fallback
      (async () => {
        try { macro['10Y Treasury'] = await yahooMacro('^TNX'); }
        catch { try { const m = await fredMacro('DGS10', '10Y'); if (m) macro['10Y Treasury'] = m; } catch (e) { console.warn('10Y failed:', e.message); } }
      })(),
      // 2Y Treasury — FRED (DGS2) primary, Yahoo (^TYX is 30Y so skip)
      (async () => {
        try { const m = await fredMacro('DGS2'); if (m) macro['2Y Treasury'] = m; }
        catch (e) { console.warn('2Y failed:', e.message); }
      })(),
      // Fed Funds Rate — FRED (FEDFUNDS)
      (async () => {
        try { const m = await fredMacro('FEDFUNDS'); if (m) macro['Fed Funds Rate'] = m; }
        catch (e) { console.warn('Fed Funds failed:', e.message); }
      })(),
      // CPI YoY — FRED (CPIAUCSL) — value is index, need YoY calc
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
      // Core PCE — FRED (PCEPILFE)
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
      // Unemployment — FRED (UNRATE)
      (async () => {
        try { const m = await fredMacro('UNRATE'); if (m) macro['Unemployment'] = m; }
        catch (e) { console.warn('Unemployment failed:', e.message); }
      })(),
      // GDP Growth — FRED (A191RL1Q225SBEA = Real GDP % change)
      (async () => {
        try {
          const m = await fredMacro('A191RL1Q225SBEA', 'GDP', v => `${v.toFixed(1)}%`);
          if (m) macro['GDP Growth (Q4)'] = m;
        } catch (e) { console.warn('GDP failed:', e.message); }
      })(),
      // ISM Manufacturing — try multiple FRED series (NAPM discontinued, try alternatives)
      (async () => {
        const seriesIds = ['NAPM', 'MANEMP', 'AMTMNO'];
        for (const sid of seriesIds) {
          try {
            const fmt = sid === 'MANEMP' ? (v => `${(v/1000).toFixed(0)}K`) : (v => v.toFixed(1));
            const m = await fredMacro(sid, 'ISM', fmt);
            if (m) { macro['ISM Manuf.'] = m; return; }
          } catch {}
        }
        // All failed — show N/A gracefully
        macro['ISM Manuf.'] = { value: 'N/A', prev: 'N/A', trend: 'neutral', next: '—', live: false };
      })(),
    ];

    await Promise.allSettled(jobs);

    res.json({ success: true, data: macro, fredEnabled: !!FRED_KEY, ts: new Date().toISOString() });
  } catch (err) {
    console.error('Macro error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── /api/ai — Claude streaming proxy ─────────────────────────────────────────
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

// ── /api/signals — Axiom Edge AI Signal Analyser ─────────────────────────────
// Shared system prompt for both /api/signals and /api/autosignal
const AXIOM_EDGE_SYSTEM = `You are the Axiom Edge signal engine. You evaluate market conditions against 4 specific playbooks in strict order. Each playbook has completely separate criteria, targets, and session rules. NEVER mix criteria between playbooks. Respond ONLY with valid JSON — no markdown, no code fences, no extra text.

TRADER PROFILE:
- Instruments: ES, NQ, DAX, Gold (XAU), Oil (CL)
- Value Area: TPO-based (Market Profile time letters)
- ADR: 20-day True Range average
- 1R = 14-period ATR on D1
- IB windows: ES/NQ = 9:30\u201310:30am ET | DAX = 9:00\u201310:00am CET | Gold = 8:20\u20139:20am ET | Oil = 9:00\u201310:00am ET
- Active sessions: NY DRF 10:00am ET \u00b7 NY Close 4:00pm ET
- Phase 1 (bullish trigger): Bullish engulf OR consolidation breaking above swing high on M15/M30/H4
- Phase 3 (bearish trigger): 3-bar reversal pattern on M15/M30/H4
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

H4 ZONE DATA \u2014 AUTO-DETECTED:
- h4_supply_nearest: nearest supply zone level above current price
- h4_demand_nearest: nearest demand zone level below current price
- h4_supply_zones: array of all detected supply zones [{level, low, high, strength}]
- h4_demand_zones: array of all detected demand zones [{level, low, high, strength}]
Use h4_supply_nearest and h4_demand_nearest as the reference levels for conterminous checks and entry zone targeting.

STEP 1 \u2014 DETERMINE IB STATUS
Check current ET time against instrument IB window:
- BEFORE IB window opens \u2192 ib_status: "not_started"
- DURING IB window \u2192 ib_status: "forming" (show current H/L so far)
- AFTER IB window closes \u2192 ib_status: "set" (use confirmed H/L)

STEP 2 \u2014 EVALUATE PLAYBOOKS IN THIS EXACT ORDER

PLAYBOOK #2 \u2014 WITH THE TREND \u2014 RETURN TO VAH/VAL
IB REQUIREMENT: NONE \u2014 PB2 can fire from the open, even before IB forms.
SESSION: Must be in NY DRF (10am ET) or NY Close (4pm ET) window.
NOTE: PB2 fires BEFORE checking PB1. Evaluate it first, always.

PB2 UPTREND path (Open Above VAH):
1. Trend UP confirmed (price above D1 QP + QMid \u2014 upper half of swing range)
2. Value Area Open = ABOVE VAH
3. H4 or D1 QP level \u2014 ONLY qualifies if price RECENTLY REJECTED QLo (within last 3\u20135 sessions). QMid and QHi do NOT qualify for PB2 \u2014 route to PB3 instead. If at QLo without recent rejection \u2192 NO TRADE on PB2.
4. D1/H4 Conterminous Demand Line ABOVE or AT VAH (use h4_demand_conterminous flag \u2014 must be true)
5. M30 bull engulf OR consolidation at/around demand line or VAH
6. In daytrading session (NY DRF 10am or NY Close 4pm ET)
7. Profit margin: 2\u20133x up to ADR exhaustion or first supply
\u2192 SIGNAL: LONG \u2014 INTRADAY TRADE 2R
\u2192 If not in session: NO TRADE (session gate). If h4_demand_conterminous is false: NO TRADE. If no M30 pattern: NO TRADE (wait).

PB2 DOWNTREND path (Open Below VAL):
1. Trend DOWN confirmed (price below D1 QP + QMid \u2014 lower half of swing range)
2. Value Area Open = BELOW VAL
3. ONLY qualifies if price RECENTLY REJECTED QHi (within last 3\u20135 sessions). QMid and QLo do NOT qualify.
4. D1/H4 Conterminous Supply Line BELOW or AT VAL (use h4_supply_conterminous flag \u2014 must be true)
5. M30 bear engulf OR consolidation at/around supply line or VAL
6. In daytrading session
7. Profit margin: 3\u20135x down to ADR exhaustion or first demand
\u2192 SIGNAL: SHORT \u2014 INTRADAY TRADE 2\u20133R

PLAYBOOK #1 \u2014 WITH THE TREND \u2014 IB EXTENSION
IB REQUIREMENT: REQUIRED \u2014 IB must be fully formed (after IB window closes).
If ib_status = "forming" or "not_started" \u2192 Report: "PB1 PENDING \u2014 IB not yet confirmed. Re-evaluate after [IB close time] ET." Do NOT evaluate PB1 criteria yet.
SESSION: NO session gate for PB1 \u2014 can trade outside DRF/Close windows.

PB1-A: MAIN IB EXTENSION PATH
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

PB3 PATH A: VA REJECTION (no IB required)
1. ADR exhausted in countertrend direction (CT Long = ADR exhausted UPSIDE, CT Short = ADR exhausted DOWNSIDE)
2. H4 + D1 + W1 all 3/3 in same trend direction (if NOT 3/3 \u2192 skip PB3 entirely, go to PB4)
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
- Nearest H4 level to VAH: ${nearVAH ? `${nearVAH.level} (distance: ${nearVAH.distance} pts) → ${nearVAH.conterminous ? 'CONTERMINOUS' : 'NOT conterminous'}` : 'No H4 levels provided'}
- Nearest H4 level to VAL: ${nearVAL ? `${nearVAL.level} (distance: ${nearVAL.distance} pts) → ${nearVAL.conterminous ? 'CONTERMINOUS' : 'NOT conterminous'}` : 'No H4 levels provided'}
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

// ── /api/analyse-chart — Chart Screenshot Analyser (Vision) ──────────────────
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
- ES/NQ: 9:30-10:30am ET · DAX: 9:00-10:00am CET · Gold: 8:20-9:20am ET · Oil: 9:00-10:00am ET

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

// ── /api/autosignal — Fully Automated Axiom Edge Signal Engine ───────────────
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
  // bars = [{ open, high, low, close }] — 30min RTH bars
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

// ── CONTERMINOUS CHECK (GAP 3) ───────────────────────────────────────────────
const TICK_TOLERANCE = { ES: 10, NQ: 10, DAX: 10, XAU: 10, OIL: 10 };
const TICK_VALUE_MAP = { ES: 0.25, NQ: 0.25, DAX: 1.0, XAU: 0.1, OIL: 0.01 };

function isConterminous(h4Level, vaLevel, instrument) {
  const tv = TICK_VALUE_MAP[instrument] || 0.25;
  const tol = (TICK_TOLERANCE[instrument] || 10) * tv;
  const distance = Math.abs(h4Level - vaLevel);
  return { conterminous: distance <= tol, distance: +distance.toFixed(2), tolerance: +tol.toFixed(2) };
}

// ── H4 SWING ZONE DETECTION (GAP 2) ─────────────────────────────────────────
function detectSwingZones(bars, atr) {
  // bars = [{open, high, low, close}] — H4 bars (RTH only)
  const LB = 3; // lookback: 3 bars each side for confirmed swing
  if (!bars || bars.length < LB * 2 + 1) return { supply: [], demand: [] };

  // Filter outlier bars: reject bars with range > 3x ATR (extended hours spikes)
  const maxRange = atr > 0 ? atr * 3 : Infinity;
  const clean = bars.filter(b => (b.high - b.low) <= maxRange);
  if (clean.length < LB * 2 + 1) return { supply: [], demand: [] };

  const supply = [], demand = [];
  for (let i = LB; i < clean.length - LB; i++) {
    // Swing High (supply): high > LB bars before AND LB bars after
    let isHigh = true, isLow = true;
    for (let j = 1; j <= LB; j++) {
      if (clean[i].high <= clean[i - j].high || clean[i].high <= clean[i + j].high) isHigh = false;
      if (clean[i].low >= clean[i - j].low || clean[i].low >= clean[i + j].low) isLow = false;
    }
    if (isHigh) {
      const body = clean[i].open > clean[i].close ? clean[i].close : clean[i].open;
      supply.push({ price_high: +clean[i].high.toFixed(2), price_low: +body.toFixed(2) });
    }
    if (isLow) {
      const body = clean[i].open > clean[i].close ? clean[i].open : clean[i].close;
      demand.push({ price_high: +body.toFixed(2), price_low: +clean[i].low.toFixed(2) });
    }
  }
  // Cluster nearby zones (within 0.5 ATR)
  const cluster = (zones, key) => {
    if (zones.length === 0) return zones;
    const threshold = atr > 0 ? atr * 0.5 : 999999;
    const sorted = [...zones].sort((a, b) => a[key] - b[key]);
    const clustered = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = clustered[clustered.length - 1];
      if (Math.abs(sorted[i][key] - prev[key]) < threshold) {
        // Merge: expand the zone
        prev.price_high = Math.max(prev.price_high, sorted[i].price_high);
        prev.price_low = Math.min(prev.price_low, sorted[i].price_low);
        prev.strength = (prev.strength || 1) + 1;
      } else {
        clustered.push({ ...sorted[i], strength: 1 });
      }
    }
    return clustered;
  };
  return {
    supply: cluster(supply, 'price_high').map(z => ({ ...z, strength: z.strength || 1 })),
    demand: cluster(demand, 'price_low').map(z => ({ ...z, strength: z.strength || 1 })),
  };
}

function getNearestZones(zones, currentPrice, count) {
  const above = zones.supply
    .filter(z => z.price_low > currentPrice)
    .sort((a, b) => a.price_low - b.price_low)
    .slice(0, count)
    .map(z => ({ ...z, distance: +(z.price_low - currentPrice).toFixed(2) }));
  const below = zones.demand
    .filter(z => z.price_high < currentPrice)
    .sort((a, b) => b.price_high - a.price_high)
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
    const currentPrice = meta.regularMarketPrice || 0;

    // ── Build daily OHLC bars ──
    const dailyBars = [];
    for (let i = 0; i < tsD.length; i++) {
      if (qD.open?.[i] != null && qD.high?.[i] != null && qD.low?.[i] != null && qD.close?.[i] != null) {
        dailyBars.push({ ts: tsD[i], open: qD.open[i], high: qD.high[i], low: qD.low[i], close: qD.close[i] });
      }
    }

    // ATR (14-period) and ADR (20-day)
    const atr14 = calcATR(dailyBars, 14);
    const adr20 = calcATR(dailyBars, 20);

    // ── Quarterly pivots from last completed quarter ──
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

    // ── Build 30m bars and filter RTH yesterday ──
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

    // ── Calculate TPO Value Area ──
    const va = calcTPOValueArea(yesterdayRTH, tick);

    // ── IB High/Low ──
    let ibHigh = null, ibLow = null;
    if (todayIBBars.length > 0) {
      ibHigh = +Math.max(...todayIBBars.map(b => b.high)).toFixed(2);
      ibLow = +Math.min(...todayIBBars.map(b => b.low)).toFixed(2);
    }

    // ── M30 pattern ──
    const m30Pattern = detectM30Pattern(todayM30Bars, atr14);

    // ── Context derivation ──
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

    // ── H4 zones (GAP 2 + 4) ──
    let h4Zones = { supply: [], demand: [] };
    try {
      const h4Bars = await fetchH4Bars(yahooSym);
      const h4atr = calcATR(h4Bars, 14);
      const rawZones = detectSwingZones(h4Bars, h4atr);
      h4Zones = getNearestZones(rawZones, currentPrice, 3);
    } catch (e) { console.warn('H4 zones failed:', e.message); }

    // H4 QP = D1 QP (same quarterly pivot values, different timeframe context — GAP 1)
    const h4Pivots = { ...d1Pivots };

    // ── Conterminous checks (GAP 3) ──
    const nearestDemand = h4Zones.demand[0];
    const nearestSupply = h4Zones.supply[0];
    const demandConterminous = nearestDemand
      ? isConterminous(nearestDemand.price_high, va.vah, sym)
      : { conterminous: false, distance: null, tolerance: (TICK_TOLERANCE[sym] || 10) * (TICK_VALUE_MAP[sym] || 0.25) };
    const supplyConterminous = nearestSupply
      ? isConterminous(nearestSupply.price_low, va.val, sym)
      : { conterminous: false, distance: null, tolerance: (TICK_TOLERANCE[sym] || 10) * (TICK_VALUE_MAP[sym] || 0.25) };

    // ── Data object to return + send to AI ──
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
    };

    // ── Call Claude ──
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
- Nearest Supply (above): ${dataUsed.h4_supply_nearest ? `${dataUsed.h4_supply_nearest.price_low}-${dataUsed.h4_supply_nearest.price_high} (distance: ${dataUsed.h4_supply_nearest.distance})` : 'None detected'}
- Nearest Demand (below): ${dataUsed.h4_demand_nearest ? `${dataUsed.h4_demand_nearest.price_high}-${dataUsed.h4_demand_nearest.price_low} (distance: ${dataUsed.h4_demand_nearest.distance})` : 'None detected'}
- All Supply: ${dataUsed.h4_supply_zones.map(z => `${z.price_low}-${z.price_high}`).join(' | ') || 'None'}
- All Demand: ${dataUsed.h4_demand_zones.map(z => `${z.price_low}-${z.price_high}`).join(' | ') || 'None'}

CONTERMINOUS CHECK (pre-calculated, tolerance: ${dataUsed.conterminous_tolerance} pts):
- H4 Demand vs VAH: ${dataUsed.h4_demand_conterminous ? 'CONTERMINOUS' : 'NOT conterminous'} (distance: ${dataUsed.h4_demand_distance_from_vah ?? 'N/A'} pts)
- H4 Supply vs VAL: ${dataUsed.h4_supply_conterminous ? 'CONTERMINOUS' : 'NOT conterminous'} (distance: ${dataUsed.h4_supply_distance_from_val ?? 'N/A'} pts)
NOTE: Conterminous values are pre-validated mathematically. Use these directly — do not re-evaluate.

INITIAL BALANCE (${dataUsed.ib_window} — ${dataUsed.ib_status}):
- IB High: ${dataUsed.ib_high || 'Not yet formed'}
- IB Low: ${dataUsed.ib_low || 'Not yet formed'}
- IB Extension: ${dataUsed.ib_extension}

TREND: ${dataUsed.trend}
M30 PATTERN (last completed bar): ${dataUsed.m30_pattern}
ADR EXHAUSTED: ${dataUsed.adr_exhausted ? 'YES' : 'NO'}
CURRENT SESSION: ${dataUsed.session}
CURRENT TIME (ET): ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true })}
IB STATUS: ${dataUsed.ib_status}

IMPORTANT: Check time context. If IB not yet formed, PB2 may still fire (no IB required). PB1 requires IB set.
Calculate stop = entry ± 1x ATR. Calculate 1R/2R/3R targets from entry using ATR.`;

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

    // Attach data_used to signal
    signal.data_used = dataUsed;
    res.json({ success: true, signal, data_used: dataUsed, ts: new Date().toISOString() });

  } catch (err) {
    console.error('AutoSignal error:', err);
    res.status(500).json({ error: err.message, symbol: sym });
  }
});

// ── /api/qp-calculate — D1 Q Point Calculator (swing-based quartile levels) ──
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

// ── /api/h4-zones — H4 Supply/Demand Zone Detection ─────────────────────────
app.get('/api/h4-zones', async (req, res) => {
  const symbol = req.query.symbol || 'ES=F';
  const currentPrice = parseFloat(req.query.current_price) || 0;
  const instrument = req.query.instrument || 'ES';

  try {
    const h4Bars = await fetchH4Bars(symbol);
    const atr = calcATR(h4Bars, 14);
    const rawZones = detectSwingZones(h4Bars, atr);
    const nearest = getNearestZones(rawZones, currentPrice, 3);
    res.json({ success: true, supply: nearest.supply, demand: nearest.demand, h4_bars_count: h4Bars.length, atr_h4: +atr.toFixed(2) });
  } catch (err) {
    console.error('H4 zones error:', err);
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
  console.log(`   /api/signals — Axiom Edge AI Signal Analyser`);
  console.log(`   /api/autosignal — Axiom Edge Auto Signal (ES/NQ/DAX/XAU/OIL)`);
  console.log(`   /api/analyse-chart — Chart Screenshot Analyser (Vision)`);
  console.log(`   /api/qp-calculate — D1 Q Point Calculator (swing quartiles)`);
  if (!FRED_KEY) {
    console.log(`\n   ⚠  FRED_API_KEY not set — 2Y Treasury & Fed Funds will use static fallback`);
    console.log(`      Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html`);
  }
  console.log('');
});
