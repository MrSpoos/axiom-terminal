// ── Probability Arbiter Agent ─────────────────────────────────────────────────
// Reads ALL agent outputs and produces the final probability split,
// confidence tier, and alert gate decision for the SetupMonitor.

const fetch = require('node-fetch');

const SYSTEM_PROMPT = `You are the Probability Arbiter for the Axiom Terminal — the final synthesis layer.

You receive outputs from ALL agents across three tiers:
- Tier 1: Macro/Catalyst, Correlation, Session Behavior, Trap Detector
- Tier 2: Devil's Advocate, Bear Case
- Tier 3: You — synthesise everything into a final verdict

YOUR JOB:
1. Weigh the bull case vs bear case narrative strength
2. Factor in how well the Devil's Advocate was able to damage the bull thesis
3. Account for correlation alignment, macro environment, session character, and trap risk
4. Produce a probability split (must sum to 100)
5. Set a confidence tier and alert gate decision

WEIGHTING LOGIC:
- Macro agent "avoid": HARD VETO on any bull alert — force alert_gate to "suppress"
- Trap risk "high": reduce bull probability by 15-25 points
- Correlation "contradicting": reduce bull probability by 10-20 points  
- Devil's advocate verdict "thesis_weak": reduce bull probability by 20-30 points
- Bear case quality "strong": reduce bull probability by 15-25 points
- Session "trend day" + value above VAH: boost bull probability 10-15 points

ALERT GATE RULES:
- "suppress": confidence < 40, OR macro verdict = "avoid", OR trap risk = "high" AND correlation contradicting
- "monitor": confidence 40-69 — show in UI but no push notification
- "alert": confidence >= 70 AND no hard veto conditions — fire SetupMonitor notification

DOMINANT NARRATIVE:
- "bull": bull_pct > 60
- "bear": bear_pct > 60
- "contested": within 40-60 range

Be precise and honest. Do not manufacture confidence where alignment is poor. A "contested" reading with 52/48 is a valid and useful output — it tells the trader to wait for more clarity.

Respond ONLY with valid JSON, no markdown, no code fences:
{
  "agent_id": "arbiter",
  "instrument": "<ES|NQ|GC|CL>",
  "timestamp": "<ISO8601>",
  "bull_pct": <0-100>,
  "bear_pct": <0-100>,
  "confidence_tier": "<low|medium|high>",
  "alert_gate": "<suppress|monitor|alert>",
  "dominant_narrative": "<bull|bear|contested>",
  "synthesis": "<2-3 sentence plain English verdict — what is the market actually telling us right now>",
  "key_factors": ["<factor that most influenced the verdict>"],
  "veto_applied": <true|false>,
  "veto_reason": "<why alert was suppressed if applicable, else null>",
  "agent_weights_applied": {
    "macro_catalyst": "<impact: bullish|bearish|neutral>",
    "correlation": "<impact: bullish|bearish|neutral>",
    "session_behavior": "<impact: bullish|bearish|neutral>",
    "trap_detector": "<impact: bullish|bearish|neutral>",
    "devils_advocate": "<stress_score and verdict>",
    "bear_case": "<quality and primary driver>"
  }
}`;

async function runArbiterAgent(instrument, allResults, anthropicKey) {
  const { macro, correlation, session, trap, devilsAdvocate, bearCase } = allResults;

  const fullContext = `
SYNTHESISE ALL AGENT OUTPUTS FOR ${instrument}:

═══ TIER 1: SPECIALIST ANALYSIS ═══

MACRO/CATALYST AGENT:
- Risk level: ${macro?.event_risk_level || 'unknown'}
- Verdict: ${macro?.setup_verdict || 'unknown'}
- Confidence: ${macro?.confidence || '?'}/100
- Thesis: ${macro?.thesis || 'unavailable'}

CORRELATION AGENT:
- Alignment: ${corr(correlation?.alignment)}
- Tailwind score: ${correlation?.tailwind_score ?? '?'} / 100
- DXY: ${correlation?.readings?.dxy_trend || '?'} | VIX: ${correlation?.readings?.vix_level || '?'} | Bonds: ${correlation?.readings?.bonds_trend || '?'}
- Confidence: ${correlation?.confidence || '?'}/100
- Thesis: ${correlation?.thesis || 'unavailable'}

SESSION BEHAVIOR AGENT:
- Day type: ${session?.day_type_in_progress || 'unknown'} (${session?.day_type_confidence || '?'} confidence)
- Value position: ${session?.value_position || 'unknown'}
- Session phase: ${session?.session_phase || 'unknown'}
- IB extension: ${session?.ib_status?.extension || 'unknown'}
- Confidence: ${session?.confidence || '?'}/100
- Thesis: ${session?.thesis || 'unavailable'}

TRAP DETECTOR AGENT:
- Trap risk: ${trap?.trap_risk || 'unknown'}
- Trap type: ${trap?.trap_type || 'none'}
- Trap direction: ${trap?.trap_direction || 'none'}
- Evidence: ${trap?.evidence?.slice(0,3).join('; ') || 'none'}
- Confidence: ${trap?.confidence || '?'}/100
- Thesis: ${trap?.thesis || 'unavailable'}

═══ TIER 2: OPPOSITION LAYER ═══

DEVIL'S ADVOCATE (bull thesis stress-test):
- Verdict: ${devilsAdvocate?.verdict || 'unknown'}
- Stress score: ${devilsAdvocate?.stress_score ?? '?'}/100
- Weakest link: ${devilsAdvocate?.weakest_link || 'unknown'}
- Failure scenarios: ${devilsAdvocate?.failure_scenarios?.slice(0,2).join('; ') || 'none'}
- Invalidation levels: ${devilsAdvocate?.invalidation_levels?.join(', ') || 'none'}
- Summary: ${devilsAdvocate?.summary || 'unavailable'}

BEAR CASE (independent short thesis):
- Quality: ${bearCase?.bear_case_quality || 'unknown'}
- Primary driver: ${bearCase?.primary_driver || 'none'}
- Trigger: ${bearCase?.trigger_catalyst || 'none'}
- Targets: ${bearCase?.target_levels?.join(', ') || 'none'}
- Confidence: ${bearCase?.confidence || '?'}/100
- Summary: ${bearCase?.summary || 'unavailable'}

Now produce the final probability split and alert gate decision.`;

  function corr(v) { return v || 'unknown'; }

  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 900,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: fullContext }],
    }),
  });

  if (!aiRes.ok) throw new Error(`Anthropic arbiter ${aiRes.status}`);
  const aiData = await aiRes.json();
  const text = (aiData?.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const result = JSON.parse(text);
  result.timestamp = new Date().toISOString();
  result.instrument = instrument;
  return result;
}

module.exports = { runArbiterAgent };
