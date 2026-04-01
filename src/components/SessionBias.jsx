import { useState, useEffect, useCallback } from "react";

const API_BASE = process.env.REACT_APP_API_URL || "https://axiom-terminal-production.up.railway.app";

const AGENTS = [
  { id: "retail",        name: "Retail Trader",   emoji: "🔴", color: "#ef4444" },
  { id: "institutional", name: "Institutional",   emoji: "🔵", color: "#3b82f6" },
  { id: "algo",          name: "Systematic/Algo", emoji: "🟡", color: "#eab308" },
  { id: "marketmaker",   name: "Market Maker",    emoji: "🟢", color: "#22c55e" },
];

const BIAS_COLOR = { bullish: "#22c55e", bearish: "#ef4444", neutral: "#eab308" };

function biasColor(b) { return BIAS_COLOR[(b||"").toLowerCase()] || "#eab308"; }

function ConfidenceBar({ pct, color }) {
  return (
    <div style={{ background: "#1a1a24", borderRadius: 2, height: 4, width: "100%", overflow: "hidden" }}>
      <div style={{ height: "100%", width: pct + "%", background: color, borderRadius: 2, transition: "width 1s ease" }} />
    </div>
  );
}

function AgentCard({ agent, result, loading }) {
  return (
    <div style={{ background: "#0a0a12", border: "1px solid " + (result ? agent.color + "30" : "#13131e"), borderRadius: 3, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>{agent.emoji}</span>
          <span style={{ fontSize: 9, color: agent.color, letterSpacing: 2, fontWeight: 700 }}>{agent.name.toUpperCase()}</span>
        </div>
        {result
          ? <span style={{ fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 2, color: biasColor(result.bias), border: "1px solid " + biasColor(result.bias) + "30" }}>{(result.bias||"").toUpperCase()}</span>
          : <span style={{ fontSize: 9, color: "#2a2a3a" }}>{loading ? "PROCESSING..." : ""}</span>
        }
      </div>
      {result && (
        <div>
          <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: "#3a4060", letterSpacing: 2, marginBottom: 4 }}>CONFIDENCE</div>
              <div style={{ fontSize: 20, color: agent.color, fontWeight: 700, lineHeight: 1, marginBottom: 5 }}>{result.confidence}%</div>
              <ConfidenceBar pct={result.confidence} color={agent.color} />
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#3a4060", letterSpacing: 2, marginBottom: 4 }}>KEY LEVEL</div>
              <div style={{ fontSize: 13, color: "#c8d3e0" }}>{result.keyLevel}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#4a5570", lineHeight: 1.7, borderTop: "1px solid #13131e", paddingTop: 10 }}>{result.reasoning}</div>
        </div>
      )}
    </div>
  );
}

export default function SessionBias() {
  const [instrument, setInstrument] = useState("ES");
  const [newsContext, setNewsContext] = useState("");
  const [priorVAH, setPriorVAH] = useState("");
  const [priorVAL, setPriorVAL] = useState("");
  const [priorPOC, setPriorPOC] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [timestamp, setTimestamp] = useState(null);

  const analyze = useCallback(async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await fetch(API_BASE + "/api/session-bias", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instrument, newsContext, priorVAH, priorVAL, priorPOC }),
      });
      if (!res.ok) throw new Error("Server error: " + res.status);
      setResult(await res.json());
      setTimestamp(new Date().toLocaleTimeString());
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }, [instrument, newsContext, priorVAH, priorVAL, priorPOC]);

  useEffect(() => { analyze(); }, [instrument]);

  const s = result?.synthesis;
  const pr = result?.priceData;
  const ar = result?.agentResults;

  return (
    <div style={{ padding: "20px 16px", fontFamily: "'JetBrains Mono','Fira Code',monospace", color: "#c8d3e0", background: "#06060b", minHeight: "100vh" }}>
      <style>{`
        .axiom-input{background:#0b0b14;border:1px solid #1c1c2a;border-radius:2px;color:#c8d3e0;font-family:inherit;font-size:12px;padding:7px 10px;outline:none;width:100%;box-sizing:border-box}
        .axiom-input:focus{border-color:#f59e0b}
        .axiom-input::placeholder{color:#2e3348}
        .run-btn{background:linear-gradient(135deg,#f59e0b,#b45309);border:none;color:#000;font-family:inherit;font-weight:700;letter-spacing:3px;font-size:12px;cursor:pointer;padding:10px 32px;border-radius:2px}
        .run-btn:disabled{opacity:0.35;cursor:not-allowed}
      `}</style>

      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 5, color: "#f59e0b" }}>SESSION BIAS</span>
          <span style={{ fontSize: 10, color: "#2a2a3a", letterSpacing: 3 }}>4-AGENT SYNTHESIS</span>
          <span style={{ marginLeft: "auto", fontSize: 9, color: "#ef4444", padding: "2px 8px", border: "1px solid #ef444430", borderRadius: 2 }}>15-MIN DELAYED</span>
        </div>
        <div style={{ width: "100%", height: 1, background: "linear-gradient(90deg,#f59e0b30,transparent)" }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 9, color: "#3a4060", letterSpacing: 2, marginBottom: 5 }}>INSTRUMENT</div>
          <select className="axiom-input" value={instrument} onChange={e => setInstrument(e.target.value)}>
            <option>ES</option><option>NQ</option><option>GC</option><option>CL</option>
          </select>
        </div>
        {[["PRIOR VAH", priorVAH, setPriorVAH], ["PRIOR POC", priorPOC, setPriorPOC], ["PRIOR VAL", priorVAL, setPriorVAL]].map(([lbl, v, sv]) => (
          <div key={lbl}>
            <div style={{ fontSize: 9, color: "#3a4060", letterSpacing: 2, marginBottom: 5 }}>{lbl}</div>
            <input className="axiom-input" value={v} onChange={e => sv(e.target.value)} placeholder="Optional" />
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 9, color: "#3a4060", letterSpacing: 2, marginBottom: 5 }}>OVERNIGHT NEWS / MACRO CONTEXT</div>
        <textarea className="axiom-input" value={newsContext} onChange={e => setNewsContext(e.target.value)} placeholder="CPI hot, Fed hawkish, NVDA beat AH..." rows={2} style={{ resize: "vertical", lineHeight: 1.7 }} />
      </div>

      {pr && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: "10px 14px", background: "#0a0a12", border: "1px solid #13131e", borderRadius: 3, marginBottom: 14, fontSize: 11 }}>
          {[["PRICE", pr.current_price],["OPEN", pr.today_open],["ONH", pr.overnight_high],["ONL", pr.overnight_low],["PRIOR CLOSE", pr.prior_close]].map(([l, v]) => (
            <div key={l}><span style={{ color: "#3a4060" }}>{l} </span><span style={{ color: "#c8d3e0", fontWeight: 700 }}>{v ?? "—"}</span></div>
          ))}
          {pr.gap !== undefined && <div><span style={{ color: "#3a4060" }}>GAP </span><span style={{ color: parseFloat(pr.gap) > 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>{parseFloat(pr.gap) > 0 ? "+" : ""}{pr.gap}</span></div>}
        </div>
      )}

      <div style={{ textAlign: "center", marginBottom: 20 }}>
        <button className="run-btn" onClick={analyze} disabled={loading}>{loading ? "ANALYZING..." : "▶ ANALYZE SESSION"}</button>
        {timestamp && !loading && <div style={{ fontSize: 9, color: "#2a2a3a", marginTop: 6 }}>LAST RUN {timestamp}</div>}
      </div>

      {error && <div style={{ background: "#ef444410", border: "1px solid #ef444430", borderRadius: 3, padding: "12px 16px", color: "#ef4444", fontSize: 11, marginBottom: 16 }}>⚠ {error}</div>}

      {(loading || ar) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10, marginBottom: 14 }}>
          {AGENTS.map(a => <AgentCard key={a.id} agent={a} result={ar?.[a.id]} loading={loading} />)}
        </div>
      )}

      {s && (
        <div style={{ background: "#0a0a12", border: "1px solid " + biasColor(s.finalBias) + "25", borderRadius: 3, padding: 20 }}>
          <div style={{ fontSize: 9, color: "#f59e0b40", letterSpacing: 3, marginBottom: 14 }}>◈ AXIOM SYNTHESIS</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginBottom: 16, alignItems: "flex-end" }}>
            <div>
              <div style={{ fontSize: 9, color: "#3a4060", letterSpacing: 2, marginBottom: 4 }}>FINAL BIAS</div>
              <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: 4, color: biasColor(s.finalBias), lineHeight: 1 }}>{(s.finalBias||"").toUpperCase()}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#3a4060", letterSpacing: 2, marginBottom: 4 }}>CONFIDENCE</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "#c8d3e0", lineHeight: 1, marginBottom: 6 }}>{s.confidence}%</div>
              <div style={{ width: 100 }}><ConfidenceBar pct={s.confidence} color={biasColor(s.finalBias)} /></div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#3a4060", letterSpacing: 2, marginBottom: 6 }}>MS DAY TYPE</div>
              <div style={{ fontSize: 11, color: "#f59e0b", padding: "5px 12px", border: "1px solid #f59e0b30", borderRadius: 2, fontWeight: 700 }}>{(s.dayType||"").toUpperCase()}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#3a4060", letterSpacing: 2, marginBottom: 4 }}>WATCH LEVEL</div>
              <div style={{ fontSize: 18, color: "#c8d3e0" }}>{s.keyLevel}</div>
            </div>
          </div>
          {s.riskWarning && <div style={{ background: "#ef444408", border: "1px solid #ef444425", borderRadius: 2, padding: "8px 12px", marginBottom: 14, fontSize: 11, color: "#ef4444" }}>⚠ {s.riskWarning}</div>}
          <div style={{ fontSize: 12, color: "#5a6890", lineHeight: 1.9, borderTop: "1px solid #13131e", paddingTop: 14 }}>{s.analysis}</div>
        </div>
      )}
    </div>
  );
}
