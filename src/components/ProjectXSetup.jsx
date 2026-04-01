import { useState } from "react";

export default function ProjectXSetup({ connected, onLogin, onLogout, onReconnect }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleConnect = async () => {
    setError(null); setLoading(true);
    try { await onLogin(username, apiKey); setOpen(false); setApiKey(""); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  const handleKeyDown = (e) => { if (e.key === "Enter" && username && apiKey) handleConnect(); };

  if (!open) return (
    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
      <style>{`@keyframes pxPulse{0%,100%{opacity:1;box-shadow:0 0 5px #00d4aa}50%{opacity:0.5;box-shadow:0 0 2px #00d4aa}}`}</style>
      {connected ? (<>
        <span style={{ fontSize:8, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.08em", color:"#00d4aa", background:"rgba(0,212,170,0.12)", border:"1px solid rgba(0,212,170,0.3)", borderRadius:3, padding:"2px 7px", display:"flex", alignItems:"center", gap:4 }}>
          <span style={{ width:5, height:5, borderRadius:"50%", background:"#00d4aa", display:"inline-block", animation:"pxPulse 1.8s ease-in-out infinite" }} />
          CONNECTED · LIVE
        </span>
        <button onClick={onLogout} style={{ fontSize:8, fontFamily:"'IBM Plex Mono',monospace", background:"transparent", border:"1px solid rgba(255,255,255,0.08)", color:"#334155", borderRadius:3, padding:"2px 6px", cursor:"pointer" }}>DISCONNECT</button>
      </>) : (<>
        <span style={{ fontSize:8, fontFamily:"'IBM Plex Mono',monospace", color:"#f59e0b", background:"rgba(245,158,11,0.1)", border:"1px solid rgba(245,158,11,0.25)", borderRadius:3, padding:"2px 7px" }}>DELAYED</span>
        {localStorage.getItem("projectx_jwt")
          ? <button onClick={onReconnect} style={{ fontSize:8, fontFamily:"'IBM Plex Mono',monospace", background:"rgba(0,212,170,0.08)", border:"1px solid rgba(0,212,170,0.2)", color:"#00d4aa", borderRadius:3, padding:"2px 7px", cursor:"pointer" }}>RECONNECT</button>
          : <button onClick={() => setOpen(true)} style={{ fontSize:8, fontFamily:"'IBM Plex Mono',monospace", background:"rgba(74,158,255,0.08)", border:"1px solid rgba(74,158,255,0.2)", color:"#4a9eff", borderRadius:3, padding:"2px 7px", cursor:"pointer" }}>CONNECT LIVE</button>
        }
      </>)}
    </div>
  );

  return (<>
    <div onClick={() => setOpen(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", zIndex:999, backdropFilter:"blur(4px)" }} />
    <div style={{
      position:"fixed",
      top:"60px",
      left:"50%",
      transform:"translateX(-50%)",
      zIndex:1000,
      width:"min(380px, 92vw)",
      maxHeight:"calc(100vh - 80px)",
      overflowY:"auto",
      background:"#0a0a10",
      border:"1px solid rgba(74,158,255,0.25)",
      borderRadius:10,
      padding:"20px",
      boxShadow:"0 24px 80px rgba(0,0,0,0.6)",
    }}>
      <div style={{ marginBottom:16 }}>
        <div style={{ fontSize:13, fontWeight:700, color:"#4a9eff", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.08em", marginBottom:4 }}>◈ CONNECT LIVE DATA</div>
        <div style={{ fontSize:11, color:"#475569" }}>ProjectX / TopstepX — real-time WebSocket prices</div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:14 }}>
        <div>
          <label style={{ fontSize:9, color:"#64748b", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.08em", display:"block", marginBottom:4 }}>USERNAME (EMAIL)</label>
          <input type="email" value={username} onChange={e=>setUsername(e.target.value)} onKeyDown={handleKeyDown} placeholder="trader@example.com" autoFocus
            style={{ width:"100%", background:"#0d1117", border:"1px solid rgba(255,255,255,0.1)", borderRadius:6, padding:"9px 10px", color:"#e2e8f0", fontSize:12, outline:"none", boxSizing:"border-box" }}
            onFocus={e=>e.target.style.borderColor="rgba(74,158,255,0.4)"} onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.1)"} />
        </div>
        <div>
          <label style={{ fontSize:9, color:"#64748b", fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.08em", display:"block", marginBottom:4 }}>API KEY</label>
          <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} onKeyDown={handleKeyDown} placeholder="••••••••••••••••"
            style={{ width:"100%", background:"#0d1117", border:"1px solid rgba(255,255,255,0.1)", borderRadius:6, padding:"9px 10px", color:"#e2e8f0", fontSize:12, outline:"none", boxSizing:"border-box" }}
            onFocus={e=>e.target.style.borderColor="rgba(74,158,255,0.4)"} onBlur={e=>e.target.style.borderColor="rgba(255,255,255,0.1)"} />
        </div>
      </div>
      {error && <div style={{ fontSize:11, color:"#ff4d6d", background:"rgba(255,77,109,0.08)", border:"1px solid rgba(255,77,109,0.2)", borderRadius:4, padding:"7px 10px", marginBottom:12 }}>{error}</div>}
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={()=>setOpen(false)} style={{ flex:1, background:"transparent", border:"1px solid rgba(255,255,255,0.1)", borderRadius:6, padding:"10px", color:"#475569", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", cursor:"pointer" }}>CANCEL</button>
        <button onClick={handleConnect} disabled={loading||!username||!apiKey}
          style={{ flex:2, background:loading||!username||!apiKey?"rgba(74,158,255,0.15)":"#4a9eff", border:"none", borderRadius:6, padding:"10px", color:loading||!username||!apiKey?"#1e3a5f":"#000", fontSize:11, fontFamily:"'IBM Plex Mono',monospace", letterSpacing:"0.06em", fontWeight:700, cursor:loading||!username||!apiKey?"not-allowed":"pointer" }}>
          {loading?"CONNECTING...":"CONNECT"}
        </button>
      </div>
      <div style={{ fontSize:9, color:"#334155", textAlign:"center", marginTop:12 }}>Credentials sent to your backend only — never stored in the browser</div>
    </div>
  </>);
}
