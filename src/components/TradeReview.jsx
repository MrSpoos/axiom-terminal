import { useState, useEffect, useCallback } from 'react';

const API_BASE = process.env.REACT_APP_API_URL || 'https://axiom-terminal-production.up.railway.app';
const JWT_KEY  = 'projectx_jwt';
const ACC_KEY  = 'projectx_account_id';
const mono     = "'IBM Plex Mono', monospace";

const RESULT_STYLE = {
  W:  { color: '#4ade80', bg: 'rgba(74,222,128,0.12)', border: 'rgba(74,222,128,0.3)', label: '✓ WIN'  },
  L:  { color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)', label: '✗ LOSS' },
  BE: { color: '#fbbf24', bg: 'rgba(251,191,36,0.10)', border: 'rgba(251,191,36,0.3)', label: '— BE'   },
};

function pxHeaders() {
  const jwt = localStorage.getItem(JWT_KEY);
  return jwt ? { 'Content-Type': 'application/json', 'x-projectx-token': jwt } : {};
}

function TradeCard({ trade, onReview, reviewing }) {
  const s = RESULT_STYLE[trade.result] || RESULT_STYLE.BE;
  const d = new Date(trade.exitTime);
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });

  return (
    <div style={{ border: `1px solid ${s.border}`, borderRadius: 8, padding: '10px 14px', background: 'rgba(10,15,30,0.7)', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', fontFamily: mono }}>{trade.instrument}</span>
        <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 3, background: trade.direction === 'LONG' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)', color: trade.direction === 'LONG' ? '#4ade80' : '#f87171', fontFamily: mono, fontWeight: 700 }}>{trade.direction}</span>
        <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 3, background: s.bg, color: s.color, fontFamily: mono, fontWeight: 700 }}>{s.label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: s.color, fontFamily: mono }}>
          ${trade.netPnl > 0 ? '+' : ''}{trade.netPnl}
        </span>
        <span style={{ fontSize: 10, color: '#475569', fontFamily: mono, marginLeft: 'auto' }}>{dateStr} {timeStr} ET</span>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 10, fontFamily: mono, color: '#64748b' }}>
        {trade.entryPrice && <span>Entry: <span style={{ color: '#cbd5e1' }}>{trade.entryPrice}</span></span>}
        <span>Exit: <span style={{ color: '#cbd5e1' }}>{trade.exitPrice}</span></span>
        <span>{trade.size} contract{trade.size !== 1 ? 's' : ''}</span>
        {trade.durationMin != null && <span>{trade.durationMin < 60 ? `${trade.durationMin}m` : `${(trade.durationMin/60).toFixed(1)}h`}</span>}
      </div>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={() => onReview(trade)} disabled={reviewing}
          style={{ fontSize: 9, padding: '3px 12px', borderRadius: 4, cursor: reviewing ? 'not-allowed' : 'pointer', fontFamily: mono, fontWeight: 600, background: reviewing ? 'rgba(74,158,255,0.05)' : 'rgba(74,158,255,0.12)', border: '1px solid rgba(74,158,255,0.3)', color: reviewing ? '#334155' : '#4a9eff' }}>
          {reviewing ? '◈ REVIEWING...' : '◈ VESPER DEBRIEF'}
        </button>
      </div>
    </div>
  );
}

function DebriefPanel({ debrief, trade, onClose }) {
  if (!debrief) return null;
  const s = RESULT_STYLE[trade?.result] || RESULT_STYLE.BE;

  // Parse bold **text** markers
  const renderBold = (text) =>
    text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith('**') && p.endsWith('**')
        ? <strong key={i} style={{ color: '#e2e8f0' }}>{p.slice(2,-2)}</strong>
        : p
    );

  return (
    <div style={{ border: `1px solid rgba(74,158,255,0.3)`, borderRadius: 8, padding: '14px 16px', background: 'rgba(5,10,25,0.95)', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#4a9eff', fontFamily: mono, letterSpacing: '0.08em' }}>◈ VESPER DEBRIEF</span>
          <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 3, background: s.bg, color: s.color, fontFamily: mono }}>{trade?.instrument} {trade?.direction} {s.label}</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}>×</button>
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.8, fontFamily: "'DM Sans', sans-serif", whiteSpace: 'pre-wrap' }}>
        {renderBold(debrief)}
      </div>
      <div style={{ marginTop: 10, fontSize: 9, color: '#334155', fontFamily: mono }}>
        ◈ This debrief has been saved to Vesper's memory — she will reference it in future sessions.
      </div>
    </div>
  );
}

export default function TradeReview() {
  const [accountId, setAccountId]   = useState(() => localStorage.getItem(ACC_KEY) || '');
  const [days, setDays]             = useState(14);
  const [trades, setTrades]         = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [reviewing, setReviewing]   = useState(null); // tradeId being reviewed
  const [debriefs, setDebriefs]     = useState({});   // tradeId → debrief text
  const [stats, setStats]           = useState(null);

  const fetchTrades = useCallback(async () => {
    if (!accountId) return;
    setLoading(true); setError(null);
    try {
      localStorage.setItem(ACC_KEY, accountId);
      const r = await fetch(`${API_BASE}/api/projectx/trades?accountId=${accountId}&days=${days}`, {
        headers: pxHeaders(),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || `HTTP ${r.status}`);
      setTrades(d.trades);
      // Compute stats
      const wins   = d.trades.filter(t => t.result === 'W').length;
      const losses = d.trades.filter(t => t.result === 'L').length;
      const be     = d.trades.filter(t => t.result === 'BE').length;
      const netPnl = d.trades.reduce((s, t) => s + t.netPnl, 0);
      const avgWin = wins ? d.trades.filter(t => t.result === 'W').reduce((s, t) => s + t.netPnl, 0) / wins : 0;
      const avgLoss = losses ? d.trades.filter(t => t.result === 'L').reduce((s, t) => s + t.netPnl, 0) / losses : 0;
      setStats({ wins, losses, be, total: d.trades.length, netPnl: +netPnl.toFixed(2), winRate: d.trades.length ? Math.round(wins / d.trades.length * 100) : 0, avgWin: +avgWin.toFixed(0), avgLoss: +avgLoss.toFixed(0) });
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [accountId, days]);

  const handleReview = useCallback(async (trade) => {
    setReviewing(trade.id);
    try {
      const r = await fetch(`${API_BASE}/api/vesper/review-trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade, agentContext: null }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Review failed');
      setDebriefs(prev => ({ ...prev, [trade.id]: d.debrief }));
    } catch (err) { setError(err.message); }
    finally { setReviewing(null); }
  }, []);

  const jwt = localStorage.getItem(JWT_KEY);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', fontFamily: "'DM Sans', sans-serif" }}>

      {/* Header */}
      <div style={{ padding: '10px 14px', background: 'rgba(10,15,30,0.8)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#4a9eff', fontFamily: mono }}>◈ TRADE REVIEW</span>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
        {!jwt && <span style={{ fontSize: 10, color: '#f87171', fontFamily: mono }}>⚠ Connect ProjectX first (VESPER tab)</span>}
        <input value={accountId} onChange={e => setAccountId(e.target.value)} placeholder="Account ID"
          style={{ fontFamily: mono, fontSize: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '4px 8px', color: '#e2e8f0', width: 120 }} />
        <select value={days} onChange={e => setDays(parseInt(e.target.value))}
          style={{ fontFamily: mono, fontSize: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, padding: '4px 8px', color: '#e2e8f0' }}>
          {[7,14,30,60,90].map(d => <option key={d} value={d}>{d} days</option>)}
        </select>
        <button onClick={fetchTrades} disabled={loading || !accountId || !jwt}
          style={{ fontSize: 10, padding: '4px 14px', borderRadius: 4, cursor: loading || !accountId || !jwt ? 'not-allowed' : 'pointer', fontFamily: mono, fontWeight: 600, background: 'rgba(74,158,255,0.18)', border: '1px solid rgba(74,158,255,0.4)', color: '#4a9eff', opacity: !accountId || !jwt ? 0.4 : 1 }}>
          {loading ? '⟳ LOADING...' : '▶ FETCH TRADES'}
        </button>
        {stats && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, fontSize: 10, fontFamily: mono }}>
            <span style={{ color: '#4ade80' }}>{stats.wins}W</span>
            <span style={{ color: '#f87171' }}>{stats.losses}L</span>
            <span style={{ color: '#fbbf24' }}>{stats.winRate}%</span>
            <span style={{ color: stats.netPnl >= 0 ? '#4ade80' : '#f87171' }}>${stats.netPnl >= 0 ? '+' : ''}{stats.netPnl}</span>
          </div>
        )}
      </div>

      {error && <div style={{ padding: '8px 14px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, fontSize: 11, color: '#f87171', fontFamily: mono }}>✗ {error}</div>}

      {/* Stats bar */}
      {stats && stats.total > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {[
            { label: 'TRADES', value: stats.total, color: '#94a3b8' },
            { label: 'WIN RATE', value: `${stats.winRate}%`, color: stats.winRate >= 50 ? '#4ade80' : '#f87171' },
            { label: 'AVG WIN', value: `$+${stats.avgWin}`, color: '#4ade80' },
            { label: 'AVG LOSS', value: `$${stats.avgLoss}`, color: '#f87171' },
          ].map(s => (
            <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, padding: '8px 12px' }}>
              <div style={{ fontSize: 9, color: '#475569', fontFamily: mono, marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: s.color, fontFamily: mono }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Trade list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!trades.length && !loading && !error && (
          <div style={{ textAlign: 'center', padding: 40, color: '#334155', fontFamily: mono, fontSize: 11 }}>
            Enter your Account ID and click FETCH TRADES
          </div>
        )}
        {trades.map(trade => (
          <div key={trade.id}>
            {debriefs[trade.id] && <DebriefPanel debrief={debriefs[trade.id]} trade={trade} onClose={() => setDebriefs(p => ({ ...p, [trade.id]: null }))} />}
            <TradeCard trade={trade} onReview={handleReview} reviewing={reviewing === trade.id} />
          </div>
        ))}
      </div>
    </div>
  );
}
