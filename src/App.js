import { useState, useEffect, useRef, useCallback } from "react";

const POLYGON_KEY = process.env.REACT_APP_POLYGON_KEY;
const ANTHROPIC_KEY = process.env.REACT_APP_ANTHROPIC_KEY;

const TICKER_SYMBOLS = ["SPY","QQQ","IWM","GLD","TLT"];
const DEFAULT_TICKERS = [
  { sym: "SPY", name: "S&P 500 ETF", price: 0, chg: 0, pct: 0 },
  { sym: "QQQ", name: "Nasdaq 100 ETF", price: 0, chg: 0, pct: 0 },
  { sym: "IWM", name: "Russell 2000 ETF", price: 0, chg: 0, pct: 0 },
  { sym: "GLD", name: "Gold ETF", price: 0, chg: 0, pct: 0 },
  { sym: "TLT", name: "20Y Treasury ETF", price: 0, chg: 0, pct: 0 },
];
const ECONOMIC_DATA = [
  { name: "Fed Funds Rate", value: "5.25–5.50%", prev: "5.25–5.50%", trend: "neutral", next: "Jun 12" },
  { name: "CPI YoY", value: "3.2%", prev: "3.4%", trend: "down", next: "Apr 10" },
  { name: "Core PCE", value: "2.8%", prev: "2.9%", trend: "down", next: "Mar 29" },
  { name: "Unemployment", value: "3.7%", prev: "3.7%", trend: "neutral", next: "Apr 5" },
  { name: "GDP Growth (Q4)", value: "3.2%", prev: "2.4%", trend: "up", next: "Mar 28" },
  { name: "10Y Treasury", value: "4.31%", prev: "4.18%", trend: "up", next: "Live" },
  { name: "2Y Treasury", value: "4.69%", prev: "4.62%", trend: "up", next: "Live" },
  { name: "ISM Manuf.", value: "47.8", prev: "49.1", trend: "down", next: "Apr 1" },
];
const OPTIONS_CHAIN = {
  underlying: "SPY", price: 527.43,
  expiries: ["Mar 15", "Mar 22", "Mar 28", "Apr 19", "May 17"],
  selectedExpiry: "Mar 22",
  strikes: [
    { strike: 510, callBid: 17.80, callAsk: 17.95, callOI: 42100, callIV: 18.2, putBid: 0.32, putAsk: 0.35, putOI: 18200, putIV: 17.8 },
    { strike: 515, callBid: 13.10, callAsk: 13.25, callOI: 38400, callIV: 17.4, putBid: 0.58, putAsk: 0.62, putOI: 22100, putIV: 17.1 },
    { strike: 520, callBid: 8.80, callAsk: 8.90, callOI: 61200, callIV: 16.8, putBid: 1.22, putAsk: 1.27, putOI: 44300, putIV: 16.5 },
    { strike: 525, callBid: 5.10, callAsk: 5.20, callOI: 88700, callIV: 16.1, putBid: 2.45, putAsk: 2.52, putOI: 71200, putIV: 15.9, atm: true },
    { strike: 527, callBid: 3.75, callAsk: 3.82, callOI: 29100, callIV: 15.9, putBid: 3.30, putAsk: 3.38, putOI: 31400, putIV: 15.7, atm: true },
    { strike: 530, callBid: 2.28, callAsk: 2.34, callOI: 94500, callIV: 15.4, putBid: 4.80, putAsk: 4.90, putOI: 88600, putIV: 15.3 },
    { strike: 535, callBid: 0.92, callAsk: 0.96, callOI: 71300, callIV: 15.8, putBid: 8.42, putAsk: 8.55, putOI: 52100, putIV: 15.6 },
    { strike: 540, callBid: 0.32, callAsk: 0.35, callOI: 48200, callIV: 16.4, putBid: 12.80, putAsk: 12.95, putOI: 28700, putIV: 16.2 },
    { strike: 545, callBid: 0.10, callAsk: 0.13, callOI: 31100, callIV: 17.1, putBid: 17.50, putAsk: 17.65, putOI: 14300, putIV: 16.9 },
  ],
};
const NEWS_ITEMS = [
  { time: "08:42", source: "WSJ", headline: "Fed officials signal patience on rate cuts as inflation remains sticky", impact: "high", tag: "MACRO" },
  { time: "08:31", source: "BBG", headline: "European Central Bank keeps rates on hold, hints at summer cut", impact: "medium", tag: "INTL" },
  { time: "08:19", source: "CNBC", headline: "Options market pricing in elevated volatility ahead of CPI print", impact: "high", tag: "OPTIONS" },
  { time: "08:05", source: "FT", headline: "Oil edges lower as demand concerns offset supply constraints", impact: "low", tag: "CMDTY" },
  { time: "07:58", source: "RTR", headline: "Treasury yield curve steepens as 10Y approaches 4.35%", impact: "high", tag: "RATES" },
  { time: "07:44", source: "BBG", headline: "JPMorgan upgrades financials sector, cites resilient consumer spending", impact: "medium", tag: "EQUITY" },
  { time: "07:33", source: "WSJ", headline: "Manufacturing PMI contracts for 5th consecutive month, recession fears mount", impact: "high", tag: "MACRO" },
  { time: "07:20", source: "FT", headline: "Nvidia surpasses Apple as most valuable company by market cap", impact: "medium", tag: "TECH" },
  { time: "07:08", source: "RTR", headline: "China trade data shows export growth slowing, yuan pressured", impact: "medium", tag: "INTL" },
  { time: "06:51", source: "CNBC", headline: "Put/call ratio spikes to 1.42 — highest reading since Oct 2023", impact: "high", tag: "OPTIONS" },
];
const GAMMA_DATA = {
  ES: {
    price: 6698, levels: [
      { price: 6800, type: "call_wall", label: "Call Wall", strength: 95, gamma: "+$2.1B" },
      { price: 6775, type: "resistance", label: "Gamma Resist", strength: 72, gamma: "+$980M" },
      { price: 6750, type: "resistance", label: "Key Resist", strength: 60, gamma: "+$620M" },
      { price: 6725, type: "resistance", label: "Minor Resist", strength: 38, gamma: "+$290M" },
      { price: 6698, type: "spot", label: "SPOT", strength: 100, gamma: "—" },
      { price: 6675, type: "support", label: "Minor Support", strength: 35, gamma: "-$240M" },
      { price: 6650, type: "support", label: "Key Support", strength: 65, gamma: "-$710M" },
      { price: 6600, type: "put_wall", label: "Put Wall", strength: 88, gamma: "-$1.8B" },
      { price: 6550, type: "support", label: "Major Support", strength: 80, gamma: "-$1.4B" },
    ],
    flipPoint: 6650, zerogamma: 6645, callGamma: "$4.2B", putGamma: "$3.6B", netGamma: "+$0.6B", regime: "positive",
  },
  NQ: {
    price: 24667, levels: [
      { price: 25200, type: "call_wall", label: "Call Wall", strength: 92, gamma: "+$1.4B" },
      { price: 25000, type: "resistance", label: "Gamma Resist", strength: 68, gamma: "+$760M" },
      { price: 24900, type: "resistance", label: "Key Resist", strength: 55, gamma: "+$440M" },
      { price: 24800, type: "resistance", label: "Minor Resist", strength: 30, gamma: "+$180M" },
      { price: 24667, type: "spot", label: "SPOT", strength: 100, gamma: "—" },
      { price: 24500, type: "support", label: "Minor Support", strength: 32, gamma: "-$160M" },
      { price: 24300, type: "support", label: "Key Support", strength: 70, gamma: "-$820M" },
      { price: 24000, type: "put_wall", label: "Put Wall", strength: 85, gamma: "-$1.2B" },
      { price: 23800, type: "support", label: "Major Support", strength: 75, gamma: "-$1.0B" },
    ],
    flipPoint: 24400, zerogamma: 24350, callGamma: "$2.8B", putGamma: "$2.2B", netGamma: "+$0.6B", regime: "positive",
  },
};

function useLivePrices() {
  const [tickers, setTickers] = useState(DEFAULT_TICKERS);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [status, setStatus] = useState("loading");
  const fetchPrices = useCallback(async () => {
    try {
      const results = await Promise.all(
        TICKER_SYMBOLS.map(sym => fetch(`https://api.polygon.io/v2/aggs/ticker/${sym}/prev?apiKey=${POLYGON_KEY}`).then(r => r.json()))
      );
      const updated = results.map((data, i) => {
        const result = data.results?.[0];
        if (!result) return DEFAULT_TICKERS[i];
        const chg = result.c - result.o;
        const pct = (chg / result.o) * 100;
        return { sym: TICKER_SYMBOLS[i], name: DEFAULT_TICKERS[i].name, price: result.c, chg: parseFloat(chg.toFixed(2)), pct: parseFloat(pct.toFixed(2)) };
      });
      setTickers(updated); setLastUpdated(new Date()); setStatus("live");
    } catch { setStatus("error"); }
  }, []);
  useEffect(() => { fetchPrices(); const i = setInterval(fetchPrices, 60000); return () => clearInterval(i); }, [fetchPrices]);
  return { tickers, lastUpdated, status, refresh: fetchPrices };
}

function Sparkline({ positive, width = 60, height = 24 }) {
  const pts = useRef(Array.from({ length: 20 }, (_, i) => 0.5 + Math.sin(i * 0.7) * 0.2 + (Math.random() - 0.5) * 0.15));
  const d = pts.current;
  const min = Math.min(...d), max = Math.max(...d), range = max - min || 1;
  const points = d.map((v, i) => `${(i / (d.length - 1)) * width},${height - ((v - min) / range) * height}`).join(" ");
  return <svg width={width} height={height} style={{ overflow: "visible" }}><polyline fill="none" stroke={positive ? "#00d4aa" : "#ff4d6d"} strokeWidth="1.5" strokeLinejoin="round" points={points} opacity="0.85" /></svg>;
}

function TickerTape({ tickers }) {
  return (
    <div style={{ overflow: "hidden", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)", height: 32, display: "flex", alignItems: "center" }}>
      <div style={{ display: "flex", gap: 40, animation: "tape 30s linear infinite", whiteSpace: "nowrap", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>
        {[...tickers, ...tickers].map((t, i) => (
          <span key={i} style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "#a0aec0", fontWeight: 600 }}>{t.sym}</span>
            <span style={{ color: "#e2e8f0" }}>{t.price > 0 ? t.price.toFixed(2) : "—"}</span>
            <span style={{ color: t.chg >= 0 ? "#00d4aa" : "#ff4d6d" }}>{t.chg >= 0 ? "▲" : "▼"} {Math.abs(t.pct).toFixed(2)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

async function streamClaude(prompt, systemPrompt, onChunk, onDone) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, stream: true, system: systemPrompt, messages: [{ role: "user", content: prompt }] }),
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n"); buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try { const p = JSON.parse(line.slice(6).trim()); if (p.type === "content_block_delta" && p.delta?.text) onChunk(p.delta.text); } catch {}
        }
      }
    }
    onDone();
  } catch { onChunk("Unable to connect to AI engine."); onDone(); }
}

function AIAnalysis({ prompt, systemPrompt, autoLoad = true }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const analyze = useCallback(async () => {
    setContent(""); setDone(false); setLoading(true);
    await streamClaude(prompt, systemPrompt || "You are a senior macro strategist and options trader at a top hedge fund. Provide sharp, data-driven market commentary in Bloomberg terminal style. Use specific numbers. Format with ALL CAPS headers. Under 300 words.", (c) => setContent(p => p + c), () => { setLoading(false); setDone(true); });
  }, [prompt]);
  useEffect(() => { if (autoLoad) analyze(); }, []);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: loading ? "#f6c90e" : done ? "#00d4aa" : "#666", animation: loading ? "pulse 1s infinite" : "none" }} />
          <span style={{ fontSize: 10, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.08em" }}>{loading ? "ANALYZING…" : "AI STRATEGIST · LIVE"}</span>
        </div>
        <button onClick={analyze} style={{ fontSize: 9, color: "#4a9eff", background: "none", border: "1px solid rgba(74,158,255,0.3)", borderRadius: 3, padding: "2px 8px", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace" }}>REFRESH</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", fontSize: 12, lineHeight: 1.7, color: "#cbd5e1", fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "pre-wrap" }}>
        {content || (loading && <span style={{ color: "#4a9eff", opacity: 0.6 }}>▋</span>)}
      </div>
    </div>
  );
}

function DirectionalBias({ tickers }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const spy = tickers.find(t => t.sym === "SPY");
  const qqq = tickers.find(t => t.sym === "QQQ");
  const compute = useCallback(async () => {
    setLoading(true); setResult(null);
    let text = "";
    const spyPrice = spy?.price > 0 ? spy.price : 527.43;
    const spyPct = spy?.pct ?? 0.21;
    const qqqPct = qqq?.pct ?? -0.21;
    await streamClaude(
      `Quantitative futures strategist. Compute ES directional probability for TODAY based on LIVE data.\nSPY: $${spyPrice} (${spyPct > 0 ? "+" : ""}${spyPct}%), QQQ: (${qqqPct > 0 ? "+" : ""}${qqqPct}%), VIX at 25.10, ES at 6698, NQ at 24667, ES gamma flip at 6650
, Call Wall: 5350ES Spot: 6698, Net Gamma: +$0.6B, Gamma Flip: 6650, Call Wall: 6800, Put Wall: 6600
\n10Y: 4.31%, 2Y: 4.69%, DXY: 104.83, Put/Call: 1.42\nISM: 47.8, GDP: 3.2%, CPI: 3.2%\nRespond ONLY with valid JSON no markdown:\n{"bullPct":int,"bearPct":int,"bias":"BUY"|"SELL"|"NEUTRAL","confidence":"HIGH"|"MEDIUM"|"LOW","signal":"string","keyRisk":"string","targets":{"upside1":int,"upside2":int,"downside1":int,"downside2":int},"factors":[{"name":"string","weight":int,"direction":"bull"|"bear"|"neutral"}],"summary":"string"}`,
      "You are a quantitative analyst. Respond ONLY with valid JSON. No markdown, no backticks.",
      (c) => { text += c; },
      () => {
        try { setResult(JSON.parse(text.replace(/```json|```/g, "").trim())); }
        catch { setResult({ bullPct: 52, bearPct: 48, bias: "NEUTRAL", confidence: "LOW", signal: "Analysis unavailable.", keyRisk: "N/A", targets: { upside1: 5300, upside2: 5325, downside1: 5250, downside2: 5225 }, factors: [], summary: "" }); }
        setLoading(false);
      }
    );
  }, [spy, qqq]);
  useEffect(() => { if (tickers.some(t => t.price > 0)) compute(); }, [tickers]);
  const biasColor = result?.bias === "BUY" ? "#00d4aa" : result?.bias === "SELL" ? "#ff4d6d" : "#f6c90e";
  const confColor = result?.confidence === "HIGH" ? "#00d4aa" : result?.confidence === "MEDIUM" ? "#f6c90e" : "#64748b";
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: loading ? "#f6c90e" : result ? "#00d4aa" : "#334155", animation: loading ? "pulse 1s infinite" : "none" }} />
          <span style={{ fontSize: 10, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace" }}>{loading ? "COMPUTING MODEL…" : "AI PROBABILITY MODEL · LIVE"}</span>
        </div>
        <button onClick={compute} style={{ fontSize: 9, color: "#4a9eff", background: "none", border: "1px solid rgba(74,158,255,0.3)", borderRadius: 3, padding: "2px 8px", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace" }}>RECALCULATE</button>
      </div>
      {loading && <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}><div style={{ fontSize: 11, color: "#334155", fontFamily: "'IBM Plex Mono', monospace" }}>Analyzing live market data…</div><div style={{ width: "60%", height: 2, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", background: "#4a9eff", animation: "loadbar 2s ease-in-out infinite", borderRadius: 2 }} /></div></div>}
      {result && !loading && (
        <>
          <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
            <div style={{ flex: "0 0 auto", background: `${biasColor}11`, border: `1px solid ${biasColor}44`, borderRadius: 8, padding: "14px 20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minWidth: 110 }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: biasColor, fontFamily: "'IBM Plex Mono', monospace" }}>{result.bias}</div>
              <div style={{ fontSize: 9, color: biasColor, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.1em", opacity: 0.7, marginTop: 2 }}>ES FUTURES</div>
              <div style={{ marginTop: 6, fontSize: 9, padding: "2px 8px", borderRadius: 10, background: `${confColor}22`, color: confColor, fontFamily: "'IBM Plex Mono', monospace" }}>{result.confidence} CONF</div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              {[{ label: "▲ BULL", pct: result.bullPct, color: "#00d4aa" }, { label: "▼ BEAR", pct: result.bearPct, color: "#ff4d6d" }].map(b => (
                <div key={b.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ fontSize: 10, color: b.color, fontFamily: "'IBM Plex Mono', monospace" }}>{b.label}</span><span style={{ fontSize: 13, fontWeight: 700, color: b.color, fontFamily: "'IBM Plex Mono', monospace" }}>{b.pct}%</span></div>
                  <div style={{ height: 8, background: "rgba(255,255,255,0.06)", borderRadius: 4, overflow: "hidden" }}><div style={{ height: "100%", width: `${b.pct}%`, background: b.color, borderRadius: 4 }} /></div>
                </div>
              ))}
            </div>
            <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", gap: 4, minWidth: 100 }}>
              {[{ label: "R2", val: result.targets.upside2, color: "#00d4aa" }, { label: "R1", val: result.targets.upside1, color: "#00d4aa99" }, { label: "SPOT", val: 5274, color: "#f6c90e" }, { label: "S1", val: result.targets.downside1, color: "#ff4d6d99" }, { label: "S2", val: result.targets.downside2, color: "#ff4d6d" }].map(t => (
                <div key={t.label} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span style={{ fontSize: 9, color: "#475569", fontFamily: "'IBM Plex Mono', monospace" }}>{t.label}</span><span style={{ fontSize: 10, fontWeight: 600, color: t.color, fontFamily: "'IBM Plex Mono', monospace" }}>{t.val.toLocaleString()}</span></div>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ background: "rgba(0,212,170,0.05)", border: "1px solid rgba(0,212,170,0.15)", borderRadius: 5, padding: "8px 10px" }}><div style={{ fontSize: 8, color: "#00d4aa", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.1em", marginBottom: 4 }}>PRIMARY SIGNAL</div><div style={{ fontSize: 11, color: "#a0d4c0", lineHeight: 1.5 }}>{result.signal}</div></div>
            <div style={{ background: "rgba(255,77,109,0.05)", border: "1px solid rgba(255,77,109,0.15)", borderRadius: 5, padding: "8px 10px" }}><div style={{ fontSize: 8, color: "#ff4d6d", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.1em", marginBottom: 4 }}>KEY RISK</div><div style={{ fontSize: 11, color: "#d4a0a8", lineHeight: 1.5 }}>{result.keyRisk}</div></div>
          </div>
          {result.factors?.length > 0 && <div><div style={{ fontSize: 8, color: "#334155", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.1em", marginBottom: 6 }}>FACTOR BREAKDOWN</div>{result.factors.map((f, i) => (<div key={i} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}><span style={{ fontSize: 10, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace", minWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span><div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.04)", borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", width: `${f.weight * 10}%`, borderRadius: 3, background: f.direction === "bull" ? "#00d4aa" : f.direction === "bear" ? "#ff4d6d" : "#64748b", opacity: 0.7 }} /></div><span style={{ fontSize: 9, color: f.direction === "bull" ? "#00d4aa" : f.direction === "bear" ? "#ff4d6d" : "#64748b", fontFamily: "'IBM Plex Mono', monospace", minWidth: 20 }}>{f.direction === "bull" ? "▲" : f.direction === "bear" ? "▼" : "→"}</span></div>))}</div>}
          <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.6, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 8 }}>{result.summary}</div>
        </>
      )}
    </div>
  );
}

function GammaLevels() {
  const [active, setActive] = useState("ES");
  const [aiOpen, setAiOpen] = useState(false);
  const data = GAMMA_DATA[active];
  const levelColor = (type) => ({ call_wall: "#00d4aa", put_wall: "#ff4d6d", spot: "#f6c90e", resistance: "#4a9eff", support: "#a78bfa" }[type] || "#64748b");
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {["ES", "NQ"].map(sym => (<button key={sym} onClick={() => setActive(sym)} style={{ fontSize: 11, padding: "4px 14px", borderRadius: 4, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, background: active === sym ? "rgba(74,158,255,0.15)" : "none", border: `1px solid ${active === sym ? "#4a9eff" : "rgba(255,255,255,0.1)"}`, color: active === sym ? "#4a9eff" : "#475569" }}>{sym}</button>))}
        <span style={{ marginLeft: "auto", fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", color: data.regime === "positive" ? "#00d4aa" : "#ff4d6d" }}>{data.regime === "positive" ? "● POS GAMMA" : "● NEG GAMMA"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {[{ label: "NET GAMMA", val: data.netGamma, color: data.netGamma.startsWith("+") ? "#00d4aa" : "#ff4d6d" }, { label: "CALL Γ", val: data.callGamma, color: "#4a9eff" }, { label: "PUT Γ", val: data.putGamma, color: "#ff4d6d" }, { label: "FLIP PT", val: data.flipPoint.toLocaleString(), color: "#f6c90e" }].map(item => (
          <div key={item.label} style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 5, padding: "6px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 8, color: "#334155", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.08em", marginBottom: 3 }}>{item.label}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: item.color, fontFamily: "'IBM Plex Mono', monospace" }}>{item.val}</div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {data.levels.slice().reverse().map((level, i) => {
          const isSpot = level.type === "spot"; const c = levelColor(level.type);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", padding: "5px 0", borderBottom: isSpot ? `1px solid ${c}55` : "1px solid rgba(255,255,255,0.04)", background: isSpot ? `${c}08` : "transparent" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: c, opacity: isSpot ? 1 : 0.6, flexShrink: 0, marginRight: 8 }} />
              <span style={{ fontSize: 12, fontWeight: isSpot ? 800 : 500, color: c, fontFamily: "'IBM Plex Mono', monospace", minWidth: 60 }}>{level.price.toLocaleString()}</span>
              <span style={{ fontSize: 9, color: isSpot ? c : "#475569", fontFamily: "'IBM Plex Mono', monospace", flex: 1 }}>{level.label}</span>
              <div style={{ width: (level.strength / 100) * 60, height: 4, background: c, borderRadius: 2, opacity: 0.4, marginRight: 8 }} />
              <span style={{ fontSize: 9, color: level.gamma.startsWith("+") ? "#00d4aa" : level.gamma.startsWith("-") ? "#ff4d6d" : "#64748b", fontFamily: "'IBM Plex Mono', monospace" }}>{level.gamma}</span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: "#334155", fontFamily: "'IBM Plex Mono', monospace", display: "flex", gap: 12 }}>
        <span>Zero-Gamma: <span style={{ color: "#f6c90e" }}>{data.zerogamma.toLocaleString()}</span></span>
        <span style={{ color: data.price > data.flipPoint ? "#00d4aa" : "#ff4d6d" }}>{data.price > data.flipPoint ? "▲ Above Flip" : "▼ Below Flip"}</span>
      </div>
      <button onClick={() => setAiOpen(!aiOpen)} style={{ fontSize: 10, color: "#4a9eff", background: "rgba(74,158,255,0.08)", border: "1px solid rgba(74,158,255,0.25)", borderRadius: 4, padding: "6px 12px", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", width: "100%" }}>{aiOpen ? "▲ HIDE GAMMA ANALYSIS" : "▼ AI GAMMA ANALYSIS"}</button>
      {aiOpen && <div style={{ background: "rgba(0,0,0,0.3)", borderRadius: 4, padding: 12, height: 160, flexShrink: 0 }}><AIAnalysis key={active} prompt={`Analyze gamma profile for ${active}. Spot ${data.price}, Net Gamma ${data.netGamma}, ${data.regime} gamma regime, Flip at ${data.flipPoint}, Call Wall ${data.levels.find(l => l.type === "call_wall")?.price}, Put Wall ${data.levels.find(l => l.type === "put_wall")?.price}. Explain dealer hedging dynamics and best trade setup.`} /></div>}
    </div>
  );
}

function OptionsChain() {
  const [selExpiry, setSelExpiry] = useState(OPTIONS_CHAIN.selectedExpiry);
  const [aiOpen, setAiOpen] = useState(false);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {OPTIONS_CHAIN.expiries.map(e => (<button key={e} onClick={() => setSelExpiry(e)} style={{ fontSize: 10, padding: "3px 10px", borderRadius: 3, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", background: selExpiry === e ? "#4a9eff22" : "none", border: `1px solid ${selExpiry === e ? "#4a9eff" : "rgba(255,255,255,0.1)"}`, color: selExpiry === e ? "#4a9eff" : "#64748b" }}>{e}</button>))}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#00d4aa", fontFamily: "'IBM Plex Mono', monospace", display: "flex", alignItems: "center" }}>SPY {OPTIONS_CHAIN.price}</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace" }}>
          <thead><tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{["BID","ASK","OI","IV","STRIKE","IV","OI","BID","ASK"].map((h, i) => (<th key={i} style={{ padding: "4px 6px", color: i < 4 ? "#4a9eff99" : i === 4 ? "#a0aec0" : "#ff4d6d99", fontWeight: 500, fontSize: 9, textAlign: i < 4 ? "right" : i === 4 ? "center" : "left" }}>{i < 4 ? `C-${h}` : i === 4 ? h : `P-${h}`}</th>))}</tr></thead>
          <tbody>{OPTIONS_CHAIN.strikes.map((row) => (<tr key={row.strike} style={{ background: row.atm ? "rgba(74,158,255,0.06)" : "transparent", borderBottom: "1px solid rgba(255,255,255,0.03)" }}><td style={{ padding: "5px 6px", textAlign: "right", color: "#4a9eff" }}>{row.callBid.toFixed(2)}</td><td style={{ padding: "5px 6px", textAlign: "right", color: "#a0aec0" }}>{row.callAsk.toFixed(2)}</td><td style={{ padding: "5px 6px", textAlign: "right", color: "#64748b" }}>{(row.callOI/1000).toFixed(1)}K</td><td style={{ padding: "5px 6px", textAlign: "right", color: "#a0aec0" }}>{row.callIV.toFixed(1)}%</td><td style={{ padding: "5px 6px", textAlign: "center", color: row.atm ? "#f6c90e" : "#e2e8f0", fontWeight: row.atm ? 700 : 400, borderLeft: "1px solid rgba(255,255,255,0.06)", borderRight: "1px solid rgba(255,255,255,0.06)" }}>{row.strike}</td><td style={{ padding: "5px 6px", textAlign: "left", color: "#a0aec0" }}>{row.putIV.toFixed(1)}%</td><td style={{ padding: "5px 6px", textAlign: "left", color: "#64748b" }}>{(row.putOI/1000).toFixed(1)}K</td><td style={{ padding: "5px 6px", textAlign: "left", color: "#ff4d6d" }}>{row.putBid.toFixed(2)}</td><td style={{ padding: "5px 6px", textAlign: "left", color: "#a0aec0" }}>{row.putAsk.toFixed(2)}</td></tr>))}</tbody>
        </table>
      </div>
      <button onClick={() => setAiOpen(!aiOpen)} style={{ marginTop: 8, fontSize: 10, color: "#4a9eff", background: "rgba(74,158,255,0.08)", border: "1px solid rgba(74,158,255,0.25)", borderRadius: 4, padding: "6px 12px", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", width: "100%" }}>{aiOpen ? "▲ HIDE AI OPTIONS ANALYSIS" : "▼ AI OPTIONS FLOW ANALYSIS"}</button>
      {aiOpen && <div style={{ marginTop: 8, background: "rgba(0,0,0,0.3)", borderRadius: 4, padding: 12, height: 160 }}><AIAnalysis prompt={`Analyze SPY options chain expiry ${selExpiry}. Underlying $527.43, ATM strikes 525/527, big OI at 530 (94.5K calls, 88.6K puts). IV skew, put/call dynamics, what's the trade?`} /></div>}
    </div>
  );
}

function EconomicIndicators() {
  const [aiOpen, setAiOpen] = useState(false);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {ECONOMIC_DATA.map((item, i) => (<div key={i} style={{ display: "flex", alignItems: "center", padding: "7px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}><span style={{ flex: 1, fontSize: 11, color: "#94a3b8", fontFamily: "'IBM Plex Mono', monospace" }}>{item.name}</span><span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", fontFamily: "'IBM Plex Mono', monospace", minWidth: 80, textAlign: "right" }}>{item.value}</span><span style={{ fontSize: 10, marginLeft: 8, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace", minWidth: 40, textAlign: "right" }}>{item.prev}</span><span style={{ marginLeft: 10, fontSize: 13, color: item.trend === "up" ? "#ff4d6d" : item.trend === "down" ? "#00d4aa" : "#64748b" }}>{item.trend === "up" ? "↑" : item.trend === "down" ? "↓" : "→"}</span><span style={{ marginLeft: 10, fontSize: 9, color: "#4a9eff", fontFamily: "'IBM Plex Mono', monospace", minWidth: 36, textAlign: "right" }}>{item.next}</span></div>))}
      </div>
      <button onClick={() => setAiOpen(!aiOpen)} style={{ marginTop: 8, fontSize: 10, color: "#4a9eff", background: "rgba(74,158,255,0.08)", border: "1px solid rgba(74,158,255,0.25)", borderRadius: 4, padding: "6px 12px", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace", width: "100%" }}>{aiOpen ? "▲ HIDE MACRO OUTLOOK" : "▼ AI MACRO OUTLOOK"}</button>
      {aiOpen && <div style={{ marginTop: 8, background: "rgba(0,0,0,0.3)", borderRadius: 4, padding: 12, height: 160 }}><AIAnalysis prompt="Fed at 5.25-5.50%, CPI 3.2%, GDP 3.2%, unemployment 3.7%, 10Y at 4.31%, ISM 47.8. Macro regime, rate cut timing, key equity risks, best sectors?" /></div>}
    </div>
  );
}

function NewsFeed() {
  const [selected, setSelected] = useState(null);
  const impactColor = { high: "#ff4d6d", medium: "#f6c90e", low: "#64748b" };
  const tagColor = { MACRO: "#4a9eff", OPTIONS: "#a78bfa", RATES: "#f6c90e", EQUITY: "#00d4aa", CMDTY: "#fb923c", INTL: "#60a5fa", TECH: "#34d399" };
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {NEWS_ITEMS.map((item, i) => (<div key={i} onClick={() => setSelected(item)} style={{ padding: "8px 6px", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer", background: selected?.headline === item.headline ? "rgba(74,158,255,0.07)" : "transparent" }} onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.03)"} onMouseLeave={e => e.currentTarget.style.background = selected?.headline === item.headline ? "rgba(74,158,255,0.07)" : "transparent"}><div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}><span style={{ fontSize: 9, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace" }}>{item.time}</span><span style={{ fontSize: 9, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{item.source}</span><span style={{ fontSize: 8, padding: "1px 5px", borderRadius: 2, color: tagColor[item.tag] || "#a0aec0", border: `1px solid ${tagColor[item.tag] || "#a0aec0"}33`, fontFamily: "'IBM Plex Mono', monospace" }}>{item.tag}</span><span style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: impactColor[item.impact], flexShrink: 0 }} /></div><div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.4 }}>{item.headline}</div></div>))}
      </div>
      {selected ? <div style={{ borderTop: "1px solid rgba(74,158,255,0.2)", background: "rgba(0,0,0,0.4)", padding: 12, height: 160, flexShrink: 0 }}><AIAnalysis key={selected.headline} prompt={`Analyze for day trader: "${selected.headline}". Trading implications, affected instruments, bullish/bearish, options play?`} /></div>
        : <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "10px 6px", color: "#334155", fontSize: 11, fontFamily: "'IBM Plex Mono', monospace", textAlign: "center" }}>↑ Click any headline for AI analysis</div>}
    </div>
  );
}

function MarketCards({ tickers, status, lastUpdated, refresh }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 4 }}>
        {tickers.map((t) => (
          <div key={t.sym} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 6, padding: "10px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
              <div><div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", fontFamily: "'IBM Plex Mono', monospace" }}>{t.sym}</div><div style={{ fontSize: 9, color: "#475569", fontFamily: "'IBM Plex Mono', monospace" }}>{t.name}</div></div>
              <Sparkline positive={t.chg >= 0} width={48} height={20} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#f1f5f9", fontFamily: "'IBM Plex Mono', monospace" }}>{t.price > 0 ? t.price.toFixed(2) : "—"}</span>
              <span style={{ fontSize: 10, color: t.chg >= 0 ? "#00d4aa" : "#ff4d6d", fontFamily: "'IBM Plex Mono', monospace" }}>{t.chg >= 0 ? "+" : ""}{t.pct.toFixed(2)}%</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 9, color: status === "live" ? "#00d4aa" : status === "error" ? "#ff4d6d" : "#64748b", fontFamily: "'IBM Plex Mono', monospace" }}>
          {status === "live" ? `● LIVE · Updated ${lastUpdated?.toLocaleTimeString()}` : status === "error" ? "● DATA ERROR — Check API key" : "● Loading…"}
        </span>
        <button onClick={refresh} style={{ fontSize: 9, color: "#4a9eff", background: "none", border: "1px solid rgba(74,158,255,0.2)", borderRadius: 3, padding: "2px 8px", cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace" }}>↻ REFRESH</button>
      </div>
    </div>
  );
}

function Panel({ title, badge, children, style = {} }) {
  return (
    <div style={{ background: "rgba(10,14,26,0.85)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, display: "flex", flexDirection: "column", overflow: "hidden", ...style }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, background: "rgba(0,0,0,0.25)" }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.1em", fontFamily: "'IBM Plex Mono', monospace", textTransform: "uppercase" }}>{title}</span>
        {badge && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "rgba(74,158,255,0.15)", color: "#4a9eff", fontFamily: "'IBM Plex Mono', monospace" }}>{badge}</span>}
      </div>
      <div style={{ flex: 1, padding: "12px 14px", overflow: "hidden", display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  const ny = new Date(time.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const lon = new Date(time.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const fmt = d => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const isMarketOpen = ny.getHours() >= 9 && (ny.getHours() < 16 || (ny.getHours() === 9 && ny.getMinutes() >= 30));
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "center", fontSize: 10, fontFamily: "'IBM Plex Mono', monospace" }}>
      <span style={{ color: "#64748b" }}>NY <span style={{ color: "#e2e8f0" }}>{fmt(ny)}</span></span>
      <span style={{ color: "#64748b" }}>LON <span style={{ color: "#e2e8f0" }}>{fmt(lon)}</span></span>
      <span style={{ padding: "2px 8px", borderRadius: 3, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", background: isMarketOpen ? "rgba(0,212,170,0.15)" : "rgba(255,77,109,0.15)", color: isMarketOpen ? "#00d4aa" : "#ff4d6d" }}>{isMarketOpen ? "● MARKET OPEN" : "● MARKET CLOSED"}</span>
    </div>
  );
}

export default function Terminal() {
  const { tickers, lastUpdated, status, refresh } = useLivePrices();
  return (
    <div style={{ minHeight: "100vh", background: "#060a14", backgroundImage: "radial-gradient(ellipse at 20% 20%, rgba(74,158,255,0.04) 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(0,212,170,0.03) 0%, transparent 50%)", color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=DM+Sans:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        @keyframes tape { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        @keyframes loadbar { 0% { width:0%; margin-left:0; } 50% { width:60%; margin-left:20%; } 100% { width:0%; margin-left:100%; } }
        .terminal-root { animation: fadeIn 0.4s ease both; }
      `}</style>
      <div style={{ padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(10px)", position: "sticky", top: 0, zIndex: 100, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "0.12em", color: "#4a9eff", fontFamily: "'IBM Plex Mono', monospace" }}>AXIOM</span>
            <span style={{ fontSize: 8, color: "#334155", letterSpacing: "0.2em", fontFamily: "'IBM Plex Mono', monospace" }}>TERMINAL</span>
          </div>
          <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.08)" }} />
          <nav style={{ display: "flex", gap: 2 }}>
            {["MARKETS","OPTIONS","MACRO","NEWS","AI DESK"].map((item, i) => (<span key={item} style={{ fontSize: 10, padding: "4px 10px", borderRadius: 4, cursor: "pointer", color: i === 0 ? "#4a9eff" : "#475569", fontFamily: "'IBM Plex Mono', monospace", background: i === 0 ? "rgba(74,158,255,0.1)" : "transparent", letterSpacing: "0.06em" }}>{item}</span>))}
          </nav>
        </div>
        <Clock />
      </div>
      <TickerTape tickers={tickers} />
      <div className="terminal-root" style={{ flex: 1, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, minHeight: 0 }}>
        <MarketCards tickers={tickers} status={status} lastUpdated={lastUpdated} refresh={refresh} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.3fr 1fr", gap: 12, height: 520 }}>
          <Panel title="News Feed" badge={`${NEWS_ITEMS.length} stories`}><NewsFeed /></Panel>
          <Panel title="Options Chain" badge="SPY · Live"><OptionsChain /></Panel>
          <Panel title="Economic Indicators" badge="Live"><EconomicIndicators /></Panel>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, height: 480 }}>
          <Panel title="ES Futures — Directional Probability" badge="AI MODEL · LIVE"><DirectionalBias tickers={tickers} /></Panel>
          <Panel title="Gamma Exposure Levels" badge="ES · NQ"><GammaLevels /></Panel>
        </div>
        <Panel title="AI Market Strategist · Live Briefing" badge="POWERED BY CLAUDE" style={{ height: 180 }}>
          <AIAnalysis prompt="Give a sharp morning market briefing for a day trader. Cover: 1) key macro risk events, 2) options market dynamics, 3) rates picture, 4) top 2 trade ideas with entry/risk levels." />
        </Panel>
      </div>
      <div style={{ padding: "6px 20px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between", fontSize: 9, color: "#1e293b", fontFamily: "'IBM Plex Mono', monospace" }}>
        <span>AXIOM TERMINAL v3.0.0 · FOR INFORMATIONAL PURPOSES ONLY · NOT FINANCIAL ADVICE</span>
        <span>POWERED BY CLAUDE AI · ANTHROPIC</span>
      </div>
    </div>
  );
}