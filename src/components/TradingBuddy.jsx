import { useState, useEffect, useRef, useCallback } from "react";

const API_BASE = process.env.REACT_APP_BACKEND_URL || "http://localhost:3001";

const BIAS_BORDER = {
  bullish:  "#00d4aa",
  bearish:  "#ff4d6d",
  neutral:  "#f59e0b",
  default:  "#334155",
};

const STARTERS = [
  "What's the best setup right now?",
  "Price just hit the key level — what should I watch for?",
  "Give me your honest read on this session",
];

function isMarketOpen() {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const h = et.getHours(), m = et.getMinutes();
  const mins = h * 60 + m;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function renderBold(text) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} style={{ color: "#f59e0b" }}>{p.slice(2, -2)}</strong>
      : p
  );
}

function BiasChip({ bias }) {
  const colors = { bullish: "#00d4aa", bearish: "#ff4d6d", neutral: "#f59e0b" };
  const color = colors[bias?.toLowerCase()] || "#94a3b8";
  return (
    <span style={{
      fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.08em",
      color, background: color + "18", border: `1px solid ${color}44`,
      borderRadius: 3, padding: "2px 6px", textTransform: "uppercase",
    }}>
      {bias || "—"}
    </span>
  );
}

function CtxPill({ label, value, color }) {
  if (!value && value !== 0) return null;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 9, fontFamily: "'IBM Plex Mono', monospace",
      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 3, padding: "2px 7px", color: color || "#94a3b8",
      whiteSpace: "nowrap",
    }}>
      <span style={{ color: "#475569" }}>{label}</span>
      <span style={{ color: color || "#cbd5e1" }}>{value}</span>
    </span>
  );
}

function UserBubble({ msg }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
      <div style={{ maxWidth: "70%" }}>
        <div style={{
          background: "#f59e0b", color: "#0a0a0f", borderRadius: "12px 12px 2px 12px",
          padding: "8px 12px", fontSize: 12, fontFamily: "'DM Sans', sans-serif",
          lineHeight: 1.5, fontWeight: 500,
        }}>
          {msg.content}
        </div>
        <div style={{ fontSize: 9, color: "#334155", textAlign: "right", marginTop: 3, fontFamily: "'IBM Plex Mono', monospace" }}>
          {msg.timestamp}
        </div>
      </div>
    </div>
  );
}

function BuddyBubble({ msg, biasBorder }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
      <div style={{ maxWidth: "80%" }}>
        <div style={{
          background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)",
          borderLeft: `2px solid ${biasBorder}`,
          borderRadius: "2px 12px 12px 12px",
          padding: "10px 14px", fontSize: 12,
          fontFamily: "'IBM Plex Mono', monospace", color: "#cbd5e1", lineHeight: 1.6,
        }}>
          {renderBold(msg.content)}
        </div>
        <div style={{ fontSize: 9, color: "#334155", marginTop: 3, fontFamily: "'IBM Plex Mono', monospace" }}>
          ◈ BUDDY · {msg.timestamp}
        </div>
      </div>
    </div>
  );
}

function ErrorBubble({ msg }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
      <div style={{
        maxWidth: "80%", background: "rgba(255,77,109,0.08)", border: "1px solid rgba(255,77,109,0.25)",
        borderLeft: "2px solid #ff4d6d", borderRadius: "2px 12px 12px 12px",
        padding: "8px 12px", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", color: "#ff4d6d",
      }}>
        {msg.content}
      </div>
    </div>
  );
}

function EmptyState({ onSend }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 20 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>◈</div>
        <div style={{ fontSize: 13, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.05em" }}>
          YOUR TRADING BUDDY IS READY
        </div>
        <div style={{ fontSize: 11, color: "#334155", marginTop: 4, fontFamily: "'DM Sans', sans-serif" }}>
          Ask anything about the current session
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 420 }}>
        {STARTERS.map((s, i) => (
          <button
            key={i}
            onClick={() => onSend(s)}
            style={{
              background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)",
              borderRadius: 8, padding: "10px 16px", color: "#f59e0b",
              fontSize: 12, fontFamily: "'DM Sans', sans-serif", cursor: "pointer",
              textAlign: "left", transition: "background 0.15s",
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(245,158,11,0.12)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(245,158,11,0.06)"}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function TradingBuddy() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionContext, setSessionContext] = useState({});
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const intervalRef = useRef(null);

  const fetchContext = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/session-bias?symbol=ES`);
      if (!r.ok) return;
      const data = await r.json();
      // GET /api/session-bias returns: { context: {...snake_case}, synthesis: {...}, agents: {...} }
      const ctx = data.context || {};
      const syn = data.synthesis || {};
      setSessionContext({
        instrument:   ctx.instrument || "ES",
        currentPrice: ctx.current_price,
        sessionBias:  (syn.composite_bias || "NEUTRAL").toLowerCase(),
        dayType:      syn.session_plan ? "Active" : "—",
        keyLevel:     syn.key_level_bull || ctx.vah || "N/A",
        activeSetups: [],
        vah:          ctx.vah   || "N/A",
        val:          ctx.val   || "N/A",
        poc:          ctx.poc   || "N/A",
        adrConsumed:  ctx.adr_upside_capacity_pct ?? "N/A",
        ibStatus:     ctx.ib_status || "N/A",
        vix:          ctx.vix   || "N/A",
        gap:          ctx.gap,
      });
    } catch {
      // silent — buddy works without live context
    }
  }, []);

  useEffect(() => {
    fetchContext();
    intervalRef.current = setInterval(fetchContext, 60000);
    return () => clearInterval(intervalRef.current);
  }, [fetchContext]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async (text) => {
    const content = (text || input).trim();
    if (!content || loading) return;
    setInput("");

    const ts = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
    const newMessages = [...messages, { role: "user", content, timestamp: ts }];
    setMessages(newMessages);
    setLoading(true);

    try {
      const r = await fetch(`${API_BASE}/api/trading-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          sessionContext,
        }),
      });
      const data = await r.json();
      const replyTs = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
      if (data.reply) {
        setMessages(prev => [...prev, { role: "assistant", content: data.reply, timestamp: replyTs }]);
      } else {
        setMessages(prev => [...prev, { role: "error", content: data.error || "No response", timestamp: replyTs }]);
      }
    } catch (err) {
      const errTs = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
      setMessages(prev => [...prev, { role: "error", content: err.message, timestamp: errTs }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, loading, messages, sessionContext]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const clearChat = () => setMessages([]);

  const biasBorder = BIAS_BORDER[sessionContext.sessionBias?.toLowerCase()] || BIAS_BORDER.default;
  const marketOpen = isMarketOpen();

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "calc(100vh - 120px)",
      background: "#06060b", borderRadius: 8, border: "1px solid rgba(255,255,255,0.06)",
      overflow: "hidden",
    }}>
      {/* HEADER */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "#0a0a10", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, color: "#f59e0b", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.08em", fontWeight: 600 }}>
            ◈ TRADING BUDDY
          </span>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: marketOpen ? "#00d4aa" : "#334155",
            display: "inline-block",
            boxShadow: marketOpen ? "0 0 6px #00d4aa" : "none",
            animation: marketOpen ? "pulse 1.8s ease-in-out infinite" : "none",
          }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {sessionContext.instrument && (
            <span style={{
              fontSize: 9, fontFamily: "'IBM Plex Mono', monospace",
              background: "rgba(74,158,255,0.12)", border: "1px solid rgba(74,158,255,0.3)",
              color: "#4a9eff", borderRadius: 3, padding: "2px 8px", letterSpacing: "0.08em",
            }}>
              {sessionContext.instrument}
            </span>
          )}
          <span style={{ fontSize: 9, color: "#334155", fontFamily: "'IBM Plex Mono', monospace" }}>
            {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })} ET
          </span>
          <button
            onClick={clearChat}
            style={{
              fontSize: 9, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.06em",
              background: "transparent", border: "1px solid rgba(255,255,255,0.1)",
              color: "#475569", borderRadius: 3, padding: "3px 8px", cursor: "pointer",
            }}
            onMouseEnter={e => e.currentTarget.style.color = "#94a3b8"}
            onMouseLeave={e => e.currentTarget.style.color = "#475569"}
          >
            CLEAR
          </button>
        </div>
      </div>

      {/* CONTEXT PILLS */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 5, padding: "8px 14px",
        borderBottom: "1px solid rgba(255,255,255,0.05)", background: "#080810", flexShrink: 0,
      }}>
        <BiasChip bias={sessionContext.sessionBias} />
        <CtxPill label="DAY" value={sessionContext.dayType} />
        <CtxPill label="PRICE" value={sessionContext.currentPrice} color="#e2e8f0" />
        <CtxPill label="VAH" value={sessionContext.vah} color="#4a9eff" />
        <CtxPill label="POC" value={sessionContext.poc} color="#a78bfa" />
        <CtxPill label="VAL" value={sessionContext.val} color="#4a9eff" />
        <CtxPill label="ADR" value={sessionContext.adrConsumed != null ? `${sessionContext.adrConsumed}%` : null} color="#f6c90e" />
        <CtxPill label="IB" value={sessionContext.ibStatus} />
        <CtxPill label="VIX" value={sessionContext.vix} color={sessionContext.vix > 20 ? "#ff4d6d" : "#94a3b8"} />
        {sessionContext.gap != null && (
          <CtxPill label="GAP" value={sessionContext.gap > 0 ? `+${sessionContext.gap}` : sessionContext.gap} color={sessionContext.gap > 0 ? "#00d4aa" : "#ff4d6d"} />
        )}
      </div>

      {/* CHAT AREA */}
      <div style={{
        flex: 1, overflowY: "auto", padding: "16px 16px 8px",
        display: "flex", flexDirection: "column",
      }}>
        {messages.length === 0 && !loading ? (
          <EmptyState onSend={send} />
        ) : (
          <>
            {messages.map((msg, i) =>
              msg.role === "user" ? (
                <UserBubble key={i} msg={msg} />
              ) : msg.role === "error" ? (
                <ErrorBubble key={i} msg={msg} />
              ) : (
                <BuddyBubble key={i} msg={msg} biasBorder={biasBorder} />
              )
            )}
            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: 12 }}>
                <div style={{
                  background: "#0d1117", border: "1px solid rgba(255,255,255,0.08)",
                  borderLeft: `2px solid ${biasBorder}`,
                  borderRadius: "2px 12px 12px 12px",
                  padding: "10px 16px", fontSize: 11,
                  fontFamily: "'IBM Plex Mono', monospace", color: "#475569",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <span style={{ animation: "buddyPulse 1.2s ease-in-out infinite" }}>●</span>
                  <span style={{ animation: "buddyPulse 1.2s ease-in-out infinite 0.2s" }}>●</span>
                  <span style={{ animation: "buddyPulse 1.2s ease-in-out infinite 0.4s" }}>●</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      {/* INPUT ROW */}
      <div style={{
        padding: "10px 14px", borderTop: "1px solid rgba(255,255,255,0.06)",
        background: "#0a0a10", flexShrink: 0,
        display: "flex", gap: 8, alignItems: "flex-end",
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          placeholder="Ask your trading buddy..."
          rows={1}
          style={{
            flex: 1, background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, padding: "9px 12px", color: "#e2e8f0",
            fontSize: 12, fontFamily: "'DM Sans', sans-serif", resize: "none",
            outline: "none", lineHeight: 1.5,
            opacity: loading ? 0.5 : 1,
            transition: "border-color 0.15s",
          }}
          onFocus={e => e.target.style.borderColor = "rgba(245,158,11,0.4)"}
          onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
        />
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          style={{
            background: loading || !input.trim() ? "rgba(245,158,11,0.15)" : "#f59e0b",
            border: "none", borderRadius: 8, padding: "9px 16px",
            color: loading || !input.trim() ? "#78350f" : "#0a0a0f",
            fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.06em",
            cursor: loading || !input.trim() ? "not-allowed" : "pointer",
            fontWeight: 600, whiteSpace: "nowrap", transition: "background 0.15s",
          }}
        >
          {loading ? "THINKING..." : "▶ SEND"}
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes buddyPulse {
          0%, 100% { opacity: 0.2; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
