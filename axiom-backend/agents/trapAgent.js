// ── Trap Detector Agent ───────────────────────────────────────────────────────
// Identifies stop hunts, liquidity grabs, and false breakouts using
// key structural levels from Yahoo Finance intraday data.

const fetch = require('node-fetch');

const SYSTEM_PROMPT = `You are the Trap Detector Agent for the Axiom Terminal — a market structure specialist focused on identifying stop hunts, liquidity grabs, and false breakouts in futures markets.

Your job: assess whether current price action shows signs of a trap — a move designed to trigger stops or hunt liquidity before reversing.

TRAP TYPES TO IDENTIFY:
- stop_hunt: Price briefly spikes through a known stop cluster level (prior high/low, overnight extreme) then immediately reverses. Characterized by a wick or fast rejection.
- liquidity_grab: Price moves into an area of concentrated resting orders (above swing highs, below swing lows) then reverses sharply. Often occurs before the real move begins.
- bull_trap: Price breaks above a key resistance level, attracts buyers, then fails and reverses lower. Classic "buy the breakout, get trapped" scenario.
- bear_trap: Price breaks below a key support level, attracts sellers, then fails and reverses higher. Mirror of bull trap.
- fakeout: Price briefly moves outside value area or IB range, then pulls back inside. Market rejected the extension.
- none: No trap pattern detected.

KEY LEVELS TO ASSESS (in order of importance):
1. Prior day high (PDH) and prior day low (PDL) — highest probability stop clusters
2. Overnight high (ONH) and overnight low (ONL) — commonly hunted at RTH open
3. Initial Balance high (IBH) and Initial Balance low (IBL) — fakeouts above/below IB
4. Value Area High (VAH) and Value Area Low (VAL) — value area rejections
5. Recent swing highs and lows from intraday structure

TRAP RISK ASSESSMENT:
- high: Price is at or has just breached a known level with speed, and context suggests reversal likely
- medium: Price approaching a known level with some trap characteristics
- low: Minor setup, trap possible but not compelling
- none: No significant levels being tested

EVIDENCE TO LOOK FOR:
- Wick/tail through a level with close back inside
- Speed of move (fast spikes are more suspicious than gradual approaches)
- Volume anomaly at the level (not always available)
- Time of day (opening 30min and closing 30min are highest trap probability windows)
- Prior rejections at the same level

Respond ONLY with valid JSON, no markdown, no code fences:
{
  "agent_id": "trap_detector",
  "instrument": "<ES|NQ|GC|CL>",
  "timestamp": "<ISO8601>",
  "trap_risk": "<none|low|medium|high>",
  "trap_type": "<none|stop_hunt|liquidity_grab|bull_trap|bear_trap|fakeout>",
  "trap_direction": "<long_trap|short_trap|none>",
  "key_levels_at_risk": [<number>],
  "current_price_vs_levels": "<description of where price is relative to key levels>",
  "evidence": ["<specific observation>"],
  "invalidation": "<what would confirm the trap is real vs just noise>",
  "thesis": "<1-2 sentence plain English summary>",
  "confidence": <0-100>,
  "warnings": ["<notable observations>"]
}`;

const YAHOO_MAP = { ES: 'ES=F', NQ: 'NQ=F', GC: 'GC=F', CL: 'CL=F' };

async function fetchStructuralLevels(yahooSymbol) {
  // Fetch 5-day daily + today intraday to get PDH/PDL, ONH/ONL
  const [dailyR, intradayR] = await Promise.allSettled([
    fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 8000,
    }).then(r => r.json()),
    fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=5m&range=2d`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }, timeout: 8000,
    }).then(r => r.json()),
  ]);

  const levels = {};

  // Extract prior day high/low/close from daily bars
  if (dailyR.status === 'fulfilled') {
    const result = dailyR.value?.chart?.result?.[0];
    const q = result?.indicators?.quote?.[0];
    if (q && q.high?.length >= 2) {
      const idx = q.high.length - 2; // prior day (index before last)
      levels.pdh = q.high[idx]?.toFixed(2);
      levels.pdl = q.low[idx]?.toFixed(2);
      levels.pdc = q.close[idx]?.toFixed(2);
      levels.currentPrice = result.meta?.regularMarketPrice;
    }
  }

  // Extract overnight high/low + recent swing highs/lows from 5min bars
  if (intradayR.status === 'fulfilled') {
    const result = intradayR.value?.chart?.result?.[0];
    const q      = result?.indicators?.quote?.[0];
    const ts     = result?.timestamp || [];

    if (q && ts.length > 0) {
      const etNow    = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const todayStr = etNow.toISOString().split('T')[0];
      const rthOpenMins = 9 * 60 + 30;

      let onHigh = -Infinity, onLow = Infinity;
      let todayRthBars = [];

      for (let i = 0; i < ts.length; i++) {
        const barDate = new Date(ts[i] * 1000);
        const barET   = new Date(barDate.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const barDateStr = barET.toISOString().split('T')[0];
        const barMins = barET.getHours() * 60 + barET.getMinutes();

        if (barDateStr === todayStr) {
          if (barMins < rthOpenMins) {
            // Overnight bars
            if (q.high[i]) onHigh = Math.max(onHigh, q.high[i]);
            if (q.low[i])  onLow  = Math.min(onLow,  q.low[i]);
          } else if (barMins < 16 * 60 && q.high[i] != null) {
            todayRthBars.push({ h: q.high[i], l: q.low[i], c: q.close[i], t: barMins });
          }
        }
      }

      if (onHigh > -Infinity) levels.onh = onHigh.toFixed(2);
      if (onLow  < Infinity)  levels.onl = onLow.toFixed(2);

      // Recent session high/low
      if (todayRthBars.length > 0) {
        levels.sessionHigh = Math.max(...todayRthBars.map(b => b.h)).toFixed(2);
        levels.sessionLow  = Math.min(...todayRthBars.map(b => b.l)).toFixed(2);
        levels.recentClose = todayRthBars[todayRthBars.length - 1]?.c?.toFixed(2);
      }
    }
  }

  return levels;
}

async function runTrapAgent(instrument, sessionLevels, anthropicKey) {
  const yahooSym = YAHOO_MAP[instrument] || 'ES=F';
  const structLevels = await fetchStructuralLevels(yahooSym);
  const merged = { ...structLevels, ...sessionLevels };

  const currentPrice = merged.currentPrice || merged.recentClose || 'unknown';
  const etTime = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });

  const userPrompt = `Instrument: ${instrument}
Current ET Time: ${etTime}
Current Price: ${currentPrice}

STRUCTURAL LEVELS:
Prior Day High (PDH): ${merged.pdh || 'N/A'}
Prior Day Low (PDL):  ${merged.pdl || 'N/A'}
Prior Day Close:      ${merged.pdc || 'N/A'}
Overnight High (ONH): ${merged.onh || 'N/A'}
Overnight Low (ONL):  ${merged.onl || 'N/A'}
Session High so far:  ${merged.sessionHigh || 'N/A'}
Session Low so far:   ${merged.sessionLow || 'N/A'}
VAH: ${merged.vah || 'N/A'} | POC: ${merged.poc || 'N/A'} | VAL: ${merged.val || 'N/A'}
IB High: ${merged.ibHigh || 'N/A'} | IB Low: ${merged.ibLow || 'N/A'}

Assess trap/liquidity risk for ${instrument} at current price and return your JSON analysis.`;

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!aiRes.ok) throw new Error(`Anthropic trap agent ${aiRes.status}`);
  const aiData = await aiRes.json();
  const text = (aiData?.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const result = JSON.parse(text);
  result.timestamp = new Date().toISOString();
  result.instrument = instrument;
  return result;
}

module.exports = { runTrapAgent };
