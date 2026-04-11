// ── Correlation Agent ─────────────────────────────────────────────────────────
// Fetches DXY, VIX, ZN (10yr Treasury futures), and target instrument data
// from Yahoo Finance. Assesses inter-market alignment vs the bull/bear bias.

const fetch = require('node-fetch');

const SYSTEM_PROMPT = `You are the Correlation Agent for the Axiom Terminal, a professional futures trading platform.

Your sole job: assess whether inter-market conditions (DXY, VIX, 10yr Treasury futures) support or contradict a bullish or bearish bias on the target instrument.

CORRELATION RULES:
ES/NQ (equity index futures):
- DXY rising + VIX rising = bearish headwind for ES/NQ
- DXY falling + VIX falling = bullish tailwind for ES/NQ
- ZN (bonds) rising = risk-off, bearish for equity futures
- ZN falling = risk-on, bullish for equity futures

GC (Gold futures):
- DXY rising = bearish headwind for Gold (inverse relationship)
- DXY falling = bullish tailwind for Gold
- VIX rising = can be bullish for Gold (safe haven bid)
- ZN rising = bullish for Gold (lower real yields)

CL (Crude Oil futures):
- DXY rising = mild bearish pressure (oil priced in USD)
- VIX rising = bearish (risk-off reduces demand outlook)
- Geopolitical risk not assessable from price data — flag as unknown

TAILWIND SCORE: Output a score from -100 to +100.
- +100 = all correlated instruments fully aligned with bull case
- -100 = all fully contradicting the bull case
- 0 = neutral or mixed signals

Respond ONLY with valid JSON, no markdown, no code fences:
{
  "agent_id": "correlation",
  "instrument": "<ES|NQ|GC|CL>",
  "timestamp": "<ISO8601>",
  "readings": {
    "dxy_price": <number>,
    "dxy_change_pct": <number>,
    "dxy_trend": "bullish|bearish|neutral",
    "vix_price": <number>,
    "vix_level": "low|elevated|high|extreme",
    "vix_change_pct": <number>,
    "zn_price": <number>,
    "zn_change_pct": <number>,
    "bonds_trend": "bullish|bearish|neutral"
  },
  "tailwind_score": <-100 to +100>,
  "alignment": "confirming|neutral|contradicting",
  "thesis": "<1-2 sentence plain English summary>",
  "confidence": <0-100>,
  "warnings": ["<any notable anomalies>"]
}`;

async function yahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 8000,
  });
  if (!r.ok) throw new Error(`Yahoo ${symbol} HTTP ${r.status}`);
  const data = await r.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta?.regularMarketPrice) throw new Error(`No price for ${symbol}`);
  const price = meta.regularMarketPrice;
  const prev = meta.previousClose || meta.chartPreviousClose || price;
  const chg = price - prev;
  const pct = prev !== 0 ? (chg / prev) * 100 : 0;
  return { price: +price.toFixed(3), chg: +chg.toFixed(3), pct: +pct.toFixed(2), prev: +prev.toFixed(3) };
}

async function runCorrelationAgent(instrument, anthropicKey) {
  // 1. Fetch all correlation instruments in parallel
  const [dxyR, vixR, znR] = await Promise.allSettled([
    yahooQuote('DX-Y.NYB'),   // DXY dollar index
    yahooQuote('^VIX'),        // CBOE VIX
    yahooQuote('ZN=F'),        // 10yr Treasury note futures
  ]);

  const dxy = dxyR.status === 'fulfilled' ? dxyR.value : null;
  const vix = vixR.status === 'fulfilled' ? vixR.value : null;
  const zn  = znR.status  === 'fulfilled' ? znR.value  : null;

  const warnings = [];
  if (!dxy) warnings.push(`DXY fetch failed: ${dxyR.reason?.message}`);
  if (!vix) warnings.push(`VIX fetch failed: ${vixR.reason?.message}`);
  if (!zn)  warnings.push(`ZN fetch failed: ${znR.reason?.message}`);

  // 2. Build user prompt
  const userPrompt = `Target instrument: ${instrument}
Current time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })} ET

INTER-MARKET READINGS:
- DXY (Dollar Index): ${dxy ? `${dxy.price} (${dxy.pct > 0 ? '+' : ''}${dxy.pct}% today)` : 'UNAVAILABLE'}
- VIX (Fear Index): ${vix ? `${vix.price} (${vix.pct > 0 ? '+' : ''}${vix.pct}% today)` : 'UNAVAILABLE'}
- ZN (10yr T-Note Futures): ${zn ? `${zn.price} (${zn.pct > 0 ? '+' : ''}${zn.pct}% today)` : 'UNAVAILABLE'}
${warnings.length > 0 ? `\nDATA WARNINGS: ${warnings.join('; ')}` : ''}

Assess inter-market correlation alignment for ${instrument} and return your JSON analysis.`;

  // 3. Call Claude
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    throw new Error(`Anthropic correlation agent error ${aiRes.status}: ${err}`);
  }

  const aiData = await aiRes.json();
  const text = (aiData?.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Correlation agent JSON parse failed: ${text.slice(0, 200)}`);
  }

  result.timestamp = new Date().toISOString();
  result.instrument = instrument;
  return result;
}

module.exports = { runCorrelationAgent };
