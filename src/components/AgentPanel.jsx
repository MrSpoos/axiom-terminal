import React, { useState, useCallback } from 'react';
import { fetchTier1Agents, fetchFullAgentRun } from '../services/agentService';

const INSTRUMENTS = ['ES', 'NQ', 'GC', 'CL'];

const RISK_COLORS = {
  none:    { bg: 'rgba(5,46,22,0.4)',   border: '#166534', text: '#4ade80' },
  low:     { bg: 'rgba(5,46,22,0.4)',   border: '#166534', text: '#4ade80' },
  medium:  { bg: 'rgba(42,34,0,0.5)',   border: '#854d0e', text: '#fbbf24' },
  high:    { bg: 'rgba(42,21,0,0.5)',   border: '#9a3412', text: '#fb923c' },
  extreme: { bg: 'rgba(42,10,10,0.5)', border: '#7f1d1d', text: '#f87171' },
};
const VERDICT_COLORS = {
  clear:   { bg: 'rgba(5,46,22,0.5)',  text: '#4ade80', label: '✓ CLEAR' },
  caution: { bg: 'rgba(67,20,7,0.5)',  text: '#fbbf24', label: '⚠ CAUTION' },
  avoid:   { bg: 'rgba(59,1,1,0.5)',   text: '#f87171', label: '✗ AVOID' },
};
const ALIGN_COLORS = { confirming: '#4ade80', neutral: '#94a3b8', contradicting: '#f87171' };
const TRAP_COLORS  = { none: '#4ade80', low: '#94a3b8', medium: '#fbbf24', high: '#f87171' };
const DA_COLORS    = { thesis_holds: '#4ade80', thesis_fragile: '#fbbf24', thesis_weak: '#f87171' };
const BC_COLORS    = { strong: '#f87171', moderate: '#fbbf24', weak: '#94a3b8', no_case: '#4ade80' };

const mono = "'IBM Plex Mono', monospace";

function SectionLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', color: '#475569', fontFamily: mono, marginBottom: 8, textTransform: 'uppercase' }}>{children}</div>;
}

function AgentCard({ children, color, style = {} }) {
  return (
    <div style={{ border: `1px solid ${color || '#1e293b'}`, borderRadius: 8, padding: 14, background: 'rgba(10,15,30,0.6)', marginBottom: 10, ...style }}>
      {children}
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4, fontFamily: mono }}>
      <span style={{ color: '#475569' }}>{label}</span>
      <span style={{ color: color || '#e2e8f0', fontWeight: 600 }}>{value ?? '—'}</span>
    </div>
  );
}

function scoreBar(score, label) {
  const pct = ((score + 100) / 200 * 100).toFixed(0);
  const color = score > 20 ? '#4ade80' : score < -20 ? '#f87171' : '#fbbf24';
  return (
    <div style={{ margin: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#475569', marginBottom: 3, fontFamily: mono }}>
        <span>Bear −100</span>
        <span style={{ color, fontWeight: 700 }}>{label || 'Tailwind'}: {score > 0 ? '+' : ''}{score}</span>
        <span>Bull +100</span>
      </div>
      <div style={{ background: '#0f172a', borderRadius: 4, height: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.5s' }} />
      </div>
    </div>
  );
}

function probBar(bull, bear) {
  return (
    <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 28, border: '1px solid #1e293b', margin: '10px 0' }}>
      <div style={{ width: `${bull}%`, background: '#166534', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#4ade80', fontFamily: mono, transition: 'width 0.5s' }}>
        {bull > 15 ? `Bull ${bull}%` : ''}
      </div>
      <div style={{ width: `${bear}%`, background: '#7f1d1d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#f87171', fontFamily: mono, transition: 'width 0.5s' }}>
        {bear > 15 ? `Bear ${bear}%` : ''}
      </div>
    </div>
  );
}

// ── Individual agent display cards ───────────────────────────────────────────

function MacroCard({ data }) {
  if (!data) return null;
  if (data.error) return <AgentCard color="#7f1d1d"><span style={{ color: '#f87171', fontSize: 11, fontFamily: mono }}>Macro error: {data.error}</span></AgentCard>;
  const risk = RISK_COLORS[data.event_risk_level] || RISK_COLORS.low;
  const verdict = VERDICT_COLORS[data.setup_verdict] || VERDICT_COLORS.clear;
  return (
    <AgentCard color={risk.border}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <SectionLabel>Macro / Catalyst</SectionLabel>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, border: `1px solid ${risk.border}`, color: risk.text, fontFamily: mono, fontWeight: 700 }}>{(data.event_risk_level || 'low').toUpperCase()}</span>
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: verdict.bg, color: verdict.text, fontFamily: mono, fontWeight: 700 }}>{verdict.label}</span>
        </div>
      </div>
      {data.next_event?.name && (
        <div style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 8, padding: '5px 8px', background: 'rgba(0,0,0,0.3)', borderRadius: 4, fontFamily: mono }}>
          Next: <strong>{data.next_event.name}</strong>
          {data.next_event.time_et && <span style={{ color: '#64748b' }}> @ {data.next_event.time_et} ET</span>}
          {data.next_event.time_until_hours != null && <span style={{ color: data.next_event.time_until_hours < 2 ? '#f87171' : '#fbbf24' }}> ({data.next_event.time_until_hours}h)</span>}
        </div>
      )}
      <p style={{ fontSize: 11, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>{data.thesis}</p>
      {data.events_next_48h?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {data.events_next_48h.slice(0, 4).map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 10, color: '#64748b', marginBottom: 2, fontFamily: mono }}>
              <span style={{ minWidth: 42 }}>{e.time_et}</span>
              <span style={{ color: e.impact === 'extreme' ? '#f87171' : e.impact === 'high' ? '#fb923c' : e.impact === 'medium' ? '#fbbf24' : '#475569' }}>[{(e.impact || '').toUpperCase()}]</span>
              <span style={{ color: '#94a3b8' }}>{e.name}</span>
            </div>
          ))}
        </div>
      )}
    </AgentCard>
  );
}

function CorrelationCard({ data }) {
  if (!data) return null;
  if (data.error) return <AgentCard color="#7f1d1d"><span style={{ color: '#f87171', fontSize: 11, fontFamily: mono }}>Correlation error: {data.error}</span></AgentCard>;
  const alignColor = ALIGN_COLORS[data.alignment] || '#94a3b8';
  return (
    <AgentCard color="#1e3a5f">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <SectionLabel>Correlation — {data.instrument}</SectionLabel>
        <span style={{ fontSize: 10, fontWeight: 700, color: alignColor, fontFamily: mono }}>{(data.alignment || 'neutral').toUpperCase()}</span>
      </div>
      {scoreBar(data.tailwind_score ?? 0)}
      {data.readings && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, margin: '8px 0' }}>
          {[
            { l: 'DXY', p: data.readings.dxy_price, pct: data.readings.dxy_change_pct, sub: data.readings.dxy_trend },
            { l: 'VIX', p: data.readings.vix_price, pct: data.readings.vix_change_pct, sub: data.readings.vix_level },
            { l: 'ZN',  p: data.readings.zn_price,  pct: data.readings.zn_change_pct,  sub: data.readings.bonds_trend },
          ].map(item => (
            <div key={item.l} style={{ background: '#0f172a', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 9, color: '#475569', fontFamily: mono }}>{item.l}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', fontFamily: mono }}>{item.p ?? '—'}</div>
              <div style={{ fontSize: 10, color: item.pct > 0 ? '#4ade80' : item.pct < 0 ? '#f87171' : '#64748b', fontFamily: mono }}>{item.pct != null ? `${item.pct > 0 ? '+' : ''}${item.pct}%` : '—'}</div>
              {item.sub && <div style={{ fontSize: 9, color: '#475569', fontFamily: mono, marginTop: 2 }}>{item.sub.toUpperCase()}</div>}
            </div>
          ))}
        </div>
      )}
      <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0', lineHeight: 1.5 }}>{data.thesis}</p>
    </AgentCard>
  );
}

function SessionCard({ data }) {
  if (!data) return null;
  if (data.error) return <AgentCard color="#7f1d1d"><span style={{ color: '#f87171', fontSize: 11, fontFamily: mono }}>Session error: {data.error}</span></AgentCard>;
  const vpColor = data.value_position === 'above_vah' ? '#4ade80' : data.value_position === 'below_val' ? '#f87171' : '#fbbf24';
  return (
    <AgentCard color="#1e293b">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <SectionLabel>Session Behavior — {data.instrument}</SectionLabel>
        <span style={{ fontSize: 10, color: vpColor, fontWeight: 700, fontFamily: mono }}>{(data.value_position || 'unknown').replace('_', ' ').toUpperCase()}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        <Row label="Day type" value={(data.day_type_in_progress || '—').replace('_', ' ')} color="#e2e8f0" />
        <Row label="Confidence" value={data.day_type_confidence} />
        <Row label="Phase" value={(data.session_phase || '—').replace('_', ' ')} />
        <Row label="IB formed" value={data.ib_status?.formed ? 'YES' : 'NO'} color={data.ib_status?.formed ? '#4ade80' : '#fbbf24'} />
      </div>
      {data.ib_status?.formed && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontFamily: mono, fontSize: 11 }}>
          <span style={{ color: '#64748b' }}>IB High: <span style={{ color: '#e2e8f0' }}>{data.ib_status.ib_high}</span></span>
          <span style={{ color: '#64748b' }}>IB Low: <span style={{ color: '#e2e8f0' }}>{data.ib_status.ib_low}</span></span>
          <span style={{ color: '#64748b' }}>Ext: <span style={{ color: data.ib_status.extension !== 'none' ? '#fbbf24' : '#4ade80' }}>{data.ib_status.extension}</span></span>
        </div>
      )}
      <p style={{ fontSize: 11, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>{data.thesis}</p>
    </AgentCard>
  );
}

function TrapCard({ data }) {
  if (!data) return null;
  if (data.error) return <AgentCard color="#7f1d1d"><span style={{ color: '#f87171', fontSize: 11, fontFamily: mono }}>Trap error: {data.error}</span></AgentCard>;
  const trapColor = TRAP_COLORS[data.trap_risk] || '#94a3b8';
  return (
    <AgentCard color={data.trap_risk === 'high' ? '#7f1d1d' : data.trap_risk === 'medium' ? '#854d0e' : '#1e293b'}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <SectionLabel>Trap Detector — {data.instrument}</SectionLabel>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: trapColor, fontWeight: 700, fontFamily: mono }}>{(data.trap_risk || 'none').toUpperCase()} RISK</span>
          {data.trap_type !== 'none' && <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 3, background: 'rgba(248,113,113,0.15)', color: '#f87171', fontFamily: mono }}>{data.trap_type.replace('_', ' ').toUpperCase()}</span>}
        </div>
      </div>
      {data.key_levels_at_risk?.length > 0 && (
        <div style={{ marginBottom: 8, fontSize: 11, fontFamily: mono }}>
          <span style={{ color: '#475569' }}>Levels at risk: </span>
          {data.key_levels_at_risk.map((l, i) => <span key={i} style={{ color: '#fbbf24', marginRight: 8 }}>{l}</span>)}
        </div>
      )}
      {data.evidence?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {data.evidence.slice(0, 3).map((e, i) => <div key={i} style={{ fontSize: 10, color: '#64748b', fontFamily: mono, marginBottom: 2 }}>· {e}</div>)}
        </div>
      )}
      <p style={{ fontSize: 11, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>{data.thesis}</p>
    </AgentCard>
  );
}

function DevilsAdvocateCard({ data }) {
  if (!data) return null;
  if (data.error) return <AgentCard color="#7f1d1d"><span style={{ color: '#f87171', fontSize: 11, fontFamily: mono }}>Devil's Advocate error: {data.error}</span></AgentCard>;
  const vColor = DA_COLORS[data.verdict] || '#94a3b8';
  return (
    <AgentCard color="#3b1f00">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <SectionLabel>Devil's Advocate</SectionLabel>
        <span style={{ fontSize: 10, fontWeight: 700, color: vColor, fontFamily: mono }}>{(data.verdict || '—').replace('_', ' ').toUpperCase()}</span>
      </div>
      {scoreBar(-(data.stress_score ?? 50), 'Stress')}
      {data.weakest_link && <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 8, padding: '5px 8px', background: 'rgba(120,53,15,0.3)', borderRadius: 4, fontFamily: mono }}>⚡ Weakest link: {data.weakest_link}</div>}
      {data.failure_scenarios?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {data.failure_scenarios.slice(0, 3).map((s, i) => <div key={i} style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2, fontFamily: mono }}>· {s}</div>)}
        </div>
      )}
      {data.invalidation_levels?.length > 0 && (
        <div style={{ fontSize: 11, fontFamily: mono, marginBottom: 6 }}>
          <span style={{ color: '#475569' }}>Invalidation: </span>
          {data.invalidation_levels.map((l, i) => <span key={i} style={{ color: '#fb923c', marginRight: 8 }}>{l}</span>)}
        </div>
      )}
      <p style={{ fontSize: 11, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>{data.summary}</p>
    </AgentCard>
  );
}

function BearCaseCard({ data }) {
  if (!data) return null;
  if (data.error) return <AgentCard color="#7f1d1d"><span style={{ color: '#f87171', fontSize: 11, fontFamily: mono }}>Bear Case error: {data.error}</span></AgentCard>;
  const qColor = BC_COLORS[data.bear_case_quality] || '#94a3b8';
  return (
    <AgentCard color="#3b0f0f">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <SectionLabel>Bear Case — {data.instrument}</SectionLabel>
        <span style={{ fontSize: 10, fontWeight: 700, color: qColor, fontFamily: mono }}>{(data.bear_case_quality || '—').replace('_', ' ').toUpperCase()}</span>
      </div>
      {data.primary_driver && <div style={{ fontSize: 11, color: '#f87171', marginBottom: 8, fontFamily: mono }}>▼ {data.primary_driver}</div>}
      {data.supporting_evidence?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {data.supporting_evidence.slice(0, 3).map((e, i) => <div key={i} style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2, fontFamily: mono }}>· {e}</div>)}
        </div>
      )}
      {data.key_resistance_levels?.length > 0 && (
        <div style={{ fontSize: 11, fontFamily: mono, marginBottom: 4 }}>
          <span style={{ color: '#475569' }}>Resistance: </span>
          {data.key_resistance_levels.map((l, i) => <span key={i} style={{ color: '#f87171', marginRight: 8 }}>{l}</span>)}
        </div>
      )}
      {data.target_levels?.length > 0 && (
        <div style={{ fontSize: 11, fontFamily: mono, marginBottom: 6 }}>
          <span style={{ color: '#475569' }}>Targets: </span>
          {data.target_levels.map((l, i) => <span key={i} style={{ color: '#4ade80', marginRight: 8 }}>{l}</span>)}
        </div>
      )}
      <p style={{ fontSize: 11, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>{data.summary}</p>
    </AgentCard>
  );
}

function ArbiterCard({ data }) {
  if (!data) return null;
  if (data.error) return <AgentCard color="#7f1d1d"><span style={{ color: '#f87171', fontSize: 11, fontFamily: mono }}>Arbiter error: {data.error}</span></AgentCard>;
  const gateColor = data.alert_gate === 'alert' ? '#4ade80' : data.alert_gate === 'monitor' ? '#fbbf24' : '#f87171';
  const gateLabel = data.alert_gate === 'alert' ? '▲ ALERT' : data.alert_gate === 'monitor' ? '◉ MONITOR' : '✗ SUPPRESS';
  return (
    <AgentCard color={data.alert_gate === 'alert' ? '#166534' : data.alert_gate === 'monitor' ? '#854d0e' : '#7f1d1d'} style={{ background: 'rgba(5,10,20,0.8)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <SectionLabel>◈ Probability Arbiter</SectionLabel>
        <span style={{ fontSize: 11, fontWeight: 700, color: gateColor, fontFamily: mono, padding: '2px 10px', border: `1px solid ${gateColor}`, borderRadius: 4 }}>{gateLabel}</span>
      </div>
      {probBar(data.bull_pct || 50, data.bear_pct || 50)}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, fontFamily: mono, background: 'rgba(74,222,128,0.1)', color: '#4ade80' }}>Bull {data.bull_pct}%</span>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, fontFamily: mono, background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>Bear {data.bear_pct}%</span>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, fontFamily: mono, background: 'rgba(255,255,255,0.05)', color: '#94a3b8' }}>{(data.confidence_tier || 'low').toUpperCase()} CONFIDENCE</span>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 3, fontFamily: mono, background: 'rgba(255,255,255,0.05)', color: '#94a3b8' }}>{(data.dominant_narrative || '?').toUpperCase()}</span>
      </div>
      {data.veto_applied && data.veto_reason && (
        <div style={{ fontSize: 11, color: '#fb923c', marginBottom: 8, padding: '5px 8px', background: 'rgba(120,53,15,0.3)', borderRadius: 4, fontFamily: mono }}>⚠ Veto: {data.veto_reason}</div>
      )}
      <p style={{ fontSize: 12, color: '#e2e8f0', margin: 0, lineHeight: 1.6, fontFamily: "'DM Sans', sans-serif" }}>{data.synthesis}</p>
      {data.key_factors?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {data.key_factors.slice(0, 3).map((f, i) => <div key={i} style={{ fontSize: 10, color: '#64748b', fontFamily: mono, marginBottom: 2 }}>· {f}</div>)}
        </div>
      )}
    </AgentCard>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function AgentPanel({ symbolLivePrices }) {
  const [instrument, setInstrument]   = useState('ES');
  const [mode, setMode]               = useState('full'); // 'quick' | 'full'
  const [loading, setLoading]         = useState(false);
  const [results, setResults]         = useState(null);
  const [error, setError]             = useState(null);
  const [lastRun, setLastRun]         = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      if (mode === 'full') {
        const data = await fetchFullAgentRun(instrument);
        setResults({ mode: 'full', ...data });
      } else {
        const data = await fetchTier1Agents(instrument);
        setResults({ mode: 'quick', tier1: data });
      }
      setLastRun(new Date());
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [instrument, mode]);

  React.useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(run, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [autoRefresh, run]);

  const livePrice = symbolLivePrices?.[instrument];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%', fontFamily: "'DM Sans', sans-serif" }}>

      {/* ── Controls ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '10px 14px', background: 'rgba(10,15,30,0.8)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#4a9eff', fontFamily: mono }}>◈ AXIOM AGENTS</span>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
        {INSTRUMENTS.map(sym => (
          <button key={sym} onClick={() => setInstrument(sym)} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: mono, fontWeight: 600, background: instrument === sym ? 'rgba(74,158,255,0.18)' : 'transparent', border: instrument === sym ? '1px solid rgba(74,158,255,0.5)' : '1px solid rgba(255,255,255,0.1)', color: instrument === sym ? '#4a9eff' : '#475569' }}>{sym}</button>
        ))}
        {livePrice != null && <span style={{ fontSize: 10, fontFamily: mono, color: '#00d4aa', background: 'rgba(0,212,170,0.08)', border: '1px solid rgba(0,212,170,0.2)', borderRadius: 4, padding: '3px 8px' }}>● {livePrice.toFixed(2)}</span>}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          {['quick', 'full'].map(m => (
            <button key={m} onClick={() => setMode(m)} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontFamily: mono, background: mode === m ? 'rgba(74,158,255,0.15)' : 'transparent', border: mode === m ? '1px solid rgba(74,158,255,0.4)' : '1px solid rgba(255,255,255,0.1)', color: mode === m ? '#4a9eff' : '#475569' }}>
              {m === 'quick' ? 'QUICK (T1)' : 'FULL (ALL)'}
            </button>
          ))}
        </div>
        <button onClick={() => setAutoRefresh(v => !v)} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', fontFamily: mono, background: autoRefresh ? 'rgba(0,212,170,0.1)' : 'transparent', border: autoRefresh ? '1px solid rgba(0,212,170,0.3)' : '1px solid rgba(255,255,255,0.1)', color: autoRefresh ? '#00d4aa' : '#475569' }}>
          {autoRefresh ? '↻ AUTO' : '↻ OFF'}
        </button>
        <button onClick={run} disabled={loading} style={{ fontSize: 10, padding: '4px 14px', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer', fontFamily: mono, fontWeight: 600, background: loading ? 'rgba(74,158,255,0.08)' : 'rgba(74,158,255,0.18)', border: '1px solid rgba(74,158,255,0.4)', color: loading ? '#334155' : '#4a9eff' }}>
          {loading ? '● RUNNING...' : mode === 'full' ? '▶ FULL RUN' : '▶ QUICK RUN'}
        </button>
      </div>

      {lastRun && <div style={{ fontSize: 10, color: '#334155', fontFamily: mono, paddingLeft: 2 }}>Last run: {lastRun.toLocaleTimeString()} · {results?.mode === 'full' ? '6 agents + Arbiter' : 'Tier 1 only'}</div>}
      {error && <div style={{ padding: '10px 14px', background: 'rgba(127,29,29,0.3)', border: '1px solid #7f1d1d', borderRadius: 8, fontSize: 12, color: '#f87171', fontFamily: mono }}>✗ {error}</div>}

      {!results && !loading && !error && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div style={{ fontSize: 28, opacity: 0.3 }}>◈</div>
          <div style={{ fontSize: 11, fontFamily: mono, color: '#334155', letterSpacing: '0.06em' }}>SELECT MODE AND RUN AGENTS</div>
          <div style={{ fontSize: 10, color: '#1e293b', fontFamily: mono }}>QUICK: Macro + Correlation (fast) · FULL: All 6 agents + Arbiter verdict</div>
        </div>
      )}

      {loading && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <div style={{ width: 220, height: 3, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: '#4a9eff', borderRadius: 2, animation: 'loadbar 1.4s ease-in-out infinite' }} />
          </div>
          <div style={{ fontSize: 10, color: '#334155', fontFamily: mono }}>
            {mode === 'full' ? 'TIER 1 → TIER 2 → ARBITER · ' : 'AGENTS PROCESSING · '}{instrument}
          </div>
        </div>
      )}

      {results && !loading && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Arbiter goes first when full run */}
          {results.arbiter && <ArbiterCard data={results.arbiter} />}

          {/* Tier 1 */}
          {results.tier1 && <>
            <MacroCard data={results.tier1.macro} />
            <CorrelationCard data={results.tier1.correlation} />
            {results.tier1.session && <SessionCard data={results.tier1.session} />}
            {results.tier1.trap && <TrapCard data={results.tier1.trap} />}
          </>}

          {/* Tier 2 */}
          {results.tier2 && <>
            <DevilsAdvocateCard data={results.tier2.devilsAdvocate} />
            <BearCaseCard data={results.tier2.bearCase} />
          </>}
        </div>
      )}
    </div>
  );
}
