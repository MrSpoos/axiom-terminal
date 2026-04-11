// ── Session Behavior Agent ────────────────────────────────────────────────────
// Classifies day type in progress, IB status, overnight context, and value
// area position using Yahoo Finance intraday data + pre-supplied VA levels.

const fetch = require('node-fetch');

const SYSTEM_PROMPT = `You are the Session Behavior Agent for the Axiom Terminal — a Market Profile specialist.

Your job: classify the current trading session using Market Profile and Market Stalkers methodology.

IB WINDOWS (when Initial Balance forms):
- ES / NQ: 09:30–10:30 ET
- GC (Gold): 08:20–09:20 ET  
- CL (Crude Oil): 09:00–10:00 ET

DAY TYPE CLASSIFICATION (in progress — use available RTH data):
- Trend Day: Strong directional move, price extends well beyond IB in one direction, rotations are shallow
- Normal Day: Price accepts value, rotates within or near prior VA, IB is moderate
- Normal Variation: IB extends in one direction only, moderate range, single directional push
- Neutral Day: IB extends both directions, price closes near midpoint, market is undecided
- Unknown: Insufficient data (too early in session)

VALUE AREA POSITION:
- Above VAH: Bullish auction — market rejected prior value, looking for new higher value
- Inside VA: Market accepting prior value — look for rotation or continuation
- Below VAL: Bearish auction — market rejected prior value, looking for new lower value

OVERNIGHT CONTEXT:
- Gap Up / Gap Down: Distance between prior RTH close and current open
- Overnight Range: High - Low of overnight session
- Overnight character: Balanced (tight range) or Directional (one-sided)

SESSION PHASE:
- pre_rth: Before regular trading hours open
- ib_forming: Within the IB window, balance not yet set
- post_ib: IB is set, main session underway
- late_session: Last 90 minutes, approaching close

Respond ONLY with valid JSON, no markdown, no code fences:
{
  "agent_id": "session_behavior",
  "instrument": "<ES|NQ|GC|CL>",
  "timestamp": "<ISO8601>",
  "session_phase": "<pre_rth|ib_forming|post_ib|late_session>",
  "ib_status": {
    "formed": <true|false>,
    "ib_high": <number|null>,
    "ib_low": <number|null>,
    "ib_range": <number|null>,
    "extension": "<none|up|down|both|unknown>"
  },
  "day_type_in_progress": "<trend|normal|normal_variation|neutral|unknown>",
  "day_type_confidence": "<high|medium|low>",
  "value_position": "<above_vah|inside_va|below_val|unknown>",
  "overnight_context": {
    "gap_direction": "<up|down|flat|unknown>",
    "gap_points": <number|null>,
    "overnight_range": <number|null>,
    "overnight_character": "<balanced|directional|unknown>"
  },
  "thesis": "<1-2 sentence plain English summary of session character>",
  "confidence": <0-100>,
  "warnings": ["<any notable observations>"]
}`;

// IB windows by instrument (ET hours)
const IB_WINDOWS = {
  ES:  { open: { h: 9,  m: 30 }, close: { h: 10, m: 30 } },
  NQ:  { open: { h: 9,  m: 30 }, close: { h: 10, m: 30 } },
  GC:  { open: { h: 8,  m: 20 }, close: { h: 9,  m: 20 } },
  CL:  { open: { h: 9,  m: 0  }, close: { h: 10, m: 0  } },
};

function getSessionPhase(instrument) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = now.getHours(), m = now.getMinutes();
  const totalMins = h * 60 + m;
  const rthOpen  = 9 * 60 + 30;
  const rthClose = 16 * 60;
  const lateStart = 14 * 60 + 30;
  const ib = IB_WINDOWS[instrument] || IB_WINDOWS.ES;
  const ibOpen  = ib.open.h  * 60 + ib.open.m;
  const ibClose = ib.close.h * 60 + ib.close.m;

  if (totalMins < rthOpen)  return 'pre_rth';
  if (totalMins < ibClose)  return 'ib_forming';
  if (totalMins >= lateStart && totalMins < rthClose) return 'late_session';
  if (totalMins < rthClose) return 'post_ib';
  return 'post_rth';
}

async function fetchIntraday(yahooSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=5m&range=2d`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 8000,
  });
  if (!r.ok) throw new Error(`Yahoo intraday ${yahooSymbol} HTTP ${r.status}`);
  const data = await r.json();
  return data?.chart?.result?.[0];
}

const YAHOO_MAP = { ES: 'ES=F', NQ: 'NQ=F', GC: 'GC=F', CL: 'CL=F' };

async function runSessionAgent(instrument, sessionLevels, anthropicKey) {
  const phase = getSessionPhase(instrument);
  const yahooSym = YAHOO_MAP[instrument] || 'ES=F';

  // Fetch intraday bars
  let ohlcSummary = 'Intraday data unavailable';
  let currentPrice = null;
  try {
    const result = await fetchIntraday(yahooSym);
    const meta   = result?.meta;
    const quotes = result?.indicators?.quote?.[0];
    const timestamps = result?.timestamp || [];
    currentPrice = meta?.regularMarketPrice;

    if (quotes && timestamps.length > 0) {
      const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const todayStr = etNow.toISOString().split('T')[0];

      // Filter to today's RTH bars only (09:30–16:00 ET)
      const todayBars = [];
      for (let i = 0; i < timestamps.length; i++) {
        const barDate = new Date(timestamps[i] * 1000);
        const barET   = new Date(barDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const barDateStr = barET.toISOString().split('T')[0];
        const barMins = barET.getHours() * 60 + barET.getMinutes();
        if (barDateStr === todayStr && barMins >= 9*60+30 && barMins < 16*60) {
          if (quotes.open[i] != null) todayBars.push({
            t: barET.toTimeString().slice(0,5),
            o: quotes.open[i]?.toFixed(2),
            h: quotes.high[i]?.toFixed(2),
            l: quotes.low[i]?.toFixed(2),
            c: quotes.close[i]?.toFixed(2),
          });
        }
      }

      const dayHigh   = Math.max(...todayBars.map(b => parseFloat(b.h) || 0));
      const dayLow    = Math.min(...todayBars.filter(b => b.l).map(b => parseFloat(b.l)));
      const firstBar  = todayBars[0];
      const ibBars    = todayBars.slice(0, 12); // first 12 x 5min bars = 60min IB
      const ibHigh    = ibBars.length ? Math.max(...ibBars.map(b => parseFloat(b.h) || 0)) : null;
      const ibLow     = ibBars.length ? Math.min(...ibBars.filter(b => b.l).map(b => parseFloat(b.l))) : null;

      ohlcSummary = `Today's RTH so far (${todayBars.length} bars):
Open: ${firstBar?.o || 'N/A'} | Day High: ${dayHigh.toFixed(2)} | Day Low: ${dayLow.toFixed(2)} | Current: ${currentPrice?.toFixed(2)}
IB High (first 60min): ${ibHigh?.toFixed(2) || 'forming'} | IB Low: ${ibLow?.toFixed(2) || 'forming'}
Bar count today: ${todayBars.length}`;
    }
  } catch (err) {
    console.warn(`Session agent: intraday fetch failed for ${instrument}:`, err.message);
  }

  const levelsText = sessionLevels ? `
PROVIDED SESSION LEVELS:
VAH: ${sessionLevels.vah || 'N/A'} | POC: ${sessionLevels.poc || 'N/A'} | VAL: ${sessionLevels.val || 'N/A'}
Prior Day High: ${sessionLevels.pdh || 'N/A'} | Prior Day Low: ${sessionLevels.pdl || 'N/A'}
Prior Day Close: ${sessionLevels.pdc || 'N/A'}` : '';

  const userPrompt = `Instrument: ${instrument}
Current ET Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })}
Session Phase: ${phase}
${ohlcSummary}
${levelsText}

Classify the current session character and return your JSON analysis.`;

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!aiRes.ok) throw new Error(`Anthropic session agent ${aiRes.status}`);
  const aiData = await aiRes.json();
  const text = (aiData?.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const result = JSON.parse(text);
  result.timestamp = new Date().toISOString();
  result.instrument = instrument;
  return result;
}

module.exports = { runSessionAgent };
