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
