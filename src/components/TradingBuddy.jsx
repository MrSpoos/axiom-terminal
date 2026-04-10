import { useState, useEffect, useRef, useCallback } from "react";
import { postVesperReflect } from "../services/agentService";
import VesperOrb from "./VesperOrb";

const API_BASE = process.env.REACT_APP_API_URL || "https://axiom-terminal-production.up.railway.app";
const LILY_VOICE_ID = "1hlpeD1ydbI2ow0Tt3EW";
const BIAS_BORDER = { bullish: "#00d4aa", bearish: "#ff4d6d", neutral: "#f59e0b", default: "#334155" };
const STARTERS = [
  "What's the best setup right now?",
  "Price just hit the key level — what should I watch for?",
  "Give me your honest read on this session",
];

function isMarketOpen() {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const d = et.getDay(), mins = et.getHours() * 60 + et.getMinutes();
  return d >= 1 && d <= 5 && mins >= 570 && mins < 960;
}
function renderBold(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i} style={{ color: "#f59e0b" }}>{p.slice(2,-2)}</strong> : p
  );
}
function BiasChip({ bias }) {
  const c = { bullish:"#00d4aa", bearish:"#ff4d6d", neutral:"#f59e0b" }[bias?.toLowerCase()] || "#94a3b8";
  return <span style={{ fontSize:9, letterSpacing:"0.08em", color:c, background:c+"18", border:`1px solid ${c}44`, borderRadius:3, padding:"2px 6px", textTransform:"uppercase", fontFamily:"'IBM Plex Mono',monospace" }}>{bias||"—"}</span>;
}
function CtxPill({ label, value, color }) {
  if (!value && value !== 0) return null;
  return <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:9, fontFamily:"'IBM Plex Mono',monospace", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:3, padding:"2px 7px", whiteSpace:"nowrap" }}><span style={{ color:"#475569" }}>{label}</span><span style={{ color:color||"#cbd5e1" }}>{value}</span></span>;
}
function UserBubble({ msg }) {
  return <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:12 }}><div style={{ maxWidth:"70%" }}><div style={{ background:"#f59e0b", color:"#0a0a0f", borderRadius:"12px 12px 2px 12px", padding:"8px 12px", fontSize:12, fontFamily:"'DM Sans',sans-serif", lineHeight:1.5, fontWeight:500 }}>{msg.content}</div><div style={{ fontSize:9, color:"#334155", textAlign:"right", marginTop:3, fontFamily:"'IBM Plex Mono',monospace" }}>{msg.timestamp}</div></div></div>;
}
const TOOL_LABELS = { run_macro_agent:"◈ Macro Agent", run_correlation_agent:"◈ Correlation Agent", get_market_snapshot:"◈ Market Snapshot", get_news_feed:"◈ News Feed" };
function VesperBubble({ msg, biasBorder }) {
  return (
    <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:12 }}>
      <div style={{ maxWidth:"80%" }}>
        {msg.toolCalls?.length > 0 && (
          <div style={{ marginBottom:4, display:"flex", flexWrap:"wrap", gap:4 }}>
            {msg.toolCalls.map((tc, i) => (
              <span key={i} style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:"#4a9eff", background:"rgba(74,158,255,0.08)", border:"1px solid rgba(74,158,255,0.15)", borderRadius:3, padding:"1px 6px" }}>
                {TOOL_LABELS[tc.tool] || tc.tool}{tc.input?.instrument ? " · " + tc.input.instrument : ""}
              </span>
            ))}
          </div>
        )}
        <div style={{ background:"#0d1117", border:"1px solid rgba(255,255,255,0.08)", borderLeft:`2px solid ${biasBorder}`, borderRadius:"2px 12px 12px 12px", padding:"10px 14px", fontSize:12, fontFamily:"'IBM Plex Mono',monospace", color:"#cbd5e1", lineHeight:1.6 }}>
          {renderBold(msg.content)}
        </div>
        <div style={{ fontSize:9, color:"#334155", marginTop:3, fontFamily:"'IBM Plex Mono',monospace" }}>
          ◈ VESPER · {msg.timestamp}
        </div>
      </div>
    </div>
  );
}

function ErrorBubble({ msg }) {
  return <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:12 }}><div style={{ maxWidth:"80%", background:"rgba(255,77,109,0.08)", border:"1px solid rgba(255,77,109,0.25)", borderLeft:"2px solid #ff4d6d", borderRadius:"2px 12px 12px 12px", padding:"8px 12px", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#ff4d6d" }}>{msg.content}</div></div>;
}
function EmptyState({ onSend }) {
  return <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", gap:20 }}>
    <div style={{ textAlign:"center" }}>
      <div style={{ fontSize:28, marginBottom:8 }}>◈</div>
      <div style={{ fontSize:13, color:"#64748b", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.05em" }}>VESPER IS READY</div>
      <div style={{ fontSize:11, color:"#475569", marginTop:6, fontFamily:"'DM Sans',sans-serif", fontStyle:"italic" }}>Your intelligence. Your edge.</div>
      <div style={{ fontSize:10, color:"#334155", marginTop:4 }}>Type or tap the mic to speak</div>
    </div>
    <div style={{ display:"flex", flexDirection:"column", gap:8, width:"100%", maxWidth:420 }}>
      {STARTERS.map((s,i) => <button key={i} onClick={() => onSend(s)} style={{ background:"rgba(245,158,11,0.06)", border:"1px solid rgba(245,158,11,0.2)", borderRadius:8, padding:"10px 16px", color:"#f59e0b", fontSize:12, cursor:"pointer", textAlign:"left" }}>{s}</button>)}
    </div>
  </div>;
}


// ── Vesper Stats + Morning Brief panel ───────────────────────────────────────
function VesperStats({ apiBase }) {
  const [stats, setStats]   = useState(null);
  const [brief, setBrief]   = useState(null);
  const [open, setOpen]     = useState(false);
  const [loading, setLoading] = useState(false);
  const mono = "'IBM Plex Mono', monospace";

  useEffect(() => {
    // Load stats silently on mount
    fetch(`${apiBase}/api/vesper/stats`).then(r => r.json()).then(d => { if (d.success) setStats(d.data); }).catch(() => {});
    fetch(`${apiBase}/api/vesper/brief`).then(r => r.json()).then(d => { if (d.success) setBrief(d.data); }).catch(() => {});
  }, [apiBase]);

  const today = new Date().toISOString().split('T')[0];
  const hasBrief = brief?.date === today;
  const gateColor = { alert: '#4ade80', monitor: '#fbbf24', suppress: '#f87171' };

  if (!hasBrief && (!stats || stats.total === 0)) return null;

  return (
    <div style={{ marginBottom: 8 }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(74,158,255,0.06)', border: '1px solid rgba(74,158,255,0.15)', borderRadius: 6, cursor: 'pointer' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: '#4a9eff', fontFamily: mono, letterSpacing: '0.08em' }}>◈ VESPER INTELLIGENCE</span>
        {hasBrief && brief.briefs?.map(b => (
          <span key={b.instrument} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: (gateColor[b.arbiter_gate] || '#94a3b8') + '18', color: gateColor[b.arbiter_gate] || '#94a3b8', fontFamily: mono }}>
            {b.instrument} {b.bull_pct}%/{b.bear_pct}%
          </span>
        ))}
        {stats?.total > 0 && <span style={{ fontSize: 9, color: '#475569', fontFamily: mono, marginLeft: 'auto' }}>accuracy: {stats.overall_accuracy}% ({stats.total} calls)</span>}
        <span style={{ fontSize: 10, color: '#334155', marginLeft: hasBrief || stats?.total > 0 ? 0 : 'auto' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ padding: '10px 12px', background: 'rgba(5,10,25,0.8)', border: '1px solid rgba(74,158,255,0.12)', borderTop: 'none', borderRadius: '0 0 6px 6px' }}>
          {hasBrief && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: '#334155', fontFamily: mono, marginBottom: 6, letterSpacing: '0.08em' }}>TODAY'S PRE-MARKET BRIEF</div>
              {brief.briefs.map(b => (
                <div key={b.instrument} style={{ marginBottom: 6, padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, borderLeft: `2px solid ${gateColor[b.arbiter_gate] || '#475569'}` }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', fontFamily: mono }}>{b.instrument}</span>
                    <span style={{ fontSize: 9, color: gateColor[b.arbiter_gate] || '#94a3b8', fontFamily: mono }}>{(b.arbiter_gate || '').toUpperCase()}</span>
                    <span style={{ fontSize: 9, color: '#4ade80', fontFamily: mono }}>Bull {b.bull_pct}%</span>
                    <span style={{ fontSize: 9, color: '#f87171', fontFamily: mono }}>Bear {b.bear_pct}%</span>
                    {b.gex_flip && <span style={{ fontSize: 9, color: '#a78bfa', fontFamily: mono }}>GEX flip: {b.gex_flip}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.5 }}>{b.synthesis}</div>
                </div>
              ))}
            </div>
          )}
          {stats?.total > 0 && (
            <div>
              <div style={{ fontSize: 9, color: '#334155', fontFamily: mono, marginBottom: 6, letterSpacing: '0.08em' }}>PREDICTION ACCURACY</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 8 }}>
                {[
                  { label: 'OVERALL', value: `${stats.overall_accuracy}%`, color: stats.overall_accuracy >= 55 ? '#4ade80' : '#f87171' },
                  { label: 'RECENT 10', value: `${stats.recent_accuracy}%`, color: stats.recent_accuracy >= 55 ? '#4ade80' : '#fbbf24' },
                  { label: 'TOTAL CALLS', value: stats.total, color: '#94a3b8' },
                ].map(s => (
                  <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 4, padding: '5px 8px', textAlign: 'center' }}>
                    <div style={{ fontSize: 8, color: '#475569', fontFamily: mono, marginBottom: 2 }}>{s.label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: s.color, fontFamily: mono }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {Object.keys(stats.by_instrument || {}).length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Object.entries(stats.by_instrument).map(([sym, d]) => (
                    <span key={sym} style={{ fontSize: 9, fontFamily: mono, padding: '2px 8px', borderRadius: 3, background: 'rgba(255,255,255,0.04)', color: '#94a3b8' }}>
                      {sym}: {d.accuracy}% ({d.total})
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TradingBuddy({ livePrice, pxConnected }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionContext, setSessionContext] = useState({});
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [reflecting, setReflecting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [elKeyInput, setElKeyInput] = useState("");
  const [elKeyStored, setElKeyStored] = useState(() => {
    try { return !!localStorage.getItem("elevenlabs_key"); } catch { return false; }
  });
  const [voiceIdInput, setVoiceIdInput] = useState("");
  const [currentVoiceId, setCurrentVoiceId] = useState(() => {
    try { return localStorage.getItem("elevenlabs_voice_id") || LILY_VOICE_ID; } catch { return LILY_VOICE_ID; }
  });
  const [settingsMsg, setSettingsMsg] = useState("");
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const intervalRef = useRef(null);

  // Vesper speaks — Lily voice (ElevenLabs), called browser-direct
  const speak = useCallback(async (text) => {
    if (!voiceEnabled) return;
    try {
      if (window.__vesperAudio) { window.__vesperAudio.pause(); window.__vesperAudio = null; }
      setSpeaking(true);
      const clean = text
        .replace(/\*\*/g, "")
        .replace(/[▲▼◈●◐◎◉]/g, "")
        .replace(/PB([1-4])/g, "Playbook $1")
        .trim()
        .substring(0, 1000);

      const elKey = localStorage.getItem("elevenlabs_key");
      const voiceId = localStorage.getItem("elevenlabs_voice_id") || LILY_VOICE_ID;
      if (elKey) {
        const response = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
          {
            method: "POST",
            headers: { "xi-api-key": elKey, "Content-Type": "application/json", "Accept": "audio/mpeg" },
            body: JSON.stringify({
              text: clean,
              model_id: "eleven_turbo_v2_5",
              voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3, use_speaker_boost: true },
            }),
          }
        );
        if (response.ok) {
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          window.__vesperAudio = audio;
          audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); window.__vesperAudio = null; };
          audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };
          audio.play();
          return;
        }
      }
      setSpeaking(false);
      const utt = new SpeechSynthesisUtterance(clean);
      utt.lang = "en-GB"; utt.rate = 0.9;
      utt.onend = () => setSpeaking(false);
      window.speechSynthesis?.speak(utt);
    } catch { setSpeaking(false); }
  }, [voiceEnabled]);

  const stopSpeaking = useCallback(() => {
    if (window.__vesperAudio) { window.__vesperAudio.pause(); window.__vesperAudio = null; }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  const startListening = useCallback(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) { alert("Voice not supported. Use Chrome."); return; }
    stopSpeaking();
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = false; rec.interimResults = true; rec.lang = "en-US";
    rec.onstart = () => { setListening(true); setTranscript(""); };
    rec.onresult = (e) => { const t = Array.from(e.results).map(r => r[0].transcript).join(""); setTranscript(t); setInput(t); };
    rec.onend = () => {
      setListening(false); setTranscript("");
      const inputEl = document.querySelector('textarea[placeholder="Ask Vesper..."]');
      const val = inputEl?.value?.trim();
      if (val) inputEl.dispatchEvent(new KeyboardEvent("keydown", { key:"Enter", code:"Enter", bubbles:true }));
    };
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec; rec.start();
  }, [stopSpeaking]);

  const stopListening = useCallback(() => { recognitionRef.current?.stop(); setListening(false); }, []);
  const toggleListening = useCallback(() => { if (listening) stopListening(); else startListening(); }, [listening, startListening, stopListening]);

  const fetchContext = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/session-bias?symbol=ES`);
      if (!r.ok) return;
      const data = await r.json();
      const ctx = data.context || data.priceData || {};
      const syn = data.synthesis || {};
      setSessionContext({
        instrument: ctx.instrument || "ES",
        currentPrice: ctx.current_price || ctx.currentPrice,
        sessionBias: (syn.finalBias || syn.composite_bias || "NEUTRAL").toLowerCase(),
        dayType: syn.dayType || (syn.session_plan ? "Active" : "—"),
        keyLevel: syn.keyLevel || syn.key_level_bull || ctx.vah || "N/A",
        activeSetups: [],
        vah: ctx.vah || "N/A", val: ctx.val || "N/A", poc: ctx.poc || "N/A",
        adrConsumed: ctx.adr_upside_capacity_pct ?? "N/A",
        ibStatus: ctx.ib_status || "N/A", vix: ctx.vix || "N/A", gap: ctx.gap,
      });
    } catch {}
  }, []);

  useEffect(() => { fetchContext(); intervalRef.current = setInterval(fetchContext, 60000); return () => clearInterval(intervalRef.current); }, [fetchContext]);
  useEffect(() => { if (livePrice != null) setSessionContext(prev => ({ ...prev, currentPrice: livePrice })); }, [livePrice]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, loading]);

  const reflect = useCallback(async () => {
    setReflecting(true);
    try {
      const outcome = prompt("What happened in the market today? (optional — press OK to skip)");
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const result = await postVesperReflect({
        conversationHistory: history,
        marketOutcome: outcome || "Not provided",
        instrument: sessionContext.instrument || "ES",
      });
      const learningCount = result.newLearnings?.length || 0;
      const ts = new Date().toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit", hour12:true });
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `◈ Session reflection complete. ${learningCount} new insight${learningCount !== 1 ? "s" : ""} stored to memory.${result.reflection?.summary ? " " + result.reflection.summary : ""}`,
        timestamp: ts,
        toolCalls: [],
      }]);
    } catch (err) {
      console.error("Reflect error:", err);
    } finally { setReflecting(false); }
  }, [messages, sessionContext]);

  const send = useCallback(async (text) => {
    const content = (text || input).trim();
    if (!content || loading) return;
    setInput("");
    const ts = new Date().toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit", hour12:true });
    const newMessages = [...messages, { role:"user", content, timestamp:ts }];
    setMessages(newMessages); setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/vesper`, {
        method:"POST", headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ messages: newMessages.map(m => ({ role:m.role, content:m.content })), sessionContext }),
      });
      const data = await r.json();
      const replyTs = new Date().toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit", hour12:true });
      const reply = data.reply || data.error || "No response";
      const role = data.reply ? "assistant" : "error";
      const toolCalls = data.toolCalls || [];
      setMessages(prev => [...prev, { role, content:reply, timestamp:replyTs }]);
      if (role === "assistant") speak(reply);
    } catch (err) {
      const errTs = new Date().toLocaleTimeString("en-US", { hour:"2-digit", minute:"2-digit", hour12:true });
      setMessages(prev => [...prev, { role:"error", content:err.message, timestamp:errTs }]);
    } finally { setLoading(false); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [input, loading, messages, sessionContext, speak]);

  const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
  const biasBorder = BIAS_BORDER[sessionContext.sessionBias?.toLowerCase()] || BIAS_BORDER.default;
  const marketOpen = isMarketOpen();

  // Determine orb state: thinking (API call) → signal (fresh response, briefly) → alert (error) → idle
  const lastMsg = messages[messages.length - 1];
  const hasRecentSignal = lastMsg?.role === "assistant" &&
    /\b(long|short|entry|stop|target|playbook|pb[1-4])\b/i.test(lastMsg.content || "");
  const hasError = lastMsg?.role === "error";
  const orbState = loading ? "thinking"
    : hasError ? "alert"
    : hasRecentSignal ? "signal"
    : "idle";

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"calc(100vh - 120px)", background:"#06060b", borderRadius:8, border:"1px solid rgba(255,255,255,0.06)", overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", borderBottom:"1px solid rgba(255,255,255,0.06)", background:"#0a0a10", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:14, color:"#f59e0b", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.08em", fontWeight:600 }}>◈ VESPER</span>
          <span style={{ fontSize:9, color:"#475569", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.06em" }}>INTELLIGENCE</span>
          <span style={{ width:7, height:7, borderRadius:"50%", background:marketOpen?"#00d4aa":"#334155", display:"inline-block", boxShadow:marketOpen?"0 0 6px #00d4aa":"none", animation:marketOpen?"pulse 1.8s ease-in-out infinite":"none" }} />
          {speaking && <span style={{ fontSize:9, color:"#f59e0b", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:2, animation:"pulse 1s ease-in-out infinite" }}>● VESPER SPEAKING</span>}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          {sessionContext.instrument && <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", background:"rgba(74,158,255,0.12)", border:"1px solid rgba(74,158,255,0.3)", color:"#4a9eff", borderRadius:3, padding:"2px 8px" }}>{sessionContext.instrument}</span>}
          <button onClick={() => { setVoiceEnabled(v => !v); if(speaking) stopSpeaking(); }}
            style={{ fontSize:14, background:voiceEnabled?"rgba(0,212,170,0.12)":"rgba(255,255,255,0.04)", border:voiceEnabled?"1px solid rgba(0,212,170,0.3)":"1px solid rgba(255,255,255,0.1)", color:voiceEnabled?"#00d4aa":"#475569", borderRadius:3, padding:"3px 8px", cursor:"pointer" }}>
            {voiceEnabled ? "🔊" : "🔇"}
          </button>
          <button
            onClick={() => setSettingsOpen(o => !o)}
            title={elKeyStored ? "ElevenLabs key: SAVED" : "ElevenLabs key: NOT SET"}
            style={{
              fontSize: 14,
              background: elKeyStored ? "rgba(0,212,170,0.12)" : "rgba(239,68,68,0.12)",
              border: elKeyStored ? "1px solid rgba(0,212,170,0.3)" : "1px solid rgba(239,68,68,0.3)",
              color: elKeyStored ? "#00d4aa" : "#ef4444",
              borderRadius: 3,
              padding: "3px 8px",
              cursor: "pointer",
              position: "relative",
            }}
          >
            ⚙
            <span style={{
              position: "absolute",
              top: 2,
              right: 2,
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: elKeyStored ? "#22c55e" : "#ef4444",
              boxShadow: elKeyStored ? "0 0 4px #22c55e" : "0 0 4px #ef4444",
            }} />
          </button>
          <span style={{ fontSize:9, color:"#334155", fontFamily:"'IBM Plex Mono',monospace" }}>{new Date().toLocaleTimeString("en-US",{ hour:"2-digit", minute:"2-digit", timeZone:"America/New_York" })} ET</span>
          <button onClick={() => { setMessages([]); stopSpeaking(); }} style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", background:"transparent", border:"1px solid rgba(255,255,255,0.1)", color:"#475569", borderRadius:3, padding:"3px 8px", cursor:"pointer" }}>CLEAR</button>
          <button onClick={reflect} disabled={reflecting || messages.length === 0} style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", background:reflecting?"rgba(74,158,255,0.08)":"transparent", border:"1px solid rgba(74,158,255,0.2)", color:reflecting?"#4a9eff":"#4a9eff", borderRadius:3, padding:"3px 8px", cursor:reflecting||messages.length===0?"not-allowed":"pointer", opacity:messages.length===0?0.3:1 }}>{reflecting ? "◈ REFLECTING..." : "◈ REFLECT"}</button>
        </div>
      </div>
      {settingsOpen && (
        <div style={{
          padding: "14px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(108,99,255,0.04)",
          flexShrink: 0,
        }}>
          <div style={{
            fontSize: 10,
            fontFamily: "'IBM Plex Mono', monospace",
            color: "#94a3b8",
            letterSpacing: "0.08em",
            marginBottom: 6,
          }}>
            ELEVENLABS API KEY
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="password"
              value={elKeyInput}
              onChange={(e) => { setElKeyInput(e.target.value); setSettingsMsg(""); }}
              placeholder={elKeyStored ? "•••••••• (saved — paste new to replace)" : "sk_xxxxxxxxxxxxxxxxxxxx"}
              autoComplete="off"
              style={{
                flex: 1,
                background: "#0d1117",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 6,
                padding: "8px 12px",
                color: "#e2e8f0",
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
                outline: "none",
              }}
            />
            <button
              onClick={() => {
                const v = elKeyInput.trim();
                if (!v) { setSettingsMsg("Paste a key first"); return; }
                try {
                  localStorage.setItem("elevenlabs_key", v);
                  setElKeyStored(true);
                  setElKeyInput("");
                  setSettingsMsg("✓ Saved. Try sending a message.");
                } catch (err) {
                  setSettingsMsg("Failed to save: " + err.message);
                }
              }}
              style={{
                background: "#22c55e",
                border: "none",
                borderRadius: 6,
                padding: "8px 14px",
                color: "#052e13",
                fontSize: 11,
                fontFamily: "'IBM Plex Mono', monospace",
                fontWeight: 700,
                letterSpacing: "0.06em",
                cursor: "pointer",
              }}
            >
              SAVE
            </button>
            <button
              onClick={() => {
                try {
                  localStorage.removeItem("elevenlabs_key");
                  setElKeyStored(false);
                  setElKeyInput("");
                  setSettingsMsg("Key cleared");
                } catch {}
              }}
              style={{
                background: "transparent",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 6,
                padding: "8px 12px",
                color: "#ef4444",
                fontSize: 10,
                fontFamily: "'IBM Plex Mono', monospace",
                cursor: "pointer",
              }}
            >
              CLEAR
            </button>
          </div>
          <div style={{
            fontSize: 10,
            fontFamily: "'IBM Plex Mono', monospace",
            color: "#94a3b8",
            letterSpacing: "0.08em",
            marginTop: 14,
            marginBottom: 6,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            <span>VOICE ID</span>
            <span style={{ fontSize: 9, color: "#475569" }}>current:</span>
            <code style={{
              fontSize: 9,
              color: "#a78bfa",
              background: "rgba(108,99,255,0.08)",
              padding: "1px 6px",
              borderRadius: 3,
            }}>{currentVoiceId}</code>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={voiceIdInput}
              onChange={(e) => { setVoiceIdInput(e.target.value); setSettingsMsg(""); }}
              placeholder="paste new voice ID (e.g. 1hlpeD1ydbI2ow0Tt3EW)"
              autoComplete="off"
              spellCheck={false}
              style={{
                flex: 1,
                background: "#0d1117",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 6,
                padding: "8px 12px",
                color: "#e2e8f0",
                fontSize: 12,
                fontFamily: "'IBM Plex Mono', monospace",
                outline: "none",
              }}
            />
            <button
              onClick={() => {
                const v = voiceIdInput.trim();
                if (!v) { setSettingsMsg("Paste a voice ID first"); return; }
                try {
                  localStorage.setItem("elevenlabs_voice_id", v);
                  setCurrentVoiceId(v);
                  setVoiceIdInput("");
                  setSettingsMsg("✓ Voice ID saved. Send a message to test.");
                } catch (err) {
                  setSettingsMsg("Failed to save: " + err.message);
                }
              }}
              style={{
                background: "#6c63ff",
                border: "none",
                borderRadius: 6,
                padding: "8px 14px",
                color: "#fff",
                fontSize: 11,
                fontFamily: "'IBM Plex Mono', monospace",
                fontWeight: 700,
                letterSpacing: "0.06em",
                cursor: "pointer",
              }}
            >
              SAVE
            </button>
            <button
              onClick={() => {
                try {
                  localStorage.removeItem("elevenlabs_voice_id");
                  setCurrentVoiceId(LILY_VOICE_ID);
                  setVoiceIdInput("");
                  setSettingsMsg("Voice ID reset to default");
                } catch {}
              }}
              title="Reset to default voice ID"
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 6,
                padding: "8px 12px",
                color: "#94a3b8",
                fontSize: 10,
                fontFamily: "'IBM Plex Mono', monospace",
                cursor: "pointer",
              }}
            >
              RESET
            </button>
          </div>
          {settingsMsg && (
            <div style={{
              fontSize: 10,
              color: settingsMsg.startsWith("✓") ? "#22c55e" : "#ef4444",
              marginTop: 8,
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              {settingsMsg}
            </div>
          )}
          <div style={{
            fontSize: 9,
            color: "#475569",
            marginTop: 8,
            fontFamily: "'IBM Plex Mono', monospace",
            lineHeight: 1.5,
          }}>
            Get your API key at elevenlabs.io → Profile → API Keys.<br />
            Get voice IDs at elevenlabs.io → Voices → click a voice → copy ID.<br />
            Both values stored only in this browser (localStorage).
          </div>
        </div>
      )}
      {/* Vesper presence — animated energy orb */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "20px 0 14px",
        borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.04))",
        background: "radial-gradient(ellipse at center top, rgba(108,99,255,0.04) 0%, transparent 60%)",
        flexShrink: 0,
      }}>
        <VesperOrb state={orbState} size={100} />
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "0.2em",
            color: "#e2e8f0",
            fontFamily: "'IBM Plex Mono', monospace",
          }}>
            VESPER
          </div>
          <div style={{
            fontSize: 10,
            color: "#94a3b8",
            letterSpacing: "0.12em",
            marginTop: 3,
            fontFamily: "'IBM Plex Mono', monospace",
          }}>
            CHIEF TRADING OPERATIONS
          </div>
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            justifyContent: "center",
            marginTop: 8,
          }}>
            <span className="status-dot-live" />
            <span style={{ fontSize: 10, color: "#22c55e", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.1em" }}>
              {loading ? "THINKING" : hasRecentSignal ? "SIGNAL" : hasError ? "ALERT" : "LIVE"}
            </span>
          </div>
        </div>
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:5, padding:"8px 14px", borderBottom:"1px solid rgba(255,255,255,0.05)", background:"#080810", flexShrink:0 }}>
        <BiasChip bias={sessionContext.sessionBias} />
        <CtxPill label="DAY" value={sessionContext.dayType} />
        <CtxPill label="PRICE" value={sessionContext.currentPrice} color="#e2e8f0" />
        {pxConnected ? <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:"#00d4aa", background:"rgba(0,212,170,0.1)", border:"1px solid rgba(0,212,170,0.25)", borderRadius:3, padding:"2px 6px" }}>LIVE</span> : <span style={{ fontSize:9, fontFamily:"'IBM Plex Mono',monospace", color:"#f59e0b", background:"rgba(245,158,11,0.08)", border:"1px solid rgba(245,158,11,0.2)", borderRadius:3, padding:"2px 6px" }}>DELAYED</span>}
        <CtxPill label="VAH" value={sessionContext.vah} color="#4a9eff" />
        <CtxPill label="POC" value={sessionContext.poc} color="#a78bfa" />
        <CtxPill label="VAL" value={sessionContext.val} color="#4a9eff" />
        <CtxPill label="ADR" value={sessionContext.adrConsumed!=null?`${sessionContext.adrConsumed}%`:null} color="#f6c90e" />
        <CtxPill label="IB" value={sessionContext.ibStatus} />
        <CtxPill label="VIX" value={sessionContext.vix} color={sessionContext.vix>20?"#ff4d6d":"#94a3b8"} />
        {sessionContext.gap!=null && <CtxPill label="GAP" value={sessionContext.gap>0?`+${sessionContext.gap}`:sessionContext.gap} color={sessionContext.gap>0?"#00d4aa":"#ff4d6d"} />}
      </div>
      <VesperStats apiBase={API_BASE} />
      <div style={{ flex:1, overflowY:"auto", padding:"16px 16px 8px", display:"flex", flexDirection:"column" }}>
        {messages.length===0 && !loading ? <EmptyState onSend={send} /> : <>
          {messages.map((msg,i) => msg.role==="user" ? <UserBubble key={i} msg={msg}/> : msg.role==="error" ? <ErrorBubble key={i} msg={msg}/> : <VesperBubble key={i} msg={msg} biasBorder={biasBorder}/>)}
          {loading && <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:12 }}><div style={{ background:"#0d1117", border:"1px solid rgba(255,255,255,0.08)", borderLeft:`2px solid ${biasBorder}`, borderRadius:"2px 12px 12px 12px", padding:"10px 16px", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", color:"#475569", display:"flex", alignItems:"center", gap:8 }}><span style={{ animation:"vespPulse 1.2s ease-in-out infinite" }}>●</span><span style={{ animation:"vespPulse 1.2s ease-in-out infinite 0.2s" }}>●</span><span style={{ animation:"vespPulse 1.2s ease-in-out infinite 0.4s" }}>●</span></div></div>}
          <div ref={bottomRef}/>
        </>}
      </div>
      <div style={{ padding:"10px 14px", borderTop:"1px solid rgba(255,255,255,0.06)", background:"#0a0a10", flexShrink:0, display:"flex", gap:8, alignItems:"flex-end" }}>
        <button onClick={toggleListening} disabled={loading}
          style={{ width:40, height:40, borderRadius:"50%", border:"none", cursor:loading?"not-allowed":"pointer", flexShrink:0, background:listening?"rgba(255,77,109,0.9)":speaking?"rgba(245,158,11,0.2)":"rgba(245,158,11,0.12)", color:listening?"#fff":speaking?"#f59e0b":"#f59e0b", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center", boxShadow:listening?"0 0 0 3px rgba(255,77,109,0.3),0 0 12px rgba(255,77,109,0.5)":"none", transition:"all 0.2s", animation:listening?"micPulse 1s ease-in-out infinite":"none" }}>
          {listening ? "⏹" : "🎤"}
        </button>
        <div style={{ flex:1, position:"relative" }}>
          {listening && transcript && <div style={{ position:"absolute", bottom:"100%", left:0, right:0, marginBottom:4, background:"#0d1117", border:"1px solid rgba(245,158,11,0.3)", borderRadius:8, padding:"6px 10px", fontSize:11, color:"#f59e0b", fontStyle:"italic" }}>{transcript}...</div>}
          <textarea ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={loading||listening}
            placeholder={listening?"Listening...":"Ask Vesper..."} rows={1}
            style={{ width:"100%", background:"#0d1117", border:"1px solid rgba(255,255,255,0.1)", borderRadius:8, padding:"9px 12px", color:"#e2e8f0", fontSize:12, fontFamily:"'DM Sans',sans-serif", resize:"none", outline:"none", lineHeight:1.5, opacity:loading||listening?0.5:1, boxSizing:"border-box" }}
            onFocus={e=>e.target.style.borderColor="rgba(245,158,11,0.4)"} onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.1)"} />
        </div>
        <button onClick={()=>send()} disabled={loading||!input.trim()||listening}
          style={{ background:loading||!input.trim()||listening?"rgba(245,158,11,0.15)":"#f59e0b", border:"none", borderRadius:8, padding:"9px 16px", color:loading||!input.trim()||listening?"#78350f":"#0a0a0f", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.06em", cursor:loading||!input.trim()||listening?"not-allowed":"pointer", fontWeight:600, whiteSpace:"nowrap" }}>
          {loading ? "● CONSULTING..." : "▶ SEND"}
        </button>
      </div>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes vespPulse{0%,100%{opacity:0.2}50%{opacity:0.8}}
        @keyframes micPulse{0%,100%{box-shadow:0 0 0 3px rgba(255,77,109,0.3),0 0 12px rgba(255,77,109,0.5)}50%{box-shadow:0 0 0 6px rgba(255,77,109,0.15),0 0 20px rgba(255,77,109,0.3)}}
      `}</style>
    </div>
  );
}
