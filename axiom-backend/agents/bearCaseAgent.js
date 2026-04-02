// ── Bear Case Agent ───────────────────────────────────────────────────────────
// Builds an INDEPENDENT short thesis from scratch — does NOT react to the bull.
// Uses the same Tier 1 data but looks through a bearish lens only.

const fetch = require('node-fetch');

const SYSTEM_PROMPT = `You are the Bear Case Agent for the Axiom Terminal.

Your job: build a completely independent bearish thesis for the instrument. You do NOT read or reference the bull case. You look at the available market data and construct the strongest possible argument for why price should go DOWN.

YOUR PROCESS:
1. Look at correlation data: does DXY strength, VIX elevation, or bond weakness support a short?
2. Look at session behavior: is day type consistent with a bearish distribution? Is price below value?
3. Look at trap data: has a bull trap formed? Is there a liquidity grab overhead that was hunted?
4. Look at macro: is there a catalyst that could drive selling pressure?
5. Identify your best short entry trigger, key resistance levels, and target levels
6. Rate the bear case confidence honestly

IMPORTANT RULES:
- Build FROM the data, not against the bull case
- Be specific with levels — not "below the key level" but the actual number
- If the data genuinely doesn't support a short, say so honestly
- Separate what you KNOW from what you're INFERRING

TARGET METHODOLOGY (Market Stalkers):
- First target: nearest demand zone or VAL (if price above value)
- Second target: ADR exhaustion level or prior day low
- Third target: weekly low or major structural support

Respond ONLY with valid JSON, no markdown, no code fences:
{
  "agent_id": "bear_case",
  "instrument": "<ES|NQ|GC|CL>",
  "timestamp": "<ISO8601>",
  "bear_thesis": "<2-3 sentence independent bear narrative>",
  "primary_driver": "<the single strongest reason to be short>",
  "supporting_evidence": ["<specific data point supporting the bear case>"],
  "key_resistance_levels": [<number>],
  "trigger_catalyst": "<what specific price action or event would confirm the short>",
  "target_levels": [<number>],
  "stop_level": <number|null>,
  "bear_case_quality": "<strong|moderate|weak|no_case>",
  "confidence": <0-100>,
  "summary": "<1 sentence plain English bear case>"
}`;

async function runBearCaseAgent(instrument, tier1Results, anthropicKey) {
  const macro   = tier1Results.macro;
  const corr    = tier1Results.correlation;
  const session = tier1Results.session;
  const trap    = tier1Results.trap;

  const marketContext = `
BUILD A BEAR CASE FOR ${instrument} USING THIS DATA:

MACRO ENVIRONMENT:
- Event risk: ${macro?.event_risk_level || 'unknown'}
- Calendar verdict: ${macro?.setup_verdict || 'unknown'}
- Next event: ${macro?.next_event?.name || 'none'} in ${macro?.next_event?.time_until_hours || '?'}h
- Summary: ${macro?.thesis || 'unavailable'}

INTER-MARKET DATA:
- DXY: ${corr?.readings?.dxy_price || '?'} (${corr?.readings?.dxy_trend || '?'}, ${corr?.readings?.dxy_change_pct > 0 ? '+' : ''}${corr?.readings?.dxy_change_pct || '?'}% today)
- VIX: ${corr?.readings?.vix_price || '?'} — ${corr?.readings?.vix_level || '?'} (${corr?.readings?.vix_change_pct > 0 ? '+' : ''}${corr?.readings?.vix_change_pct || '?'}% today)
- ZN Bonds: ${corr?.readings?.zn_price || '?'} — ${corr?.readings?.bonds_trend || '?'}
- Overall alignment: ${corr?.alignment || '?'} (tailwind score: ${corr?.tailwind_score ?? '?'})

SESSION BEHAVIOR:
- Day type in progress: ${session?.day_type_in_progress || 'unknown'}
- Value position: ${session?.value_position || 'unknown'}
- IB: ${session?.ib_status?.formed ? `SET — H:${session.ib_status.ib_high} L:${session.ib_status.ib_low}` : 'forming'}
- Overnight context: ${session?.overnight_context?.gap_direction || '?'} gap, ${session?.overnight_context?.overnight_character || '?'}

TRAP / STRUCTURE DATA:
- Trap risk: ${trap?.trap_risk || 'unknown'}
- Trap type detected: ${trap?.trap_type || 'none'}
- Levels at risk: ${trap?.key_levels_at_risk?.join(', ') || 'none'}
- Structure evidence: ${trap?.evidence?.join('; ') || 'none'}

Build the strongest independent bear case you can from this data. If it's genuinely weak, say so.`;

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: marketContext }],
    }),
  });

  if (!aiRes.ok) throw new Error(`Anthropic bear case ${aiRes.status}`);
  const aiData = await aiRes.json();
  const text = (aiData?.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const result = JSON.parse(text);
  result.timestamp = new Date().toISOString();
  result.instrument = instrument;
  return result;
}

module.exports = { runBearCaseAgent };
