import { useState, useEffect, useCallback, useMemo } from "react";

// ── CONSTANTS ────────────────────────────────────────────────────────────────
const INSTRUMENTS = ["ES", "NQ", "DAX", "XAU", "OIL"];
const STEPS = ["Trend", "VA Open", "Playbook", "Setup", "Entry", "R:R", "Signal"];
const MONO = "'IBM Plex Mono', monospace";

// ── SESSION CLOCK HELPER ─────────────────────────────────────────────────────
function useNYTime() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = ny.getHours();
  const m = ny.getMinutes();
  const mins = h * 60 + m;
  return { ny, h, m, mins };
}

function getSessionStatus(mins) {
  // IB: 8:00–9:00 EST (480–540)
  const ibActive = mins >= 480 && mins < 540;
  // DRF: 10:00 EST (600) — amber if within 30min (570–600), green at 600–610
  const drfAt = mins >= 600 && mins < 610;
  const drfNear = mins >= 570 && mins < 600;
  // NY Close: 16:00 EST (960) — amber if within 30min (930–960), green at 960–970
  const closeAt = mins >= 960 && mins < 970;
  const closeNear = mins >= 930 && mins < 960;

  let banner = "";
  let bannerColor = "#334155";
  if (ibActive) { banner = "IB OPEN"; bannerColor = "#00d4aa"; }
  else if (drfAt) { banner = "DRF WINDOW"; bannerColor = "#00d4aa"; }
  else if (drfNear) { banner = "DRF APPROACHING"; bannerColor = "#f6c90e"; }
  else if (closeAt) { banner = "NY CLOSE WINDOW"; bannerColor = "#00d4aa"; }
  else if (closeNear) { banner = "NY CLOSE APPROACHING"; bannerColor = "#f6c90e"; }
  else if (mins < 480) { banner = "PRE-MARKET"; bannerColor = "#475569"; }
  else if (mins >= 970) { banner = "AFTER HOURS"; bannerColor = "#475569"; }
  else { banner = "IB CLOSED"; bannerColor = "#475569"; }

  return { ibActive, drfAt, drfNear, closeAt, closeNear, banner, bannerColor };
}

// ── SESSION CLOCK COMPONENT ──────────────────────────────────────────────────
function SessionClock() {
  const { ny, mins } = useNYTime();
  const sess = getSessionStatus(mins);
  const fmt = ny.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  const dot = (active, near) => active ? "#00d4aa" : near ? "#f6c90e" : "#334155";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "rgba(0,0,0,0.3)", borderRadius: 5, border: "1px solid rgba(255,255,255,0.05)", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", fontFamily: MONO }}>{fmt}</span>
        <span style={{ fontSize: 8, color: "#475569", fontFamily: MONO }}>EST</span>
      </div>
      <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.08)" }} />
      <div style={{ display: "flex", gap: 8 }}>
        <span style={{ fontSize: 8, fontFamily: MONO, color: dot(sess.ibActive, false) }}>● IB 8-9a</span>
        <span style={{ fontSize: 8, fontFamily: MONO, color: dot(sess.drfAt, sess.drfNear) }}>● DRF 10a</span>
        <span style={{ fontSize: 8, fontFamily: MONO, color: dot(sess.closeAt, sess.closeNear) }}>● CLOSE 4p</span>
      </div>
      <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.08)" }} />
      <span style={{
        fontSize: 8, fontWeight: 700, fontFamily: MONO, letterSpacing: "0.08em",
        color: sess.bannerColor,
        padding: "1px 6px", borderRadius: 3,
        background: sess.bannerColor + "18",
      }}>{sess.banner}</span>
    </div>
  );
}

// ── ATR / R CALCULATOR ───────────────────────────────────────────────────────
function ATRCalculator() {
  const [instrument, setInstrument] = useState("ES");
  const [atr, setAtr] = useState("");
  const [entry, setEntry] = useState("");
  const [direction, setDirection] = useState("LONG");

  const levels = useMemo(() => {
    const a = parseFloat(atr);
    const e = parseFloat(entry);
    if (!a || !e || a <= 0) return null;
    const sign = direction === "LONG" ? 1 : -1;
    const stop = e - sign * a;
    return {
      stop: stop.toFixed(2),
      r1: (e + sign * a).toFixed(2),
      r2: (e + sign * 2 * a).toFixed(2),
      r3: (e + sign * 3 * a).toFixed(2),
      r5: (e + sign * 5 * a).toFixed(2),
    };
  }, [atr, entry, direction]);

  const inputStyle = {
    background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 3, padding: "4px 6px", color: "#e2e8f0", fontSize: 10,
    fontFamily: MONO, outline: "none", width: "100%",
  };
  const labelStyle = { fontSize: 8, color: "#475569", fontFamily: MONO, letterSpacing: "0.06em", marginBottom: 2 };

  return (
    <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 5, padding: 10, border: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", fontFamily: MONO, letterSpacing: "0.1em", marginBottom: 8 }}>
        ATR / R CALCULATOR
      </div>
      {/* Instrument pills */}
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {INSTRUMENTS.map(inst => (
          <button key={inst} onClick={() => setInstrument(inst)} style={{
            fontSize: 8, fontFamily: MONO, fontWeight: 600, padding: "2px 7px",
            borderRadius: 3, cursor: "pointer", letterSpacing: "0.06em",
            background: instrument === inst ? "rgba(74,158,255,0.2)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${instrument === inst ? "rgba(74,158,255,0.4)" : "rgba(255,255,255,0.08)"}`,
            color: instrument === inst ? "#4a9eff" : "#475569",
          }}>{inst}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 0.7fr", gap: 8, marginBottom: 8 }}>
        <div>
          <div style={labelStyle}>D1 ATR (14p / 20d TR)</div>
          <input style={inputStyle} placeholder="e.g. 45.5" value={atr} onChange={e => setAtr(e.target.value)} />
        </div>
        <div>
          <div style={labelStyle}>ENTRY PRICE</div>
          <input style={inputStyle} placeholder="e.g. 5420" value={entry} onChange={e => setEntry(e.target.value)} />
        </div>
        <div>
          <div style={labelStyle}>DIRECTION</div>
          <select value={direction} onChange={e => setDirection(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </div>
      </div>
      {levels && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <LevelPill label="STOP" value={levels.stop} color="#ff4d6d" />
          <LevelPill label="1R" value={levels.r1} color="#f6c90e" />
          <LevelPill label="2R" value={levels.r2} color="#00d4aa" />
          <LevelPill label="3R" value={levels.r3} color="#00d4aa" />
          <LevelPill label="5R" value={levels.r5} color="#4a9eff" />
        </div>
      )}
      <div style={{ fontSize: 7, color: "#334155", fontFamily: MONO, marginTop: 6 }}>
        1R = 14-period ATR on D1 · ADR = 20-day True Range average
      </div>
    </div>
  );
}

function LevelPill({ label, value, color }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4, padding: "3px 8px",
      background: color + "15", border: `1px solid ${color}33`, borderRadius: 3,
    }}>
      <span style={{ fontSize: 7, fontWeight: 700, color, fontFamily: MONO, letterSpacing: "0.06em" }}>{label}</span>
      <span style={{ fontSize: 9, color: "#e2e8f0", fontFamily: MONO }}>{value}</span>
    </div>
  );
}

// ── DECISION TREE ────────────────────────────────────────────────────────────
const TREE = {
  // ── STEP 0: TREND ──────────────────────────────────────────────────────────
  start: {
    id: "start", step: 0,
    question: "What is the higher-timeframe trend?",
    context: "Check the D1 / H4 chart. Is price making higher highs + higher lows (uptrend), lower highs + lower lows (downtrend), or chopping inside a range? Active sessions: NY DRF 10am · NY Close 4pm EST.",
    options: [
      { label: "\u2B06 UPTREND", value: "uptrend", next: "va_open_up" },
      { label: "\u2B07 DOWNTREND", value: "downtrend", next: "va_open_down" },
      { label: "\u2194 RANGE / CHOP", value: "range", next: "va_open_range" },
    ],
  },

  // ── STEP 1: VA OPEN — UPTREND ─────────────────────────────────────────────
  va_open_up: {
    id: "va_open_up", step: 1,
    question: "Where did price open relative to Value Area? (TPO-based)",
    context: "Uptrend context. Compare the open to yesterday's VAH / VAL / POC (TPO-based Value Area — time/Market Profile letters). Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL. An open above VA is strongest for continuation. IB = 8:00-9:00am EST.",
    options: [
      { label: "Above VA", value: "above_va", next: "pb1_up_setup" },
      { label: "Inside VA", value: "inside_va", next: "pb2_up_setup" },
      { label: "Below VA", value: "below_va", next: "pb_ct_check_up" },
    ],
  },

  // ── STEP 1: VA OPEN — DOWNTREND ───────────────────────────────────────────
  va_open_down: {
    id: "va_open_down", step: 1,
    question: "Where did price open relative to Value Area? (TPO-based)",
    context: "Downtrend context. TPO-based Value Area (time/Market Profile letters). Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL. An open below VA is strongest for short continuation. IB = 8:00-9:00am EST.",
    options: [
      { label: "Below VA", value: "below_va", next: "pb1_down_setup" },
      { label: "Inside VA", value: "inside_va", next: "pb2_down_setup" },
      { label: "Above VA", value: "above_va", next: "pb_ct_check_down" },
    ],
  },

  // ── STEP 1: VA OPEN — RANGE ───────────────────────────────────────────────
  va_open_range: {
    id: "va_open_range", step: 1,
    question: "Where did price open relative to Value Area? (TPO-based)",
    context: "Range / chop context. TPO-based Value Area (time/Market Profile letters). Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL. Look for mean-reversion plays back to POC or VA edges. IB = 8:00-9:00am EST.",
    options: [
      { label: "Above VA (fade short)", value: "above_va", next: "pb3_range_short" },
      { label: "Inside VA (wait)", value: "inside_va", next: "signal_no_trade_range" },
      { label: "Below VA (fade long)", value: "below_va", next: "pb3_range_long" },
    ],
  },

  // ── PB1: TREND CONTINUATION (UP) ──────────────────────────────────────────
  pb1_up_setup: {
    id: "pb1_up_setup", step: 2,
    question: "PB1 — Trend Continuation Long",
    context: "Price opened above VA (TPO-based) in an uptrend. Highest-probability setup. We want a pullback into VAH or POC as support, then continuation higher. Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL.",
    options: [
      { label: "Pullback to VAH/POC holding", value: "pb_holding", next: "pb1_up_entry" },
      { label: "No pullback — running away", value: "no_pb", next: "signal_no_trade_chasing" },
      { label: "Pullback broke through VA", value: "pb_broke", next: "pb2_up_setup" },
    ],
  },
  pb1_up_entry: {
    id: "pb1_up_entry", step: 3,
    question: "Is there a valid Phase 1 (bullish) entry trigger?",
    context: "Phase 1 trigger: Bullish engulf OR consolidation breaking above swing high on M15/M30/H4. Also confirm: reclaim of VAH on volume, delta flip positive, or VWAP hold. Need at least 2 confirmations. Active session: NY DRF 10am · NY Close 4pm EST.",
    options: [
      { label: "Yes — Phase 1 confirmed + 2 confluences", value: "confirmed", next: "pb1_up_rr" },
      { label: "Weak — only 1 signal", value: "weak", next: "signal_no_trade_weak" },
      { label: "No — price rejecting", value: "no", next: "signal_no_trade_reject" },
    ],
  },
  pb1_up_rr: {
    id: "pb1_up_rr", step: 4,
    question: "What is the risk:reward?",
    context: "Stop = 1x ATR (14-period on D1) below entry. Target the prior high, +1 ATR, or next resistance. 1R = D1 ATR. Minimum 2:1 R:R for PB1.",
    options: [
      { label: "\u2265 3:1 R:R — excellent", value: "3to1", next: "signal_pb1_long_strong" },
      { label: "2:1 R:R — acceptable", value: "2to1", next: "signal_pb1_long" },
      { label: "< 2:1 R:R — pass", value: "sub2", next: "signal_no_trade_rr" },
    ],
  },

  // ── PB1: TREND CONTINUATION (DOWN) ────────────────────────────────────────
  pb1_down_setup: {
    id: "pb1_down_setup", step: 2,
    question: "PB1 — Trend Continuation Short",
    context: "Price opened below VA (TPO-based) in a downtrend. Highest-probability short setup. Look for a bounce into VAL or POC as resistance, then continuation lower. Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL.",
    options: [
      { label: "Bounce to VAL/POC rejected", value: "bounce_reject", next: "pb1_down_entry" },
      { label: "No bounce — flushing down", value: "no_bounce", next: "signal_no_trade_chasing" },
      { label: "Bounce reclaimed VA", value: "bounce_reclaim", next: "pb2_down_setup" },
    ],
  },
  pb1_down_entry: {
    id: "pb1_down_entry", step: 3,
    question: "Is there a valid Phase 3 (bearish) entry trigger?",
    context: "Phase 3 trigger: 3-bar reversal pattern (bearish) on M15/M30/H4. Also confirm: rejection at VAL on volume, delta flip negative, or VWAP rejection. Need at least 2 confirmations. Active session: NY DRF 10am · NY Close 4pm EST.",
    options: [
      { label: "Yes — Phase 3 confirmed + 2 confluences", value: "confirmed", next: "pb1_down_rr" },
      { label: "Weak — only 1 signal", value: "weak", next: "signal_no_trade_weak" },
      { label: "No — price reclaiming", value: "no", next: "signal_no_trade_reject" },
    ],
  },
  pb1_down_rr: {
    id: "pb1_down_rr", step: 4,
    question: "What is the risk:reward?",
    context: "Stop = 1x ATR (14-period on D1) above entry. Target the prior low, -1 ATR, or next support. 1R = D1 ATR. Minimum 2:1 R:R required.",
    options: [
      { label: "\u2265 3:1 R:R — excellent", value: "3to1", next: "signal_pb1_short_strong" },
      { label: "2:1 R:R — acceptable", value: "2to1", next: "signal_pb1_short" },
      { label: "< 2:1 R:R — pass", value: "sub2", next: "signal_no_trade_rr" },
    ],
  },

  // ── PB2: RETURN TO VA (UP — inside VA open) ──────────────────────────────
  pb2_up_setup: {
    id: "pb2_up_setup", step: 2,
    question: "PB2 — Return to VAH (Long)",
    context: "Uptrend but opened inside VA (TPO-based). Price should push back toward VAH. Look for acceptance above POC as the trigger zone. Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL.",
    options: [
      { label: "Holding above POC", value: "above_poc", next: "pb2_up_entry" },
      { label: "Stuck at POC — no momentum", value: "stuck", next: "signal_no_trade_chop" },
      { label: "Rejected below POC", value: "below_poc", next: "signal_no_trade_reject" },
    ],
  },
  pb2_up_entry: {
    id: "pb2_up_entry", step: 3,
    question: "Is there a valid Phase 1 (bullish) entry trigger?",
    context: "Phase 1 trigger: Bullish engulf OR consolidation breaking above swing high on M15/M30/H4. Confirm: price reclaiming POC with increasing volume, bid stacking on DOM. Target VAH. Active session: NY DRF 10am · NY Close 4pm EST.",
    options: [
      { label: "Yes — Phase 1 + POC reclaim confirmed", value: "confirmed", next: "pb2_up_rr" },
      { label: "Marginal — low conviction", value: "marginal", next: "signal_no_trade_weak" },
    ],
  },
  pb2_up_rr: {
    id: "pb2_up_rr", step: 4,
    question: "What is the risk:reward to VAH?",
    context: "Stop = 1x ATR (14-period on D1) below entry. Target VAH. 1R = D1 ATR. PB2 typically has tighter targets than PB1.",
    options: [
      { label: "\u2265 2:1 R:R", value: "2to1", next: "signal_pb2_long" },
      { label: "< 2:1 R:R — too tight", value: "sub2", next: "signal_no_trade_rr" },
    ],
  },

  // ── PB2: RETURN TO VA (DOWN — inside VA open) ────────────────────────────
  pb2_down_setup: {
    id: "pb2_down_setup", step: 2,
    question: "PB2 — Return to VAL (Short)",
    context: "Downtrend but opened inside VA (TPO-based). Price should push back toward VAL. Look for rejection below POC as the trigger zone. Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL.",
    options: [
      { label: "Holding below POC", value: "below_poc", next: "pb2_down_entry" },
      { label: "Stuck at POC — no momentum", value: "stuck", next: "signal_no_trade_chop" },
      { label: "Reclaimed above POC", value: "above_poc", next: "signal_no_trade_reject" },
    ],
  },
  pb2_down_entry: {
    id: "pb2_down_entry", step: 3,
    question: "Is there a valid Phase 3 (bearish) entry trigger?",
    context: "Phase 3 trigger: 3-bar reversal pattern (bearish) on M15/M30/H4. Confirm: price rejecting POC with increasing volume, offer stacking on DOM. Target VAL. Active session: NY DRF 10am · NY Close 4pm EST.",
    options: [
      { label: "Yes — Phase 3 + POC rejection confirmed", value: "confirmed", next: "pb2_down_rr" },
      { label: "Marginal — low conviction", value: "marginal", next: "signal_no_trade_weak" },
    ],
  },
  pb2_down_rr: {
    id: "pb2_down_rr", step: 4,
    question: "What is the risk:reward to VAL?",
    context: "Stop = 1x ATR (14-period on D1) above entry. Target VAL. 1R = D1 ATR.",
    options: [
      { label: "\u2265 2:1 R:R", value: "2to1", next: "signal_pb2_short" },
      { label: "< 2:1 R:R — too tight", value: "sub2", next: "signal_no_trade_rr" },
    ],
  },

  // ── PB3: COUNTERTREND — ADR EXHAUSTION ────────────────────────────────────
  pb_ct_check_up: {
    id: "pb_ct_check_up", step: 2,
    question: "PB3/PB4 — Countertrend Check",
    context: "Price opened below VA (TPO-based) in an uptrend — unusual. Check if ADR is exhausted (price moved \u2265 80% of 20-day True Range ADR) for a CT fade, or look for a swing reversal setup. Active session: NY DRF 10am · NY Close 4pm EST.",
    options: [
      { label: "ADR \u2265 80% exhausted — PB3 fade", value: "adr_exhausted", next: "pb3_ct_long_entry" },
      { label: "Major level + reversal candle — PB4 swing", value: "swing_setup", next: "pb4_swing_long_entry" },
      { label: "Neither — no setup", value: "neither", next: "signal_no_trade_nosetup" },
    ],
  },
  pb_ct_check_down: {
    id: "pb_ct_check_down", step: 2,
    question: "PB3/PB4 — Countertrend Check",
    context: "Price opened above VA (TPO-based) in a downtrend — unusual. Check if ADR is exhausted (price moved \u2265 80% of 20-day True Range ADR) for a CT fade, or look for a swing reversal setup. Active session: NY DRF 10am · NY Close 4pm EST.",
    options: [
      { label: "ADR \u2265 80% exhausted — PB3 fade", value: "adr_exhausted", next: "pb3_ct_short_entry" },
      { label: "Major level + reversal candle — PB4 swing", value: "swing_setup", next: "pb4_swing_short_entry" },
      { label: "Neither — no setup", value: "neither", next: "signal_no_trade_nosetup" },
    ],
  },

  // PB3 CT intraday entries
  pb3_ct_long_entry: {
    id: "pb3_ct_long_entry", step: 3,
    question: "PB3 — CT Intraday Long: Phase 1 trigger?",
    context: "ADR exhausted to the downside (20-day True Range ADR). Phase 1 trigger: Bullish engulf OR consolidation breaking above swing high on M15/M30/H4. Also look for: hammer/doji at support, volume climax + absorption, delta divergence. Countertrend — size down 50%. IB = 8:00-9:00am EST.",
    options: [
      { label: "Phase 1 confirmed — volume + candle", value: "confirmed", next: "pb3_ct_long_rr" },
      { label: "No clear reversal signal", value: "no", next: "signal_no_trade_noconfirm" },
    ],
  },
  pb3_ct_long_rr: {
    id: "pb3_ct_long_rr", step: 4,
    question: "R:R for CT intraday long?",
    context: "Stop = 1x ATR (14-period on D1) below entry. Target VWAP or POC (not full VA — this is a scalp). 1R = D1 ATR. Minimum 1.5:1 for CT trades. Half size.",
    options: [
      { label: "\u2265 2:1 R:R", value: "2to1", next: "signal_pb3_ct_long" },
      { label: "1.5:1 R:R — marginal", value: "1.5to1", next: "signal_pb3_ct_long_marginal" },
      { label: "< 1.5:1 — skip", value: "sub1.5", next: "signal_no_trade_rr" },
    ],
  },
  pb3_ct_short_entry: {
    id: "pb3_ct_short_entry", step: 3,
    question: "PB3 — CT Intraday Short: Phase 3 trigger?",
    context: "ADR exhausted to the upside (20-day True Range ADR). Phase 3 trigger: 3-bar reversal pattern (bearish) on M15/M30/H4. Also look for: shooting star at resistance, volume climax + absorption, delta divergence. Countertrend — size down 50%. IB = 8:00-9:00am EST.",
    options: [
      { label: "Phase 3 confirmed — volume + candle", value: "confirmed", next: "pb3_ct_short_rr" },
      { label: "No clear reversal signal", value: "no", next: "signal_no_trade_noconfirm" },
    ],
  },
  pb3_ct_short_rr: {
    id: "pb3_ct_short_rr", step: 4,
    question: "R:R for CT intraday short?",
    context: "Stop = 1x ATR (14-period on D1) above entry. Target VWAP or POC. 1R = D1 ATR. Minimum 1.5:1 for CT trades. Half size.",
    options: [
      { label: "\u2265 2:1 R:R", value: "2to1", next: "signal_pb3_ct_short" },
      { label: "1.5:1 R:R — marginal", value: "1.5to1", next: "signal_pb3_ct_short_marginal" },
      { label: "< 1.5:1 — skip", value: "sub1.5", next: "signal_no_trade_rr" },
    ],
  },

  // PB3 Range fades
  pb3_range_long: {
    id: "pb3_range_long", step: 2,
    question: "PB3 — Range Fade Long",
    context: "Price opened below VA (TPO-based) in a range. Fade back toward POC/VAL. Look for Phase 1 trigger: Bullish engulf OR consolidation breaking above swing high on M15/M30/H4. Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL.",
    options: [
      { label: "Phase 1 reversal at support", value: "confirmed", next: "pb3_range_long_rr" },
      { label: "No reversal — breaking down", value: "no", next: "signal_no_trade_noconfirm" },
    ],
  },
  pb3_range_long_rr: {
    id: "pb3_range_long_rr", step: 4,
    question: "R:R for range fade long?",
    context: "Stop = 1x ATR (14-period on D1) below entry. Target POC. 1R = D1 ATR. Half size — range trades are lower conviction.",
    options: [
      { label: "\u2265 2:1 R:R", value: "2to1", next: "signal_pb3_range_long" },
      { label: "< 2:1 — skip", value: "sub2", next: "signal_no_trade_rr" },
    ],
  },
  pb3_range_short: {
    id: "pb3_range_short", step: 2,
    question: "PB3 — Range Fade Short",
    context: "Price opened above VA (TPO-based) in a range. Fade back toward POC/VAH. Look for Phase 3 trigger: 3-bar reversal pattern (bearish) on M15/M30/H4. Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL.",
    options: [
      { label: "Phase 3 reversal at resistance", value: "confirmed", next: "pb3_range_short_rr" },
      { label: "No reversal — breaking out", value: "no", next: "signal_no_trade_noconfirm" },
    ],
  },
  pb3_range_short_rr: {
    id: "pb3_range_short_rr", step: 4,
    question: "R:R for range fade short?",
    context: "Stop = 1x ATR (14-period on D1) above entry. Target POC. 1R = D1 ATR. Half size.",
    options: [
      { label: "\u2265 2:1 R:R", value: "2to1", next: "signal_pb3_range_short" },
      { label: "< 2:1 — skip", value: "sub2", next: "signal_no_trade_rr" },
    ],
  },

  // ── PB4: COUNTERTREND SWING ───────────────────────────────────────────────
  pb4_swing_long_entry: {
    id: "pb4_swing_long_entry", step: 3,
    question: "PB4 — CT Swing Long: Phase 1 confirmation",
    context: "Major support level + Phase 1 trigger: Bullish engulf OR consolidation breaking above swing high on M15/M30/H4. Multi-day swing — need strong conviction. Check: weekly S/R, monthly VWAP, volume profile HVN. Active session: NY DRF 10am · NY Close 4pm EST.",
    options: [
      { label: "Phase 1 confirmed + major level — high conviction", value: "high", next: "pb4_swing_long_rr" },
      { label: "Level OK but candle weak", value: "weak", next: "signal_no_trade_weak" },
    ],
  },
  pb4_swing_long_rr: {
    id: "pb4_swing_long_rr", step: 4,
    question: "R:R for swing long?",
    context: "Stop = 1x ATR (14-period on D1) below entry. Target the prior swing high or weekly level. 1R = D1 ATR. Swing trades need \u2265 3:1 R:R.",
    options: [
      { label: "\u2265 3:1 R:R", value: "3to1", next: "signal_pb4_swing_long" },
      { label: "< 3:1 — not enough for swing", value: "sub3", next: "signal_no_trade_rr" },
    ],
  },
  pb4_swing_short_entry: {
    id: "pb4_swing_short_entry", step: 3,
    question: "PB4 — CT Swing Short: Phase 3 confirmation",
    context: "Major resistance level + Phase 3 trigger: 3-bar reversal pattern (bearish) on M15/M30/H4. Multi-day swing short. Check: weekly R, monthly VWAP, volume profile HVN. Active session: NY DRF 10am · NY Close 4pm EST.",
    options: [
      { label: "Phase 3 confirmed + major level — high conviction", value: "high", next: "pb4_swing_short_rr" },
      { label: "Level OK but candle weak", value: "weak", next: "signal_no_trade_weak" },
    ],
  },
  pb4_swing_short_rr: {
    id: "pb4_swing_short_rr", step: 4,
    question: "R:R for swing short?",
    context: "Stop = 1x ATR (14-period on D1) above entry. Target the prior swing low or weekly level. 1R = D1 ATR. Swing trades need \u2265 3:1 R:R.",
    options: [
      { label: "\u2265 3:1 R:R", value: "3to1", next: "signal_pb4_swing_short" },
      { label: "< 3:1 — not enough for swing", value: "sub3", next: "signal_no_trade_rr" },
    ],
  },

  // ── TERMINAL SIGNALS ──────────────────────────────────────────────────────
  // PB1
  signal_pb1_long_strong:  { id: "signal_pb1_long_strong",  step: 6, signal: "LONG",  color: "#00d4aa", label: "PB1 LONG \u2014 HIGH CONVICTION", summary: "Trend continuation long. Open above VA (TPO), pullback held, Phase 1 confirmed (bullish engulf / break above swing high M15/M30/H4), 3:1+ R:R. Full size. Stop = 1x D1 ATR. Trail to BE at 1R." },
  signal_pb1_long:         { id: "signal_pb1_long",         step: 6, signal: "LONG",  color: "#00d4aa", label: "PB1 LONG \u2014 STANDARD",        summary: "Trend continuation long. Open above VA (TPO), pullback held, Phase 1 confirmed, 2:1 R:R. Standard size. Stop = 1x D1 ATR below entry." },
  signal_pb1_short_strong: { id: "signal_pb1_short_strong", step: 6, signal: "SHORT", color: "#ff4d6d", label: "PB1 SHORT \u2014 HIGH CONVICTION", summary: "Trend continuation short. Open below VA (TPO), bounce rejected, Phase 3 confirmed (3-bar reversal M15/M30/H4), 3:1+ R:R. Full size. Stop = 1x D1 ATR. Trail to BE at 1R." },
  signal_pb1_short:        { id: "signal_pb1_short",        step: 6, signal: "SHORT", color: "#ff4d6d", label: "PB1 SHORT \u2014 STANDARD",        summary: "Trend continuation short. Open below VA (TPO), bounce rejected, Phase 3 confirmed, 2:1 R:R. Standard size. Stop = 1x D1 ATR above entry." },

  // PB2
  signal_pb2_long:  { id: "signal_pb2_long",  step: 6, signal: "LONG",  color: "#00d4aa", label: "PB2 LONG \u2014 RETURN TO VAH",  summary: "Inside VA (TPO), holding above POC in uptrend. Phase 1 confirmed. Target VAH. Standard size. Stop = 1x D1 ATR below entry." },
  signal_pb2_short: { id: "signal_pb2_short", step: 6, signal: "SHORT", color: "#ff4d6d", label: "PB2 SHORT \u2014 RETURN TO VAL", summary: "Inside VA (TPO), holding below POC in downtrend. Phase 3 confirmed. Target VAL. Standard size. Stop = 1x D1 ATR above entry." },

  // PB3 CT intraday
  signal_pb3_ct_long:           { id: "signal_pb3_ct_long",           step: 6, signal: "CT LONG",  color: "#f6c90e", label: "PB3 CT INTRADAY LONG",          summary: "ADR exhausted (20d TR) to downside. Phase 1 confirmed. Target VWAP/POC. HALF SIZE \u2014 countertrend. Stop = 1x D1 ATR." },
  signal_pb3_ct_long_marginal:  { id: "signal_pb3_ct_long_marginal",  step: 6, signal: "CT LONG",  color: "#f6c90e", label: "PB3 CT LONG \u2014 MARGINAL",        summary: "ADR exhausted (20d TR), marginal R:R (1.5:1). Quarter size max. Quick scalp to VWAP only. Stop = 1x D1 ATR." },
  signal_pb3_ct_short:          { id: "signal_pb3_ct_short",          step: 6, signal: "CT SHORT", color: "#f6c90e", label: "PB3 CT INTRADAY SHORT",         summary: "ADR exhausted (20d TR) to upside. Phase 3 confirmed. Target VWAP/POC. HALF SIZE \u2014 countertrend. Stop = 1x D1 ATR." },
  signal_pb3_ct_short_marginal: { id: "signal_pb3_ct_short_marginal", step: 6, signal: "CT SHORT", color: "#f6c90e", label: "PB3 CT SHORT \u2014 MARGINAL",       summary: "ADR exhausted (20d TR), marginal R:R (1.5:1). Quarter size max. Quick scalp to VWAP only. Stop = 1x D1 ATR." },
  signal_pb3_range_long:        { id: "signal_pb3_range_long",        step: 6, signal: "CT LONG",  color: "#f6c90e", label: "PB3 RANGE FADE LONG",           summary: "Range market, fading from below VA (TPO) back to POC. Phase 1 confirmed. Half size. Stop = 1x D1 ATR." },
  signal_pb3_range_short:       { id: "signal_pb3_range_short",       step: 6, signal: "CT SHORT", color: "#f6c90e", label: "PB3 RANGE FADE SHORT",          summary: "Range market, fading from above VA (TPO) back to POC. Phase 3 confirmed. Half size. Stop = 1x D1 ATR." },

  // PB4 CT swing
  signal_pb4_swing_long:  { id: "signal_pb4_swing_long",  step: 6, signal: "SWING LONG",  color: "#4a9eff", label: "PB4 CT SWING LONG",  summary: "Major daily reversal at key support. Phase 1 confirmed (bullish engulf / break above swing high). Multi-day hold. 3:1+ R:R. Standard size. Stop = 1x D1 ATR below entry." },
  signal_pb4_swing_short: { id: "signal_pb4_swing_short", step: 6, signal: "SWING SHORT", color: "#4a9eff", label: "PB4 CT SWING SHORT", summary: "Major daily reversal at key resistance. Phase 3 confirmed (3-bar reversal). Multi-day hold. 3:1+ R:R. Standard size. Stop = 1x D1 ATR above entry." },

  // No-trade signals
  signal_no_trade_chasing:   { id: "signal_no_trade_chasing",   step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE \u2014 CHASING",         summary: "Price is running without a pullback. Do not chase. Wait for a pullback to enter or find another setup." },
  signal_no_trade_weak:      { id: "signal_no_trade_weak",      step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE \u2014 WEAK SIGNAL",     summary: "Insufficient confirmation signals. No valid Phase 1 or Phase 3 trigger. Need at least 2 confluences. Sit on hands." },
  signal_no_trade_reject:    { id: "signal_no_trade_reject",    step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE \u2014 REJECTION",       summary: "Price is rejecting the setup level. The thesis is invalidated. Move on." },
  signal_no_trade_rr:        { id: "signal_no_trade_rr",        step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE \u2014 BAD R:R",         summary: "Risk:reward is below the minimum threshold (1R = D1 ATR). The math doesn't work. Pass." },
  signal_no_trade_chop:      { id: "signal_no_trade_chop",      step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE \u2014 CHOP",            summary: "Price is chopping around POC with no directional conviction. Wait for a break." },
  signal_no_trade_nosetup:   { id: "signal_no_trade_nosetup",   step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE \u2014 NO SETUP",        summary: "No valid playbook applies. ADR (20d TR) not exhausted, no swing level. Flat is a position." },
  signal_no_trade_noconfirm: { id: "signal_no_trade_noconfirm", step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE \u2014 NO CONFIRMATION", summary: "Setup was there but no Phase 1/Phase 3 confirmation. Patience pays. Wait for the candle." },
  signal_no_trade_range:     { id: "signal_no_trade_range",     step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE \u2014 INSIDE VA RANGE", summary: "Range market, opened inside VA (TPO). No edge. Wait for price to reach VA extremes." },
};

// ── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function SignalsPanel() {
  const [currentId, setCurrentId] = useState("start");
  const [history, setHistory] = useState([]);
  const [selectedInstrument, setSelectedInstrument] = useState("ES");

  const node = TREE[currentId];
  const isSignal = node.step === 6;

  const handleAnswer = useCallback((option) => {
    setHistory(h => [...h, { question: node.question, answer: option.label, nodeId: node.id }]);
    setCurrentId(option.next);
  }, [node]);

  const reset = useCallback(() => {
    setCurrentId("start");
    setHistory([]);
  }, []);

  const goBack = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setCurrentId(prev.nodeId);
  }, [history]);

  const activeStep = isSignal ? STEPS.length - 1 : node.step;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      {/* Header */}
      <div style={{ textAlign: "center", paddingBottom: 6, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.14em", color: "#4a9eff", fontFamily: MONO }}>
          MARKET STALKERS \u2014 SIGNALS PANEL
        </div>
        <div style={{ fontSize: 9, color: "#475569", fontFamily: MONO, marginTop: 2 }}>
          Full decision engine \u00b7 PB1 \u00b7 PB2 \u00b7 PB3 \u00b7 PB4
        </div>
      </div>

      {/* Instrument pills */}
      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
        {INSTRUMENTS.map(inst => (
          <button key={inst} onClick={() => setSelectedInstrument(inst)} style={{
            fontSize: 9, fontFamily: MONO, fontWeight: 600, padding: "3px 10px",
            borderRadius: 10, cursor: "pointer", letterSpacing: "0.06em",
            background: selectedInstrument === inst ? "rgba(74,158,255,0.2)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${selectedInstrument === inst ? "rgba(74,158,255,0.4)" : "rgba(255,255,255,0.08)"}`,
            color: selectedInstrument === inst ? "#4a9eff" : "#475569",
          }}>{inst}</button>
        ))}
      </div>

      {/* Session Clock */}
      <SessionClock />

      {/* ATR Calculator */}
      <ATRCalculator />

      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "0 4px" }}>
        {STEPS.map((s, i) => {
          const done = i < activeStep;
          const active = i === activeStep;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8, fontWeight: 700, fontFamily: MONO,
                  background: done ? "rgba(0,212,170,0.2)" : active ? "rgba(74,158,255,0.25)" : "rgba(255,255,255,0.05)",
                  color: done ? "#00d4aa" : active ? "#4a9eff" : "#334155",
                  border: `1px solid ${done ? "rgba(0,212,170,0.3)" : active ? "rgba(74,158,255,0.4)" : "rgba(255,255,255,0.08)"}`,
                }}>
                  {done ? "\u2713" : i + 1}
                </div>
                <span style={{
                  fontSize: 7, marginTop: 2, fontFamily: MONO,
                  color: done ? "#00d4aa" : active ? "#4a9eff" : "#334155",
                  letterSpacing: "0.05em",
                }}>{s}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{
                  height: 1, flex: 1, minWidth: 8,
                  background: done ? "rgba(0,212,170,0.3)" : "rgba(255,255,255,0.06)",
                  marginBottom: 10,
                }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Main content area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minHeight: 0, overflow: "auto" }}>
        {!isSignal ? (
          /* Question Card */
          <div style={{
            background: "rgba(0,0,0,0.3)", border: "1px solid rgba(74,158,255,0.15)",
            borderRadius: 6, padding: 14,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", fontFamily: MONO, marginBottom: 6 }}>
              {node.question}
            </div>
            <div style={{ fontSize: 9, color: "#64748b", fontFamily: MONO, lineHeight: 1.5, marginBottom: 12 }}>
              {node.context}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {node.options.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleAnswer(opt)}
                  style={{
                    background: "rgba(74,158,255,0.08)",
                    border: "1px solid rgba(74,158,255,0.2)",
                    borderRadius: 4, padding: "8px 12px",
                    color: "#e2e8f0", fontSize: 10,
                    fontFamily: MONO,
                    cursor: "pointer", textAlign: "left",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => { e.target.style.background = "rgba(74,158,255,0.18)"; e.target.style.borderColor = "rgba(74,158,255,0.4)"; }}
                  onMouseLeave={e => { e.target.style.background = "rgba(74,158,255,0.08)"; e.target.style.borderColor = "rgba(74,158,255,0.2)"; }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Signal Result Card */
          <div style={{
            background: "rgba(0,0,0,0.4)",
            border: `2px solid ${node.color}`,
            borderRadius: 8, padding: 18, textAlign: "center",
          }}>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 8, fontFamily: MONO, color: "#475569", padding: "1px 6px", background: "rgba(255,255,255,0.05)", borderRadius: 3 }}>{selectedInstrument}</span>
              <span style={{ fontSize: 8, fontFamily: MONO, color: node.color, padding: "1px 6px", background: node.color + "15", borderRadius: 3 }}>SIGNAL</span>
            </div>
            <div style={{
              fontSize: 20, fontWeight: 700, color: node.color,
              fontFamily: MONO, marginBottom: 4,
            }}>
              {node.signal}
            </div>
            <div style={{
              fontSize: 10, fontWeight: 600, color: "#e2e8f0",
              fontFamily: MONO, marginBottom: 10,
              letterSpacing: "0.06em",
            }}>
              {node.label}
            </div>
            <div style={{
              fontSize: 9, color: "#94a3b8", fontFamily: MONO,
              lineHeight: 1.6, textAlign: "left",
              background: "rgba(0,0,0,0.3)", borderRadius: 4, padding: 10,
            }}>
              {node.summary}
            </div>
          </div>
        )}

        {/* History log */}
        {history.length > 0 && (
          <div style={{
            background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: 8,
            border: "1px solid rgba(255,255,255,0.04)",
          }}>
            <div style={{ fontSize: 8, color: "#334155", fontFamily: MONO, letterSpacing: "0.1em", marginBottom: 4 }}>
              DECISION LOG
            </div>
            {history.map((h, i) => (
              <div key={i} style={{
                display: "flex", gap: 6, fontSize: 9,
                fontFamily: MONO,
                padding: "3px 0",
                borderBottom: i < history.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
              }}>
                <span style={{ color: "#334155", minWidth: 14 }}>{i + 1}.</span>
                <span style={{ color: "#475569" }}>{h.question}</span>
                <span style={{ color: "#4a9eff", marginLeft: "auto", whiteSpace: "nowrap" }}>{h.answer}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div style={{
        display: "flex", gap: 8, paddingTop: 8,
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}>
        {history.length > 0 && !isSignal && (
          <button onClick={goBack} style={{
            flex: 1, padding: "6px 0", fontSize: 9,
            fontFamily: MONO,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4, color: "#94a3b8", cursor: "pointer",
          }}>
            \u2190 BACK
          </button>
        )}
        <button onClick={reset} style={{
          flex: 1, padding: "6px 0", fontSize: 9,
          fontFamily: MONO,
          fontWeight: 700, letterSpacing: "0.08em",
          background: isSignal ? `${node.color}22` : "rgba(255,77,109,0.1)",
          border: `1px solid ${isSignal ? node.color + "44" : "rgba(255,77,109,0.2)"}`,
          borderRadius: 4,
          color: isSignal ? node.color : "#ff4d6d",
          cursor: "pointer",
        }}>
          {isSignal ? "\u21BB NEW SIGNAL" : "\u21BB RESET"}
        </button>
      </div>
    </div>
  );
}
