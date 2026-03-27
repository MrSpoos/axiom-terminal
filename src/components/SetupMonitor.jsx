import { useState, useEffect, useCallback } from "react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:3001";

const OPEN_LOC_COLORS = {
  above_value: { color: "#00d4aa", bg: "rgba(0,212,170,0.12)" },
  inside_value: { color: "#f6c90e", bg: "rgba(246,201,14,0.12)" },
  below_value: { color: "#ff4d6d", bg: "rgba(255,77,109,0.12)" },
  above_prev_high: { color: "#4a9eff", bg: "rgba(74,158,255,0.12)" },
  below_prev_low: { color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
};

const PB_COLORS = { PB1: "#4a9eff", PB2: "#a78bfa", PB3: "#f6c90e", PB4: "#f472b6" };
const STATUS_COLORS = { forming: "#f6c90e", monitoring: "#64748b", triggered: "#00d4aa", invalidated: "#ff4d6d" };

function formatLabel(str) {
  if (!str) return "";
  return str.replace(/_/g, " ").toUpperCase();
}

function AdrBar({ pct }) {
  const color = pct >= 80 ? "#ff4d6d" : pct >= 50 ? "#f6c90e" : "#00d4aa";
  const exhausted = pct >= 80;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 3 }}>
        <span>ADR CONSUMED</span>
        <span style={{ color }}>{pct}%{exhausted ? " | ⚡ EXHAUSTED" : ` (need 80%)`}</span>
      </div>
      <div style={{ position: "relative", height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3 }}>
        <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
        <div style={{ position: "absolute", left: "80%", top: -1, width: 1, height: 8, background: "rgba(255,255,255,0.25)" }} />
      </div>
    </div>
  );
}

function SetupCard({ setup }) {
  const [expanded, setExpanded] = useState(false);
  const pb = setup.playbook || "";
  const pbColor = PB_COLORS[pb] || "#4a9eff";
  const statusColor = STATUS_COLORS[setup.status] || "#64748b";
  const isTriggered = setup.status === "triggered";

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "8px 10px", marginBottom: 6, cursor: "pointer" }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 8, fontWeight: 700, color: pbColor, background: `${pbColor}20`, padding: "1px 5px", borderRadius: 2, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.06em" }}>{pb}</span>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#e2e8f0", fontFamily: "'IBM Plex Mono', monospace" }}>{setup.name}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 8, color: statusColor, fontFamily: "'IBM Plex Mono', monospace" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: statusColor, display: "inline-block", boxShadow: isTriggered ? `0 0 6px ${statusColor}` : "none", animation: isTriggered ? "pulse 1.5s infinite" : "none" }} />
          {formatLabel(setup.status)}
        </span>
        <span style={{ fontSize: 8, fontWeight: 700, color: setup.direction === "long" ? "#00d4aa" : "#ff4d6d", background: setup.direction === "long" ? "rgba(0,212,170,0.12)" : "rgba(255,77,109,0.12)", padding: "1px 5px", borderRadius: 2, fontFamily: "'IBM Plex Mono', monospace", marginLeft: "auto" }}>
          {(setup.direction || "").toUpperCase()}
        </span>
      </div>

      {/* Trigger condition */}
      <div style={{ borderLeft: `2px solid ${statusColor}`, paddingLeft: 8, fontSize: 10, color: "#cbd5e1", fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1.5, background: "rgba(0,0,0,0.2)", borderRadius: "0 4px 4px 0", padding: "5px 8px 5px 8px" }}>
        {setup.trigger_condition}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ marginTop: 8, fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Context met */}
          {setup.context_met?.length > 0 && (
            <div>
              <div style={{ color: "#64748b", marginBottom: 2 }}>CONTEXT MET</div>
              {setup.context_met.map((c, i) => (
                <div key={i} style={{ color: "#00d4aa", paddingLeft: 8 }}>✓ {c}</div>
              ))}
            </div>
          )}
          {/* Context not met */}
          {setup.context_not_met?.length > 0 && (
            <div>
              <div style={{ color: "#64748b", marginBottom: 2 }}>CONTEXT NOT MET</div>
              {setup.context_not_met.map((c, i) => (
                <div key={i} style={{ color: "#f6c90e", paddingLeft: 8 }}>○ {c}</div>
              ))}
            </div>
          )}
          {/* Targets */}
          {setup.targets?.length > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              {setup.targets.map((t, i) => (
                <span key={i} style={{ color: "#4a9eff", background: "rgba(74,158,255,0.08)", padding: "2px 6px", borderRadius: 3 }}>T{i + 1}: {t}</span>
              ))}
            </div>
          )}
          {/* Invalidation */}
          {setup.invalidation && (
            <div style={{ color: "#ff4d6d", background: "rgba(255,77,109,0.08)", padding: "3px 8px", borderRadius: 3 }}>
              ✕ INVALIDATION: {setup.invalidation}
            </div>
          )}
          {/* Notes */}
          {setup.notes && (
            <div style={{ color: "#a78bfa", background: "rgba(167,139,250,0.06)", padding: "3px 8px", borderRadius: 3, fontStyle: "italic" }}>
              {setup.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InstrumentPanel({ data }) {
  const hasError = !!data.error && !data.eligible_setups?.length;
  const openLoc = OPEN_LOC_COLORS[data.open_location] || { color: "#64748b", bg: "rgba(100,116,139,0.12)" };
  const adrPct = data.adr_state?.consumed_pct ?? data._context?.today?.adr_consumed_pct ?? 0;

  return (
    <div style={{ background: "rgba(10,14,26,0.85)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", fontFamily: "'IBM Plex Mono', monospace" }}>{data.instrument}</span>
          {data.open_location && (
            <span style={{ fontSize: 8, fontWeight: 700, color: openLoc.color, background: openLoc.bg, padding: "2px 6px", borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.04em" }}>
              {formatLabel(data.open_location)}
            </span>
          )}
        </div>
      </div>

      {/* Session bias */}
      {data.session_bias && (
        <div style={{ fontSize: 11, color: "#9CA3AF", fontStyle: "italic", lineHeight: 1.5, marginBottom: 2, whiteSpace: "normal", fontFamily: "'IBM Plex Mono', monospace" }}>
          <span style={{ color: "#cbd5e1" }}>BIAS: </span>
          {typeof data.session_bias === "string" ? data.session_bias.charAt(0).toUpperCase() + data.session_bias.slice(1) : data.session_bias}
        </div>
      )}

      {/* Day type */}
      {data.day_type_hypothesis && (
        <div style={{ fontSize: 9, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.04em" }}>
          {formatLabel(data.day_type_hypothesis)}
        </div>
      )}

      {/* ADR bar */}
      <AdrBar pct={adrPct} />

      {/* Divider */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "2px 0" }} />

      {/* Error state */}
      {hasError && (
        <div style={{ background: "rgba(255,77,109,0.08)", border: "1px solid rgba(255,77,109,0.2)", borderRadius: 6, padding: "8px 10px", fontSize: 10, color: "#ff4d6d", fontFamily: "'IBM Plex Mono', monospace" }}>
          ✕ {data.error}
        </div>
      )}

      {/* Setup cards */}
      {data.eligible_setups?.length > 0 ? (
        data.eligible_setups.map((s, i) => <SetupCard key={i} setup={s} />)
      ) : !hasError ? (
        <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 6, padding: "10px 12px" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 4 }}>STANDING ASIDE</div>
          {(data.no_trade_conditions || []).map((c, i) => (
            <div key={i} style={{ fontSize: 9, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", paddingLeft: 8 }}>— {c}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function SetupMonitor() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  const fetchSetups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/setup-monitor`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSetups();
    const iv = setInterval(fetchSetups, 15 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchSetups]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>
      {/* Pulse animation */}
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.08em" }}>SETUP MONITOR</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 7, fontWeight: 700, color: "#f6c90e", background: "rgba(246,201,14,0.12)", padding: "2px 6px", borderRadius: 2, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.04em" }}>⚠ 15-MIN DELAYED</span>
          {lastUpdated && (
            <span style={{ fontSize: 9, color: "#475569", fontFamily: "'IBM Plex Mono', monospace" }}>
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchSetups}
            disabled={loading}
            style={{ fontSize: 9, color: "#4a9eff", background: "none", border: "1px solid rgba(74,158,255,0.2)", borderRadius: 3, padding: "2px 8px", cursor: loading ? "wait" : "pointer", fontFamily: "'IBM Plex Mono', monospace", opacity: loading ? 0.5 : 1 }}
          >
            {loading ? "⟳ …" : "↻ REFRESH"}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: "rgba(255,77,109,0.08)", border: "1px solid rgba(255,77,109,0.2)", borderRadius: 6, padding: "6px 10px", fontSize: 10, color: "#ff4d6d", fontFamily: "'IBM Plex Mono', monospace" }}>
          ✕ {error}
        </div>
      )}

      {/* Loading state */}
      {loading && !data && (
        <div style={{ textAlign: "center", padding: 40, color: "#475569", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>
          Analysing setups…
        </div>
      )}

      {/* Instrument grid */}
      {data?.setups && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 12 }}>
          {data.setups.map((s, i) => (
            <InstrumentPanel key={s.instrument || i} data={s} />
          ))}
        </div>
      )}
    </div>
  );
}
