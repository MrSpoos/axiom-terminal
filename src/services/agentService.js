// ── Agent Service ─────────────────────────────────────────────────────────────
const API_BASE = process.env.REACT_APP_API_URL || 'https://axiom-terminal-production.up.railway.app';

export async function fetchMacroAgent() {
  const r = await fetch(`${API_BASE}/api/agents/macro`);
  const d = await r.json();
  if (!r.ok || !d.success) throw new Error(d.error || 'Macro agent failed');
  return d.data;
}

export async function fetchCorrelationAgent(instrument = 'ES') {
  const r = await fetch(`${API_BASE}/api/agents/correlation?instrument=${instrument}`);
  const d = await r.json();
  if (!r.ok || !d.success) throw new Error(d.error || 'Correlation agent failed');
  return d.data;
}

export async function fetchSessionAgent(instrument = 'ES', levels = {}) {
  const params = new URLSearchParams({ instrument, ...levels });
  const r = await fetch(`${API_BASE}/api/agents/session?${params}`);
  const d = await r.json();
  if (!r.ok || !d.success) throw new Error(d.error || 'Session agent failed');
  return d.data;
}

export async function fetchTrapAgent(instrument = 'ES', levels = {}) {
  const params = new URLSearchParams({ instrument, ...levels });
  const r = await fetch(`${API_BASE}/api/agents/trap?${params}`);
  const d = await r.json();
  if (!r.ok || !d.success) throw new Error(d.error || 'Trap agent failed');
  return d.data;
}

// Tier 1 only (fast — for quick checks)
export async function fetchTier1Agents(instrument = 'ES') {
  const [macroResult, corrResult] = await Promise.allSettled([
    fetchMacroAgent(),
    fetchCorrelationAgent(instrument),
  ]);
  return {
    macro:       macroResult.status === 'fulfilled' ? macroResult.value : { error: macroResult.reason?.message },
    correlation: corrResult.status  === 'fulfilled' ? corrResult.value  : { error: corrResult.reason?.message },
  };
}

// Full 6-agent + Arbiter run (all tiers)
export async function fetchFullAgentRun(instrument = 'ES', sessionLevels = null) {
  const r = await fetch(`${API_BASE}/api/agents/full`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instrument, sessionLevels }),
  });
  const d = await r.json();
  if (!r.ok || !d.success) throw new Error(d.error || 'Full agent run failed');
  return d;
}

export async function fetchVesperMemory() {
  const r = await fetch(`${API_BASE}/api/vesper/memory`);
  const d = await r.json();
  if (!r.ok || !d.success) throw new Error(d.error || 'Memory fetch failed');
  return d.data;
}

export async function postVesperReflect({ conversationHistory, marketOutcome, instrument }) {
  const r = await fetch(`${API_BASE}/api/vesper/reflect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationHistory, marketOutcome, instrument }),
  });
  const d = await r.json();
  if (!r.ok || !d.success) throw new Error(d.error || 'Reflect failed');
  return d;
}
