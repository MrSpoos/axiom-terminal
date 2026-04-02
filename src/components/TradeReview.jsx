import { useState, useEffect, useCallback, useRef } from 'react';
import { ACCOUNT_KEY } from '../services/projectx';

const API_BASE  = process.env.REACT_APP_API_URL || 'https://axiom-terminal-production.up.railway.app';
const JWT_KEY   = 'projectx_jwt';
const SEEN_KEY  = 'vesper_debriefed_trades'; // localStorage set of trade IDs already debriefed
const DAYS      = 14;
const mono      = "'IBM Plex Mono', monospace";

const RESULT_STYLE = {
  W:  { color: '#4ade80', bg: 'rgba(74,222,128,0.12)',  border: 'rgba(74,222,128,0.3)',  label: '✓ WIN'  },
  L:  { color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)', label: '✗ LOSS' },
  BE: { color: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  border: 'rgba(251,191,36,0.3)',  label: '— BE'   },
};

function pxHeaders() {
  const jwt = localStorage.getItem(JWT_KEY);
  return jwt ? { 'Content-Type': 'application/json', 'x-projectx-token': jwt } : null;
}

function getSeenIds() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
  catch { return new Set(); }
}
function markSeen(id) {
  const seen = getSeenIds();
  seen.add(String(id));
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
}

function TradeCard({ trade, onReview, reviewing, debriefed }) {
  const s = RESULT_STYLE[trade.result] || RESULT_STYLE.BE;
  const d = new Date(trade.exitTime);
  const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
  return (
    <div style={{ border: `1px solid ${debriefed ? 'rgba(74,158,255,0.2)' : s.border}`, borderRadius: 8, padding: '10px 14px', background: 'rgba(10,15,30,0.7)', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', fontFamily: mono }}>{trade.instrument}</span>
        <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 3, background: trade.direction === 'LONG' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)', color: trade.direction === 'LONG' ? '#4ade80' : '#f87171', fontFamily: mono, fontWeight: 700 }}>{trade.direction}</span>
        <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 3, background: s.bg, color: s.color, fontFamily: mono, fontWeight: 700 }}>{s.label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: s.color, fontFamily: mono }}>${trade.netPnl > 0 ? '+' : ''}{trade.netPnl}</span>
        <span style={{ fontSize: 10, color: '#475569', fontFamily: mono, marginLeft: 'auto' }}>{dateStr} {timeStr} ET</span>
        {debriefed && <span style={{ fontSize: 9, color: '#4a9eff', fontFamily: mono }}>◈ reviewed</span>}
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
          {reviewing ? '◈ REVIEWING...' : debriefed ? '◈ RE-DEBRIEF' : '◈ VESPER DEBRIEF'}
        </button>
      </div>
    </div>
  );
}

function DebriefPanel({ debrief, trade, onClose }) {
  const s = RESULT_STYLE[trade?.result] || RESULT_STYLE.BE;
  const renderBold = t => t.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i} style={{ color: '#e2e8f0' }}>{p.slice(2,-2)}</strong> : p
  );
  return (
    <div style={{ border: '1px solid rgba(74,158,255,0.3)', borderRadius: 8, padding: '14px 16px', background: 'rgba(5,10,25,0.95)', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#4a9eff', fontFamily: mono, letterSpacing: '0.08em' }}>◈ VESPER DEBRIEF</span>
          <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 3, background: s.bg, color: s.color, fontFamily: mono }}>{trade?.instrument} {trade?.direction} {s.label}</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 14 }}>×</button>
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{renderBold(debrief)}</div>
      <div style={{ marginTop: 10, fontSize: 9, color: '#334155', fontFamily: mono }}>◈ Saved to Vesper memory — she will reference this in future sessions.</div>
    </div>
  );
}

export default function TradeReview() {
  const [trades, setTrades]           = useState([]);
  const [loading, setLoading]         = useState(false);
  const [autoStatus, setAutoStatus]   = useState('idle'); // idle | fetching | debriefing | done
  const [error, setError]             = useState(null);
  const [reviewing, setReviewing]     = useState(null);
  const [debriefs, setDebriefs]       = useState({});
  const [seenIds, setSeenIds]         = useState(() => getSeenIds());
  const [stats, setStats]             = useState(null);
  const [lastFetch, setLastFetch]     = useState(null);
  const autoTimerRef                  = useRef(null);

  // Compute stats from trades
  const computeStats = useCallback((t) => {
    if (!t.length) return null;
    const wins   = t.filter(x => x.result === 'W');
    const losses = t.filter(x => x.result === 'L');
    const netPnl = t.reduce((s, x) => s + x.netPnl, 0);
    return {
      total: t.length, wins: wins.length, losses: losses.length,
      winRate: Math.round(wins.length / t.length * 100),
      netPnl: +netPnl.toFixed(2),
      avgWin:  wins.length  ? +(wins.reduce((s,x)=>s+x.netPnl,0)/wins.length).toFixed(0)   : 0,
      avgLoss: losses.length ? +(losses.reduce((s,x)=>s+x.netPnl,0)/losses.length).toFixed(0) : 0,
    };
  }, []);

  // Core fetch function
  const fetchTrades = useCallback(async (silent = false) => {
    const headers = pxHeaders();
    const accountId = localStorage.getItem(ACCOUNT_KEY);
    if (!headers || !accountId) return [];
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/projectx/trades?accountId=${accountId}&days=${DAYS}`, { headers });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || `HTTP ${r.status}`);
      setTrades(d.trades);
      setStats(computeStats(d.trades));
      setLastFetch(new Date());
      return d.trades;
    } catch (err) {
      if (!silent) setError(err.message);
      return [];
    } finally {
      if (!silent) setLoading(false);
    }
  }, [computeStats]);

  // Auto-debrief new trades (ones not yet seen)
  const autoDebrief = useCallback(async (tradeList) => {
    const seen = getSeenIds();
    const newTrades = tradeList.filter(t => !seen.has(String(t.id)));
    if (!newTrades.length) return;
    setAutoStatus('debriefing');
    for (const trade of newTrades.slice(0, 5)) { // max 5 auto at a time
      try {
        const r = await fetch(`${API_BASE}/api/vesper/review-trade`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trade, agentContext: null }),
        });
        const d = await r.json();
        if (d.success) {
          setDebriefs(prev => ({ ...prev, [trade.id]: d.debrief }));
          markSeen(trade.id);
          setSeenIds(getSeenIds());
        }
      } catch {} // silent failures — don't block other debriefs
      await new Promise(res => setTimeout(res, 1500)); // brief pause between calls
    }
    setAutoStatus('done');
    setTimeout(() => setAutoStatus('idle'), 3000);
  }, []);

  // Initial load on mount
  useEffect(() => {
    const jwt = localStorage.getItem(JWT_KEY);
    const accountId = localStorage.getItem(ACCOUNT_KEY);
    if (jwt && accountId) {
      fetchTrades().then(autoDebrief);
    }
  }, [fetchTrades, autoDebrief]);

  // Auto-refresh every 4 hours
  useEffect(() => {
    const INTERVAL = 4 * 60 * 60 * 1000;
    autoTimerRef.current = setInterval(async () => {
      setAutoStatus('fetching');
      const t = await fetchTrades(true);
      await autoDebrief(t);
    }, INTERVAL);
    return () => clearInterval(autoTimerRef.current);
  }, [fetchTrades, autoDebrief]);

  const handleManualReview = useCallback(async (trade) => {
    setReviewing(trade.id);
    try {
      const r = await fetch(`${API_BASE}/api/vesper/review-trade`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade, agentContext: null }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) throw new Error(d.error || 'Review failed');
      setDebriefs(prev => ({ ...prev, [trade.id]: d.debrief }));
      markSeen(trade.id);
      setSeenIds(getSeenIds());
    } catch (err) { setError(err.message); }
    finally { setReviewing(null); }
  }, []);

  const jwt       = localStorage.getItem(JWT_KEY);
  const accountId = localStorage.getItem(ACCOUNT_KEY);
  const isReady   = !!(jwt && accountId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '10px 14px', background: 'rgba(10,15,30,0.8)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#4a9eff', fontFamily: mono }}>◈ TRADE REVIEW</span>
        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />
        {!isReady && <span style={{ fontSize: 10, color: '#f87171', fontFamily: mono }}>⚠ Connect ProjectX first — account auto-detected on login</span>}
        {isReady && <span style={{ fontSize: 9, color: '#475569', fontFamily: mono }}>Account: {accountId} · Last {DAYS} days</span>}
        <div style={{ flex: 1 }} />
        {autoStatus === 'fetching'   && <span style={{ fontSize: 9, color: '#4a9eff', fontFamily: mono, animation: 'pulse 1s infinite' }}>◈ Syncing trades...</span>}
        {autoStatus === 'debriefing' && <span style={{ fontSize: 9, color: '#a78bfa', fontFamily: mono, animation: 'pulse 1s infinite' }}>◈ Vesper reviewing new trades...</span>}
        {autoStatus === 'done'       && <span style={{ fontSize: 9, color: '#4ade80', fontFamily: mono }}>◈ Auto-review complete</span>}
        {lastFetch && <span style={{ fontSize: 9, color: '#334155', fontFamily: mono }}>Last sync: {lastFetch.toLocaleTimeString()}</span>}
        <button onClick={() => fetchTrades().then(autoDebrief)} disabled={loading || !isReady}
          style={{ fontSize: 9, padding: '3px 10px', borderRadius: 4, cursor: loading || !isReady ? 'not-allowed' : 'pointer', fontFamily: mono, background: 'rgba(74,158,255,0.12)', border: '1px solid rgba(74,158,255,0.3)', color: '#4a9eff', opacity: !isReady ? 0.4 : 1 }}>
          {loading ? '⟳' : '↻ SYNC'}
        </button>
      </div>

      {/* Stats */}
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

      {error && <div style={{ padding: '8px 14px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, fontSize: 11, color: '#f87171', fontFamily: mono }}>✗ {error}</div>}

      {/* Empty states */}
      {!isReady && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: '#334155' }}>
          <div style={{ fontSize: 28, opacity: 0.3 }}>◈</div>
          <div style={{ fontSize: 11, fontFamily: mono, letterSpacing: '0.06em' }}>CONNECT PROJECTX TO AUTO-LOAD TRADES</div>
          <div style={{ fontSize: 10, fontFamily: mono, color: '#1e293b' }}>Account ID is detected automatically on login</div>
        </div>
      )}
      {isReady && !loading && trades.length === 0 && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontFamily: mono, fontSize: 11 }}>No trades found in the last {DAYS} days</div>
      )}

      {/* Trade list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {trades.map(trade => (
          <div key={trade.id}>
            {debriefs[trade.id] && <DebriefPanel debrief={debriefs[trade.id]} trade={trade} onClose={() => setDebriefs(p => ({ ...p, [trade.id]: null }))} />}
            <TradeCard trade={trade} onReview={handleManualReview} reviewing={reviewing === trade.id} debriefed={seenIds.has(String(trade.id))} />
          </div>
        ))}
      </div>
    </div>
  );
}
