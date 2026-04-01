import { useState, useEffect, useRef, useCallback } from "react";

const API_BASE = process.env.REACT_APP_API_URL || "https://axiom-terminal-production.up.railway.app";

const STARTERS = [
  "What's the best setup right now?",
  "Price just hit the key level — what should I watch for?",
  "Give me your honest read on this session",
];

const BIAS_COLOR = { bullish: "#22c55e", bearish: "#ef4444", neutral: "#eab308" };
function biasColor(b) { return BIAS_COLOR[(b||"neutral").toLowerCase()] || "#eab308"; }

function ContextPills({ ctx }) {
  if (!ctx?.sessionBias) return null;
  const bc = biasColor(ctx.sessionBias);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 14px", borderBottom: "1px solid #13131e", background: "#08080f" }}>
      <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 2, background: bc + "18", color: bc, border: "1px solid " + bc + "30", fontWeight: 700, letterSpacing: 1 }}>{(ctx.sessionBias||"").toUpperCase()}</span>
      {ctx.dayType && <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 2, background: "#f59e0b12", color: "#f59e0b", border: "1px solid #f59e0b25", letterSpacing: 1 }}>{ctx.dayType.toUpperCase()}</span>}
      {ctx.currentPrice && <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 2, background: "#1a1a24", color: "#c8d3e0", border: "1px solid #1e1e2e" }}>PRICE {ctx.currentPrice}</span>}
      {ctx.keyLevel && <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 2, background: "#1a1a24", color: "#c8d3e0", border: "1px solid #1e1e2e" }}>KEY {ctx.keyLevel}</span>}
      {ctx.adrConsumed != null && <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 2, background: "#1a1a24", color: ctx.adrConsumed >= 80 ? "#ef4444" : ctx.adrConsumed >= 50 ? "#eab308" : "#22c55e", border: "1px solid #1e1e2e" }}>ADR {ctx.adrConsumed}%</span>}
      {ctx.ibStatus && <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 2, background: "#1a1a24", color: "#6a7890", border: "1px solid #1e1e2e" }}>IB {ctx.ibStatus}</span>}
    </div>
  );
}

function Message({ msg, biasCol }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 12, animation: "fadeUp 0.3s ease forwards" }}>
      {!isUser && <div style={{ width: 2, borderRadius: 2, background: biasCol, marginRight: 10, flexShrink: 0, alignSelf: "stretch", minHeight: 20 }} />}
      <div style={{
        maxWidth: "75%",
        padding: "10px 14px",
        borderRadius: isUser ? "12px 12px 2px 12px" : "2px 12px 12px 12px",
        background: isUser ? "#f59e0b" : "#0e0e18",
        border: isUser ? "none" : "1px solid #1c1c2c",
        color: isUser ? "#000" : "#c8d3e0",
        fontSize: 12,
        lineHeight: 1.75,
        fontFamily: isUser ? "inherit" : "'JetBrains Mono','Fira Code',monospace",
        fontWeight: isUser ? 600 : 400,
      }}>
        <div dangerouslySetInnerHTML={{ __html: msg.content.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>") }} />
        <div style={{ fontSize: 9, color: isUser ? "#00000060" : "#3a4060", marginTop: 6, textAlign: isUser ? "right" : "left", letterSpacing: 1 }}>{msg.timestamp}</div>
      </div>
    </div>
  );
}

export default function TradingBuddy() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionContext, setSessionContext] = useState({});
  const [instrument, setInstrument] = useState("ES");
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const fetchContext = useCallback(async (sym) => {
    try {
      const res = await fetch(`${API_BASE}/api/session-bias?symbol=${sym}`);
      if (!res.ok) return;
      const data = await res.json();
      const s = data.synthesis || {};
      const pr = data.priceData || {};
      const setups = [];
      setSessionContext({
        instrument: sym,
        currentPrice: pr.currentPrice,
        sessionBias: s.finalBias,
        dayType: s.dayType,
        keyLevel: s.keyLevel,
        activeSetups: setups,
        vah: pr.vah || data.vah,
        val: pr.val || data.val,
        poc: pr.poc || data.poc,
        adrConsumed: data.adrConsumed,
        ibStatus: data.ibStatus,
        vix: data.vix,
        gap: pr.gap,
        riskWarning: s.riskWarning,
      });
    } catch {}
  }, []);

  useEffect(() => { fetchContext(instrument); }, [instrument, fetchContext]);
  useEffect(() => { const t = setInterval(() => fetchContext(instrument), 60000); return () => clearInterval(t); }, [instrument, fetchContext]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = useCallback(async (text) => {
    const content = (text || input).trim();
    if (!content || loading) return;
    setInput("");
    const ts = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const userMsg = { role: "user", content, timestamp: ts };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/trading-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          sessionContext,
        }),
      });
      if (!res.ok) throw new Error("Server error " + res.status);
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.reply, timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: "assistant", content: "⚠ " + err.message, timestamp: ts }]);
    }
    setLoading(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [input, loading, messages, sessionContext]);

  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
  const bc = biasColor(sessionContext.sessionBias);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 120px)", background: "#06060b", fontFamily: "'JetBrains Mono','Fira Code',monospace", color: "#c8d3e0" }}>
      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
        .buddy-input { background:#0b0b14; border:1px solid #1c1c2a; border-radius:2px; color:#c8d3e0; font-family:inherit; font-size:12px; padding:10px 12px; outline:none; resize:none; width:100%; box-sizing:border-box; line-height:1.6; }
        .buddy-input:focus { border-color:#f59e0b; }
        .buddy-input::placeholder { color:#2e3348; }
        .send-btn { background:linear-gradient(135deg,#f59e0b,#b45309); border:none; color:#000; font-family:inherit; font-weight:700; font-size:11px; letter-spacing:2px; cursor:pointer; padding:10px 20px; border-radius:2px; white-space:nowrap; transition:all 0.2s; }
        .send-btn:hover { transform:translateY(-1px); box-shadow:0 4px 16px rgba(245,158,11,0.25); }
        .send-btn:disabled { opacity:0.35; cursor:not-allowed; transform:none; }
        .starter-chip { background:#0e0e18; border:1px solid #1c1c2c; border-radius:20px; padding:7px 14px; font-size:11px; color:#6a7890; cursor:pointer; transition:all 0.2s; font-family:inherit; }
        .starter-chip:hover { border-color:#f59e0b60; color:#c8d3e0; }
      `}</style>

      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #13131e", display: "flex", alignItems: "center", gap: 10, background: "#08080f" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 6px #22c55e", animation: "pulse 2s infinite" }} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 4, color: "#f59e0b" }}>TRADING BUDDY</span>
          <span style={{ fontSize: 9, color: "#2a2a3a", letterSpacing: 2 }}>LIVE SESSION</span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <select value={instrument} onChange={e => { setInstrument(e.target.value); setMessages([]); }}
            style={{ background: "#0b0b14", border: "1px solid #1c1c2a", color: "#c8d3e0", fontFamily: "inherit", fontSize: 11, padding: "4px 8px", borderRadius: 2, outline: "none" }}>
            <option>ES</option><option>NQ</option><option>GC</option><option>CL</option>
          </select>
          <button onClick={() => setMessages([])}
            style={{ background: "none", border: "1px solid #1c1c2a", color: "#3a4060", fontFamily: "inherit", fontSize: 9, letterSpacing: 2, padding: "4px 10px", borderRadius: 2, cursor: "pointer" }}>
            CLEAR
          </button>
        </div>
      </div>

      {/* Context Pills */}
      <ContextPills ctx={sessionContext} />

      {/* Chat Area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 8px" }}>
        {messages.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 20 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>◈</div>
              <div style={{ fontSize: 13, color: "#f59e0b", letterSpacing: 3, fontWeight: 700, marginBottom: 6 }}>TRADING BUDDY</div>
              <div style={{ fontSize: 11, color: "#3a4060", letterSpacing: 1, lineHeight: 1.8 }}>
                Context-aware. MS methodology.<br/>Ask anything about the live session.
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 420 }}>
              {STARTERS.map(s => (
                <button key={s} className="starter-chip" onClick={() => send(s)}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => <Message key={i} msg={m} biasCol={bc} />)}
            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ width: 2, borderRadius: 2, background: bc, height: 24, flexShrink: 0 }} />
                <div style={{ padding: "10px 14px", background: "#0e0e18", border: "1px solid #1c1c2c", borderRadius: "2px 12px 12px 12px" }}>
                  <span style={{ fontSize: 11, color: "#3a4060", letterSpacing: 2, animation: "pulse 1s infinite" }}>THINKING...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid #13131e", background: "#08080f", display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          ref={inputRef}
          className="buddy-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask your trading buddy... (Enter to send)"
          rows={2}
          disabled={loading}
        />
        <button className="send-btn" onClick={() => send()} disabled={loading || !input.trim()}>
          {loading ? "..." : "▶ SEND"}
        </button>
      </div>
    </div>
  );
}
