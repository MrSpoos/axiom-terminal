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
- IB windows: ES/NQ = 9:30-10:30am ET | DAX = 9:00-10:00am CET | Gold = 8:20-9:20am ET | Oil = 9:00-10:00am ET
- Active sessions: NY DRF 10:00am ET · NY Close 4:00pm ET
- Phase 1 (bullish trigger): Bullish engulf OR consolidation breaking above swing high on M15/M30/H4
- Phase 3 (bearish trigger): 3-bar reversal pattern on M15/M30/H4
- Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL
- Trader experience: SEASONED (uses D1 QP levels)

STEP 1 — DETERMINE IB STATUS
Check current ET time against instrument IB window:
- BEFORE IB window opens → ib_status: "not_started"
- DURING IB window → ib_status: "forming" (show current H/L so far)
- AFTER IB window closes → ib_status: "set" (use confirmed H/L)

STEP 2 — EVALUATE PLAYBOOKS IN THIS EXACT ORDER

PLAYBOOK #2 — WITH THE TREND — RETURN TO VAH/VAL
IB REQUIREMENT: NONE — PB2 can fire from the open, even before IB forms.
SESSION: Must be in NY DRF (10am ET) or NY Close (4pm ET) window.
NOTE: PB2 fires BEFORE checking PB1. Evaluate it first, always.

PB2 UPTREND path (Open Above VAH):
1. Trend UP confirmed (price above D1 QP+QMid)
2. Value Area Open = ABOVE VAH
3. H4 or D1 QP level — ONLY qualifies if price RECENTLY REJECTED QLo (within last 3-5 sessions). QMid and QHi do NOT qualify for PB2 — route to PB3 instead. If at QLo without recent rejection → NO TRADE on PB2.
4. D1/H4 Conterminous Demand Line ABOVE or AT VAH (tolerance: 5-10 ticks / 1-2 points)
5. M30 bull engulf OR consolidation at/around demand line or VAH
6. In daytrading session (NY DRF 10am or NY Close 4pm ET)
7. Profit margin: 2-3x up to ADR exhaustion or first supply
→ SIGNAL: LONG — INTRADAY TRADE 2R
→ If not in session: NO TRADE (session gate). If demand not conterminous: NO TRADE. If no M30 pattern: NO TRADE (wait).

PB2 DOWNTREND path (Open Below VAL):
1. Trend DOWN confirmed (price below D1 QP+QMid)
2. Value Area Open = BELOW VAL
3. ONLY qualifies if price RECENTLY REJECTED QHi (within last 3-5 sessions). QMid and QLo do NOT qualify.
4. D1/H4 Conterminous Supply Line BELOW or AT VAL (tolerance: 5-10 ticks / 1-2 points)
5. M30 bear engulf OR consolidation at/around supply line or VAL
6. In daytrading session
7. Profit margin: 3-5x down to ADR exhaustion or first demand
→ SIGNAL: SHORT — INTRADAY TRADE 2-3R


PLAYBOOK #1 — WITH THE TREND — IB EXTENSION
IB REQUIREMENT: REQUIRED — IB must be fully formed (after IB window closes).
If ib_status = "forming" or "not_started" → Report: "PB1 PENDING — IB not yet confirmed. Re-evaluate after [IB close time] ET." Do NOT evaluate PB1 criteria yet.
SESSION: NO session gate for PB1 — can trade outside DRF/Close windows.

PB1-A: MAIN IB EXTENSION PATH
1. Trend confirmed via D1 QP levels:
   - At D1 QHi (trend up) → route to PB3 (not PB1)
   - At D1 QMid or QLo → continue PB1 evaluation
   - Trend UP: price above D1 QP+QMid. Trend DOWN: price below D1 QP+QMid
2. ADR NOT exhausted in trend direction (if exhausted → NO TRADE on PB1-A, check PB3)
3. Rejection of VA in trend direction
4. IB extended in trend direction (confirmed, IB set)
5. H4 Conterminous Supply (downtrend) or Demand (uptrend) at/above VAL or VAH (tolerance: 5-10 ticks)
6. M30 bear engulf/consolidation (short) or bull engulf/consolidation (long) at conterminous level
7. Profit margin: 3-5x to ADR exhaustion or first opposing S/D
→ SIGNAL: LONG or SHORT — INTRADAY TRADE 2R

PB1-B: EARLY VA ROTATION PATH (separate criteria, different target)
- Triggers when VA rotation rule applies (early M30 acceptance of VA)
- Does NOT need IB extension
- Profit margin: 3-5x to ADR exhaustion / first supply/demand
→ SIGNAL: LONG or SHORT — INTRADAY TRADE MAX 2-3R (lower target than PB1-A)
Report PB1-A as "PB1 Main Path" and PB1-B as "PB1 Early VA Rotation Path" separately. If both qualify, prefer PB1-A.


PLAYBOOK #3 — COUNTERTREND — ADR EXHAUSTION
IB REQUIREMENT: PARTIAL — path-specific (see below).
SESSION: CT intraday trades MUST close at end of session (hard rule).

PB3 PATH A: VA REJECTION (no IB required)
1. ADR exhausted in countertrend direction (CT Long = ADR exhausted UPSIDE, CT Short = ADR exhausted DOWNSIDE)
2. H4+D1+W1 all 3/3 in same trend direction (if NOT 3/3 → skip PB3 entirely, go to PB4)
3. D1 engulf in CT direction (if no D1 engulf → route to PB4, not NO TRADE)
4. VA rejection in CT direction
5. Phase 1 (CT long) or Phase 3 (CT short) on M15/M30/H4
6. Profit margin: 3-5x to Value or H4 conterminous S/D
→ SIGNAL: CT LONG 2R MAX or CT SHORT 2-3R. MANDATORY: "Close at end of session"

PB3 PATH B: IB EXTENSION (IB must be set)
- CT Long: IB extended DOWNSIDE + buying tail. CT Short: IB extended UPSIDE + selling tail.
- Then same Phase 1/3 trigger + profit margin check
→ Same targets. If no buying/selling tail → NO TRADE on PB3, check PB4.

PB3 → PB4 WATERFALL: 3/3 trend NOT confirmed → skip to PB4. No D1 engulf → go to PB4. Both paths fail → go to PB4. NEVER return NO TRADE from PB3 failure alone — always check PB4 first.


PLAYBOOK #4 — COUNTERTREND — SWING/INTRADAY DECISION
IB REQUIREMENT: PATH-SPECIFIC. Intraday closes at end of session. Swing can hold overnight.
ARRIVES HERE: When PB3 conditions not met, or routed from PB3 waterfall.

ENTRY GATE: Trend DOWN → must have RECENTLY REJECTED D1 QLo (if no rejection → go to PB1, not PB4). Trend UP → must have RECENTLY REJECTED D1 QHi.

PB4 PATH A: SWING (IB not required)
1. D1 QLo rejection (CT long) or QHi rejection (CT short)
2. ADR exhausted in CT direction
3. IB extension UP or NONE (CT long) / DOWN or NONE (CT short) → check D1 engulf
4. Recent D1 bullish engulf c-line (CT long) or bearish (CT short)
5. Profit margin: 3-5x to ADR/ASR or first S/D
→ SIGNAL: CT SWING LONG or SHORT — 3-5R. Can hold overnight.

PB4 PATH B: INTRADAY (IB must be set)
- IB extended DOWN + buying tail (CT long) or UP + selling tail (CT short)
- Bull/bear engulf on M15/M30 with TPO close BACK TO IB
- Profit margin: 3-5x to opposing IB edge / ADR-ASR / H4 S/D
→ SIGNAL: CT INTRADAY — 2-3R. MANDATORY: "Close at end of session"

PB4 PATH C: VAH/VAL RETURN
- Price returned to VAH (CT long) or VAL (CT short)
- Bull/bear engulf on D1/H4/M30 at VAH/VAL or D1 c-dem/c-sup
→ SIGNAL: CT INTRADAY — 2-3R. MANDATORY: "Close at end of session"


CRITICAL RULES — NEVER VIOLATE:
1. NEVER mix PB1 and PB2 criteria in the same checklist
2. NEVER apply the session gate to PB1 — PB1 has NO session requirement
3. ALWAYS apply the session gate to PB2
4. NEVER return NO TRADE from PB3 failure — always waterfall to PB4
5. ALWAYS separate PB1-A (main IB path) from PB1-B (early VA rotation)
6. PB1-A target is 2R. PB1-B target is MAX 2-3R. NEVER confuse these.
7. PB3/PB4 intraday trades ALWAYS include "close at end of session" warning
8. PB4 swing trades do NOT have the session close rule
9. ADR direction in PB3: CT Long = ADR exhausted UPSIDE. CT Short = DOWNSIDE.
10. PB2: QMid does NOT qualify — only recently rejected QLo (uptrend) or QHi (downtrend)
11. Seasoned trader: D1 QHi in uptrend → routes to PB3 not PB1
12. IB pending message must include exact time IB confirms for the instrument

RESPONSE FORMAT:
{
  "playbooks_evaluated": ["PB2","PB1","PB3","PB4"],
  "playbook_selected": "PB2",
  "playbook_path": "PB2 Uptrend — Open Above VAH",
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
  "criteria": [{"playbook":"PB2","condition":"<text>","met":true/false,"note":"<detail>"}],
  "failed_playbooks": [{"playbook":"PB1","reason":"<why it failed or is pending>"}],
  "reasoning": "<2-3 sentence explanation>",
  "confidence": "High" or "Medium" or "Low",
  "warnings": ["<any warnings like missing M30 trigger or session gate>"]
}`;

app.post('/api/signals', async (req, res) => {
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY not set' });
  }

  const data = req.body;
  if (!data || !data.instrument || !data.currentPrice) {
    return res.status(400).json({ error: 'instrument and currentPrice are required' });
  }

  const userPrompt = `Analyse this market setup and determine the correct Axiom Edge playbook signal:

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

INITIAL BALANCE (per instrument IB window):
- IB High: ${data.ibHigh || 'Not provided / not yet formed'}
- IB Low: ${data.ibLow || 'Not provided / not yet formed'}
- IB Status: ${data.ibHigh && data.ibLow ? 'SET' : 'Not formed or not provided'}

TREND: ${data.trend || 'Not provided'}
M30 PATTERN: ${data.m30Pattern || 'None'}
ADR EXHAUSTED (>= 80% of 20-day TR): ${data.adrExhausted ? 'YES' : 'NO'}
CURRENT TIME (ET): ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true })}

IMPORTANT: Check IB status and time. PB2 does NOT require IB. PB1 requires IB set. Evaluate accordingly.
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

QUARTERLY PIVOTS (D1):
- QP: ${dataUsed.d1_qp} | QHi: ${dataUsed.d1_qhi} | QMid: ${dataUsed.d1_qmid} | QLo: ${dataUsed.d1_qlo}

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
  if (!FRED_KEY) {
    console.log(`\n   ⚠  FRED_API_KEY not set — 2Y Treasury & Fed Funds will use static fallback`);
    console.log(`      Get a free key at https://fred.stlouisfed.org/docs/api/api_key.html`);
  }
  console.log('');
});
