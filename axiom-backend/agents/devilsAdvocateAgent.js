// ── Devil's Advocate Agent ────────────────────────────────────────────────────
// Receives the current bull thesis from Tier 1 agents and stress-tests it.
// Finds every reason the bull case could be wrong.

const fetch = require('node-fetch');

const SYSTEM_PROMPT = `You are the Devil's Advocate Agent for the Axiom Terminal.

Your sole job: receive the current bull thesis and destroy it. Find every crack, weakness, and scenario where it fails. You are NOT building a bear trade — you are stress-testing the bull argument.

YOUR PROCESS:
1. Read the bull thesis and each piece of supporting evidence
2. For each piece of evidence: find the counter-argument or the scenario where it doesn't hold
3. Identify the WEAKEST single link in the bull chain — the one assumption that if wrong, breaks everything
4. Identify invalidation levels: specific prices where the bull thesis is definitively wrong
5. Score the thesis: how well does it survive your attack?

STRESS TEST FRAMEWORK:
- Is the macro environment actually supportive, or just "not bad"?
- Is the correlation alignment real, or could it reverse quickly?
- Is the session behavior genuinely bullish, or just early/ambiguous?
- Are the key levels actually respected, or is price just nearby?
- Is the trap risk genuinely low, or is this the setup before a hunt?
- What would a bear argue right now using the SAME data?

VERDICT SCALE:
- thesis_holds: Bull case survives stress test — evidence is solid across multiple dimensions
- thesis_fragile: Bull case is directionally correct but relies on 1-2 assumptions that could break
- thesis_weak: Bull case has significant holes — multiple assumptions are questionable

Respond ONLY with valid JSON, no markdown, no code fences:
{
  "agent_id": "devils_advocate",
  "instrument": "<ES|NQ|GC|CL>",
  "timestamp": "<ISO8601>",
  "bull_thesis_reviewed": "<one sentence summary of the bull case you received>",
  "failure_scenarios": ["<specific scenario where thesis fails>"],
  "counter_arguments": ["<direct counter to each piece of bull evidence>"],
  "weakest_link": "<the single most fragile assumption in the bull case>",
  "invalidation_levels": [<number>],
  "stress_score": <0-100>,
  "verdict": "<thesis_holds|thesis_fragile|thesis_weak>",
  "confidence": <0-100>,
  "summary": "<2 sentence plain English stress-test result>"
}`;

async function runDevilsAdvocateAgent(instrument, tier1Results, anthropicKey) {
  // Synthesise what the bull case looks like from Tier 1 outputs
  const macro  = tier1Results.macro;
  const corr   = tier1Results.correlation;
  const session = tier1Results.session;
  const trap   = tier1Results.trap;

  const bullContext = `
CURRENT MARKET CONTEXT FOR ${instrument}:

MACRO AGENT OUTPUT:
- Event risk: ${macro?.event_risk_level || 'unknown'}
- Setup verdict: ${macro?.setup_verdict || 'unknown'}
- Thesis: ${macro?.thesis || 'No macro data'}

CORRELATION AGENT OUTPUT:
- Alignment: ${corr?.alignment || 'unknown'}
- Tailwind score: ${corr?.tailwind_score ?? 'unknown'}
- DXY trend: ${corr?.readings?.dxy_trend || 'unknown'}
- VIX level: ${corr?.readings?.vix_level || 'unknown'}
- Bonds trend: ${corr?.readings?.bonds_trend || 'unknown'}
- Thesis: ${corr?.thesis || 'No correlation data'}

SESSION BEHAVIOR AGENT OUTPUT:
- Day type in progress: ${session?.day_type_in_progress || 'unknown'}
- Value position: ${session?.value_position || 'unknown'}
- IB status: ${session?.ib_status?.formed ? 'SET' : 'forming'} | IB High: ${session?.ib_status?.ib_high || 'N/A'} | IB Low: ${session?.ib_status?.ib_low || 'N/A'}
- Session phase: ${session?.session_phase || 'unknown'}
- Thesis: ${session?.thesis || 'No session data'}

TRAP DETECTOR OUTPUT:
- Trap risk: ${trap?.trap_risk || 'unknown'}
- Trap type: ${trap?.trap_type || 'none'}
- Evidence: ${trap?.evidence?.join('; ') || 'none'}
- Thesis: ${trap?.thesis || 'No trap data'}

Now stress-test the BULL case. Assume someone is trying to go LONG on ${instrument} based on this data. Attack their reasoning.`;

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: bullContext }],
    }),
  });

  if (!aiRes.ok) throw new Error(`Anthropic devil's advocate ${aiRes.status}`);
  const aiData = await aiRes.json();
  const text = (aiData?.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const result = JSON.parse(text);
  result.timestamp = new Date().toISOString();
  result.instrument = instrument;
  return result;
}

module.exports = { runDevilsAdvocateAgent };
