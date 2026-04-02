import React, { useState, useCallback } from 'react';
import { fetchTier1Agents } from '../services/agentService';

const INSTRUMENTS = ['ES', 'NQ', 'GC', 'CL'];

const RISK_COLORS = {
  none:    { bg: '#1a2a1a', border: '#2d5a2d', text: '#4ade80' },
  low:     { bg: '#1a2a1a', border: '#2d5a2d', text: '#4ade80' },
  medium:  { bg: '#2a2200', border: '#5a4500', text: '#fbbf24' },
  high:    { bg: '#2a1500', border: '#6b2d00', text: '#fb923c' },
  extreme: { bg: '#2a0a0a', border: '#7f1d1d', text: '#f87171' },
};

const VERDICT_COLORS = {
  clear:   { bg: '#052e16', text: '#4ade80', label: '✓ CLEAR' },
  caution: { bg: '#431407', text: '#fbbf24', label: '⚠ CAUTION' },
  avoid:   { bg: '#3b0101', text: '#f87171', label: '✗ AVOID' },
};

const ALIGN_COLORS = {
  confirming:    { text: '#4ade80' },
  neutral:       { text: '#94a3b8' },
  contradicting: { text: '#f87171' },
};

function scoreBar(score) {
  // score is -100 to +100
  const pct = ((score + 100) / 200 * 100).toFixed(0);
  const color = score > 20 ? '#4ade80' : score < -20 ? '#f87171' : '#fbbf24';
  return (
    <div style={{ margin: '6px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 3 }}>
        <span>Bear -100</span><span style={{ color, fontWeight: 600 }}>{score > 0 ? '+' : ''}{score}</span><span>Bull +100</span>
      </div>
      <div style={{ background: '#1e293b', borderRadius: 4, height: 6, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
}


function MacroCard({ data }) {
  if (!data) return null;
  if (data.error) return <div style={{ color: '#f87171', fontSize: 12, padding: '8px 0' }}>Macro agent error: {data.error}</div>;

  const risk = RISK_COLORS[data.event_risk_level] || RISK_COLORS.low;
  const verdict = VERDICT_COLORS[data.setup_verdict] || VERDICT_COLORS.clear;

  return (
    <div style={{ border: `1px solid ${risk.border}`, borderRadius: 8, padding: 14, background: risk.bg, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: '#94a3b8' }}>MACRO / CATALYST</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: risk.bg, border: `1px solid ${risk.border}`, color: risk.text, fontWeight: 600 }}>
            {(data.event_risk_level || 'low').toUpperCase()}
          </span>
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: verdict.bg, color: verdict.text, fontWeight: 600 }}>
            {verdict.label}
          </span>
        </div>
      </div>

      {data.next_event?.name && (
        <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 8, padding: '6px 8px', background: 'rgba(0,0,0,0.3)', borderRadius: 4 }}>
          <span style={{ color: '#94a3b8' }}>Next: </span>
          <span style={{ fontWeight: 600 }}>{data.next_event.name}</span>
          {data.next_event.time_et && <span style={{ color: '#94a3b8' }}> @ {data.next_event.time_et} ET</span>}
          {data.next_event.time_until_hours != null && (
            <span style={{ color: data.next_event.time_until_hours < 2 ? '#f87171' : '#fbbf24' }}> (in {data.next_event.time_until_hours}h)</span>
          )}
        </div>
      )}

      <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px', lineHeight: 1.5 }}>{data.thesis}</p>

      {data.events_next_48h?.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: '#475569', marginBottom: 4, letterSpacing: '0.06em' }}>NEXT 48H EVENTS</div>
          {data.events_next_48h.slice(0, 5).map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 11, color: '#64748b', marginBottom: 3 }}>
              <span style={{ minWidth: 45 }}>{e.time_et}</span>
              <span style={{ color: e.impact === 'extreme' ? '#f87171' : e.impact === 'high' ? '#fb923c' : e.impact === 'medium' ? '#fbbf24' : '#64748b' }}>
                [{e.impact?.toUpperCase()}]
              </span>
              <span style={{ color: '#94a3b8', flex: 1 }}>{e.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function CorrelationCard({ data }) {
  if (!data) return null;
  if (data.error) return <div style={{ color: '#f87171', fontSize: 12, padding: '8px 0' }}>Correlation agent error: {data.error}</div>;

  const align = ALIGN_COLORS[data.alignment] || ALIGN_COLORS.neutral;
  const score = data.tailwind_score ?? 0;

  return (
    <div style={{ border: '1px solid #1e293b', borderRadius: 8, padding: 14, background: '#0f172a', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: '#94a3b8' }}>CORRELATION — {data.instrument}</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: align.text }}>
          {(data.alignment || 'neutral').toUpperCase()}
        </span>
      </div>

      {scoreBar(score)}

      {data.readings && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, margin: '10px 0' }}>
          {[
            { label: 'DXY', price: data.readings.dxy_price, pct: data.readings.dxy_change_pct, trend: data.readings.dxy_trend },
            { label: 'VIX', price: data.readings.vix_price, pct: data.readings.vix_change_pct, level: data.readings.vix_level },
            { label: 'ZN', price: data.readings.zn_price, pct: data.readings.zn_change_pct, trend: data.readings.bonds_trend },
          ].map(item => (
            <div key={item.label} style={{ background: '#1e293b', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ fontSize: 10, color: '#475569', marginBottom: 2 }}>{item.label}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{item.price ?? '—'}</div>
              <div style={{ fontSize: 11, color: item.pct > 0 ? '#4ade80' : item.pct < 0 ? '#f87171' : '#64748b' }}>
                {item.pct != null ? `${item.pct > 0 ? '+' : ''}${item.pct}%` : '—'}
              </div>
              {(item.trend || item.level) && (
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{(item.trend || item.level)?.toUpperCase()}</div>
              )}
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 12, color: '#94a3b8', margin: '8px 0 0', lineHeight: 1.5 }}>{data.thesis}</p>

      {data.warnings?.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#fbbf24' }}>
          {data.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}
    </div>
  );
}


export default function AgentPanel({ symbolLivePrices }) {
  const [instrument, setInstrument]   = useState('ES');
  const [loading, setLoading]         = useState(false);
  const [results, setResults]         = useState(null);
  const [error, setError]             = useState(null);
  const [lastRun, setLastRun]         = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTier1Agents(instrument);
      setResults(data);
      setLastRun(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [instrument]);

  // Auto-refresh every 5 minutes when enabled
  React.useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(run, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [autoRefresh, run]);

  const livePrice = symbolLivePrices?.[instrument];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>

      {/* ── Header / Controls ─────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        padding: '10px 14px', background: '#0a0f1e',
        border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8 }}>

        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.1em',
          color: '#4a9eff', fontFamily: "'IBM Plex Mono', monospace" }}>
          ◈ AXIOM AGENTS
        </span>
        <span style={{ fontSize: 9, color: '#334155', fontFamily: "'IBM Plex Mono', monospace" }}>
          TIER 1 — SPECIALIST ANALYSIS
        </span>

        <div style={{ flex: 1 }} />

        {/* Instrument selector */}
        <div style={{ display: 'flex', gap: 4 }}>
          {INSTRUMENTS.map(sym => (
            <button key={sym} onClick={() => setInstrument(sym)}
              style={{ fontSize: 10, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600,
                background: instrument === sym ? 'rgba(74,158,255,0.18)' : 'transparent',
                border: instrument === sym ? '1px solid rgba(74,158,255,0.5)' : '1px solid rgba(255,255,255,0.1)',
                color: instrument === sym ? '#4a9eff' : '#475569' }}>
              {sym}
            </button>
          ))}
        </div>

        {/* Live price pill */}
        {livePrice != null && (
          <span style={{ fontSize: 10, fontFamily: "'IBM Plex Mono', monospace",
            color: '#00d4aa', background: 'rgba(0,212,170,0.08)',
            border: '1px solid rgba(0,212,170,0.2)', borderRadius: 4, padding: '3px 8px' }}>
            ● {livePrice.toFixed(2)}
          </span>
        )}

        {/* Auto-refresh toggle */}
        <button onClick={() => setAutoRefresh(v => !v)}
          style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
            fontFamily: "'IBM Plex Mono', monospace",
            background: autoRefresh ? 'rgba(0,212,170,0.1)' : 'transparent',
            border: autoRefresh ? '1px solid rgba(0,212,170,0.3)' : '1px solid rgba(255,255,255,0.1)',
            color: autoRefresh ? '#00d4aa' : '#475569' }}>
          {autoRefresh ? '↻ AUTO ON' : '↻ AUTO OFF'}
        </button>

        {/* Run button */}
        <button onClick={run} disabled={loading}
          style={{ fontSize: 10, padding: '4px 14px', borderRadius: 4, cursor: loading ? 'not-allowed' : 'pointer',
            fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600,
            background: loading ? 'rgba(74,158,255,0.08)' : 'rgba(74,158,255,0.18)',
            border: '1px solid rgba(74,158,255,0.4)',
            color: loading ? '#334155' : '#4a9eff' }}>
          {loading ? '● RUNNING...' : '▶ RUN AGENTS'}
        </button>
      </div>

      {/* ── Last run timestamp ────────────────────────────────────── */}
      {lastRun && (
        <div style={{ fontSize: 10, color: '#334155', fontFamily: "'IBM Plex Mono', monospace", paddingLeft: 2 }}>
          Last run: {lastRun.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          {autoRefresh && <span style={{ color: '#00d4aa', marginLeft: 8 }}>· Auto-refreshing every 5 min</span>}
        </div>
      )}

      {/* ── Error state ───────────────────────────────────────────── */}
      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(255,77,109,0.08)',
          border: '1px solid rgba(255,77,109,0.25)', borderRadius: 8,
          fontSize: 12, color: '#f87171', fontFamily: "'IBM Plex Mono', monospace" }}>
          ✗ {error}
        </div>
      )}

      {/* ── Empty state ───────────────────────────────────────────── */}
      {!results && !loading && !error && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 12, color: '#334155' }}>
          <div style={{ fontSize: 28, opacity: 0.4 }}>◈</div>
          <div style={{ fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: '0.06em' }}>
            SELECT INSTRUMENT AND RUN AGENTS
          </div>
          <div style={{ fontSize: 10, color: '#1e293b' }}>
            Macro · Catalyst · Correlation · Inter-market
          </div>
        </div>
      )}

      {/* ── Loading state ─────────────────────────────────────────── */}
      {loading && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 16 }}>
          <div style={{ width: 200, height: 3, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: '#4a9eff', borderRadius: 2,
              animation: 'loadbar 1.4s ease-in-out infinite' }} />
          </div>
          <div style={{ fontSize: 10, color: '#334155', fontFamily: "'IBM Plex Mono', monospace",
            letterSpacing: '0.06em' }}>
            AGENTS PROCESSING — {instrument}
          </div>
        </div>
      )}

      {/* ── Results ───────────────────────────────────────────────── */}
      {results && !loading && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
          <MacroCard data={results.macro} />
          <CorrelationCard data={results.correlation} />
        </div>
      )}

    </div>
  );
}
