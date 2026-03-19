import { useState, useEffect, useCallback, useMemo, useRef } from "react";

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

// IB windows per instrument (all in ET minutes-since-midnight)
const IB_WINDOWS = {
  ES:  { start: 570, end: 630, label: "IB 9:30-10:30a ET" },
  NQ:  { start: 570, end: 630, label: "IB 9:30-10:30a ET" },
  DAX: { start: 180, end: 240, label: "IB 9-10a CET" },
  XAU: { start: 500, end: 560, label: "IB 8:20-9:20a ET" },
  OIL: { start: 540, end: 600, label: "IB 9-10a ET" },
};

function getSessionStatus(mins, instrument) {
  const ib = IB_WINDOWS[instrument] || IB_WINDOWS.ES;
  const ibActive = mins >= ib.start && mins < ib.end;
  const ibPre = mins < ib.start;
  // DRF: 10:00 EST (600) — amber if within 30min (570–600), green at 600–610
  const drfAt = mins >= 600 && mins < 610;
  const drfNear = mins >= 570 && mins < 600;
  // NY Close: 16:00 EST (960) — amber if within 30min (930–960), green at 960–970
  const closeAt = mins >= 960 && mins < 970;
  const closeNear = mins >= 930 && mins < 960;

  let banner = "";
  let bannerColor = "#334155";
  if (ibActive) { banner = "IB FORMING"; bannerColor = "#00d4aa"; }
  else if (drfAt) { banner = "DRF WINDOW"; bannerColor = "#00d4aa"; }
  else if (drfNear) { banner = "DRF APPROACHING"; bannerColor = "#f6c90e"; }
  else if (closeAt) { banner = "NY CLOSE WINDOW"; bannerColor = "#00d4aa"; }
  else if (closeNear) { banner = "NY CLOSE APPROACHING"; bannerColor = "#f6c90e"; }
  else if (ibPre) { banner = "IB NOT STARTED"; bannerColor = "#475569"; }
  else if (mins >= 970) { banner = "AFTER HOURS"; bannerColor = "#475569"; }
  else if (mins >= ib.end) { banner = "IB SET"; bannerColor = "#94a3b8"; }
  else { banner = "PRE-MARKET"; bannerColor = "#475569"; }

  return { ibActive, ibLabel: ib.label, drfAt, drfNear, closeAt, closeNear, banner, bannerColor };
}

// ── SESSION CLOCK COMPONENT ──────────────────────────────────────────────────
function SessionClock({ instrument = "ES" }) {
  const { ny, mins } = useNYTime();
  const sess = getSessionStatus(mins, instrument);
  const fmt = ny.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

  const dot = (active, near) => active ? "#00d4aa" : near ? "#f6c90e" : "#334155";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "rgba(0,0,0,0.3)", borderRadius: 5, border: "1px solid rgba(255,255,255,0.05)", flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", fontFamily: MONO }}>{fmt}</span>
        <span style={{ fontSize: 8, color: "#475569", fontFamily: MONO }}>ET</span>
      </div>
      <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.08)" }} />
      <div style={{ display: "flex", gap: 8 }}>
        <span style={{ fontSize: 8, fontFamily: MONO, color: dot(sess.ibActive, false) }}>{"\u25CF"} {sess.ibLabel}</span>
        <span style={{ fontSize: 8, fontFamily: MONO, color: dot(sess.drfAt, sess.drfNear) }}>{"\u25CF"} DRF 10a</span>
        <span style={{ fontSize: 8, fontFamily: MONO, color: dot(sess.closeAt, sess.closeNear) }}>{"\u25CF"} CLOSE 4p</span>
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
    context: "Uptrend context. Compare the open to yesterday's VAH / VAL / POC (TPO-based Value Area — time/Market Profile letters). Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL. An open above VA is strongest for continuation. IB varies by instrument: ES/NQ 9:30-10:30 ET, DAX 9-10 CET, Gold 8:20-9:20 ET, Oil 9-10 ET.",
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
    context: "Downtrend context. TPO-based Value Area (time/Market Profile letters). Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL. An open below VA is strongest for short continuation. IB varies by instrument: ES/NQ 9:30-10:30 ET, DAX 9-10 CET, Gold 8:20-9:20 ET, Oil 9-10 ET.",
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
    context: "Range / chop context. TPO-based Value Area (time/Market Profile letters). Conterminous tolerance: within 5-10 ticks / 1-2 points of VAH/VAL. Look for mean-reversion plays back to POC or VA edges. IB varies by instrument: ES/NQ 9:30-10:30 ET, DAX 9-10 CET, Gold 8:20-9:20 ET, Oil 9-10 ET.",
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
    context: "ADR exhausted to the downside (20-day True Range ADR). Phase 1 trigger: Bullish engulf OR consolidation breaking above swing high on M15/M30/H4. Also look for: hammer/doji at support, volume climax + absorption, delta divergence. Countertrend — size down 50%. IB varies by instrument: ES/NQ 9:30-10:30 ET, DAX 9-10 CET, Gold 8:20-9:20 ET, Oil 9-10 ET.",
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
    context: "ADR exhausted to the upside (20-day True Range ADR). Phase 3 trigger: 3-bar reversal pattern (bearish) on M15/M30/H4. Also look for: shooting star at resistance, volume climax + absorption, delta divergence. Countertrend — size down 50%. IB varies by instrument: ES/NQ 9:30-10:30 ET, DAX 9-10 CET, Gold 8:20-9:20 ET, Oil 9-10 ET.",
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

// ── SHARED ───────────────────────────────────────────────────────────────────
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:3001";

const PLAYBOOK_NAMES = {
  PB1: "PLAYBOOK #1 \u2014 WITH THE TREND",
  PB2: "PLAYBOOK #2 \u2014 RETURN TO VA",
  PB3: "PLAYBOOK #3 \u2014 CT ADR EXHAUSTION",
  PB4: "PLAYBOOK #4 \u2014 CT SWING",
  "NO TRADE": "NO TRADE",
};
const SIGNAL_COLORS = { LONG: "#00d4aa", SHORT: "#ff4d6d", "CT LONG": "#f6c90e", "CT SHORT": "#f6c90e", "SWING LONG": "#4a9eff", "SWING SHORT": "#4a9eff", "NO TRADE": "#475569" };
const CONFIDENCE_COLORS = { High: "#00d4aa", Medium: "#f6c90e", Low: "#ff4d6d" };

// ── COLLAPSED FAILED PLAYBOOKS ────────────────────────────────────────────────
function FailedPlaybooks({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={() => setOpen(!open)} style={{
        fontSize: 8, fontFamily: MONO, color: "#334155", background: "none",
        border: "none", cursor: "pointer", padding: 0, letterSpacing: "0.06em",
      }}>{open ? "\u25B2" : "\u25BC"} Other playbooks checked ({items.length})</button>
      {open && (
        <div style={{ marginTop: 4, background: "rgba(0,0,0,0.15)", borderRadius: 3, padding: 6 }}>
          {items.map((f, i) => (
            <div key={i} style={{ fontSize: 8, fontFamily: MONO, padding: "2px 0", borderBottom: i < items.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <span style={{ color: "#475569", fontWeight: 700 }}>{f.playbook}</span>
              <span style={{ color: "#334155" }}> — {f.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AUTO SIGNAL ENGINE ───────────────────────────────────────────────────────
function AutoSignalEngine({ selectedInstrument, onInstrumentChange, onZonesLoaded }) {
  const [result, setResult] = useState(null);
  const [dataUsed, setDataUsed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastFetch, setLastFetch] = useState(null);
  const autoRef = useRef(null);

  const fetchSignal = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/autosignal?symbol=${selectedInstrument}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDataUsed(d.data_used || null);
      // Register H4 zones for alerts
      if (onZonesLoaded && d.data_used) {
        const sup = d.data_used.h4_supply_zones || [];
        const dem = d.data_used.h4_demand_zones || [];
        if (sup.length || dem.length) onZonesLoaded(sup, dem, d.data_used.atr || 0, selectedInstrument);
      }
      if (d.signal) {
        setResult({ ...d.signal, ts: d.ts });
      } else if (d.ai_error) {
        setResult(null);
        setError(`Data fetched but AI failed: ${d.ai_error}`);
        setDataUsed(d.data_used);
      } else {
        throw new Error("No signal in response");
      }
      setLastFetch(new Date());
    } catch (e) { setError(e.message); setResult(null); }
    setLoading(false);
  }, [selectedInstrument]);

  useEffect(() => {
    if (autoRefresh) {
      autoRef.current = setInterval(fetchSignal, 5 * 60 * 1000);
      return () => clearInterval(autoRef.current);
    } else {
      if (autoRef.current) clearInterval(autoRef.current);
    }
  }, [autoRefresh, fetchSignal]);

  const sigColor = result ? (SIGNAL_COLORS[result.signal] || "#475569") : "#475569";
  const confColor = result?.confidence ? (CONFIDENCE_COLORS[result.confidence] || "#475569") : "#475569";

  // Time ago
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 30000); return () => clearInterval(t); }, []);
  const timeAgo = lastFetch ? (() => {
    const diff = Math.floor((Date.now() - lastFetch.getTime()) / 60000);
    return diff < 1 ? "just now" : `${diff}m ago`;
  })() : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Instrument selector */}
      <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
        {INSTRUMENTS.map(inst => (
          <button key={inst} onClick={() => onInstrumentChange(inst)} style={{
            fontSize: 9, fontFamily: MONO, fontWeight: 600, padding: "3px 10px",
            borderRadius: 10, cursor: "pointer", letterSpacing: "0.06em",
            background: selectedInstrument === inst ? "rgba(74,158,255,0.2)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${selectedInstrument === inst ? "rgba(74,158,255,0.4)" : "rgba(255,255,255,0.08)"}`,
            color: selectedInstrument === inst ? "#4a9eff" : "#475569",
          }}>{inst}</button>
        ))}
      </div>

      {/* GET SIGNAL button + auto-refresh */}
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={fetchSignal} disabled={loading} style={{
          flex: 1, padding: "10px 0", fontSize: 12, fontWeight: 700,
          fontFamily: MONO, letterSpacing: "0.12em",
          background: loading ? "rgba(74,158,255,0.05)" : "rgba(74,158,255,0.15)",
          border: "1px solid rgba(74,158,255,0.35)", borderRadius: 5,
          color: "#4a9eff", cursor: loading ? "default" : "pointer",
        }}>
          {loading ? "\u23F3 FETCHING DATA..." : "\u26A1 GET SIGNAL"}
        </button>
        <button onClick={() => setAutoRefresh(!autoRefresh)} style={{
          padding: "10px 14px", fontSize: 8, fontWeight: 700,
          fontFamily: MONO, letterSpacing: "0.06em", borderRadius: 5, cursor: "pointer",
          background: autoRefresh ? "rgba(0,212,170,0.12)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${autoRefresh ? "rgba(0,212,170,0.3)" : "rgba(255,255,255,0.08)"}`,
          color: autoRefresh ? "#00d4aa" : "#475569",
        }}>{autoRefresh ? "\u25CF AUTO 5m" : "AUTO"}</button>
      </div>

      {/* Last updated */}
      {timeAgo && (
        <div style={{ fontSize: 7, color: "#334155", fontFamily: MONO, textAlign: "center" }}>
          Last updated: {timeAgo} {autoRefresh && "\u00b7 auto-refresh ON"}
        </div>
      )}

      {/* Data verification pills */}
      {dataUsed && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "center" }}>
          {[
            ["VAH", dataUsed.vah], ["VAL", dataUsed.val], ["POC", dataUsed.poc],
            ["ATR", dataUsed.atr], ["ADR", dataUsed.adr],
            ["IB Hi", dataUsed.ib_high], ["IB Lo", dataUsed.ib_low], ["IB", dataUsed.ib_status || dataUsed.ib_window],
            ["H4 QP", dataUsed.h4_qp],
            ["Dem\u2194VAH", dataUsed.h4_demand_conterminous ? "\u2713 CTM" : dataUsed.h4_demand_distance_from_vah != null ? `${dataUsed.h4_demand_distance_from_vah}pt` : null],
            ["Sup\u2194VAL", dataUsed.h4_supply_conterminous ? "\u2713 CTM" : dataUsed.h4_supply_distance_from_val != null ? `${dataUsed.h4_supply_distance_from_val}pt` : null],
            ["Trend", dataUsed.trend], ["Pattern", dataUsed.m30_pattern],
            ["Session", dataUsed.session],
          ].map(([k, v]) => (
            <span key={k} style={{
              fontSize: 7, fontFamily: MONO, padding: "2px 5px", borderRadius: 3,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
              color: v && v !== 0 && v !== "None" && v !== "NONE" && v !== "NEUTRAL" ? "#64748b" : "#1e293b",
            }}>{k}: {v ?? "—"}</span>
          ))}
        </div>
      )}

      {/* H4 Supply/Demand zones */}
      {dataUsed && (dataUsed.h4_supply_zones?.length > 0 || dataUsed.h4_demand_zones?.length > 0) && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center" }}>
          {(dataUsed.h4_supply_zones || []).map((z, i) => (
            <span key={`s${i}`} style={{ fontSize: 7, fontFamily: MONO, padding: "2px 6px", borderRadius: 3,
              background: "rgba(255,77,109,0.08)", border: "1px solid rgba(255,77,109,0.15)", color: "#ff4d6d" }}>
              Supply: {z.price_low}–{z.price_high}
            </span>
          ))}
          {(dataUsed.h4_demand_zones || []).map((z, i) => (
            <span key={`d${i}`} style={{ fontSize: 7, fontFamily: MONO, padding: "2px 6px", borderRadius: 3,
              background: "rgba(0,212,170,0.08)", border: "1px solid rgba(0,212,170,0.15)", color: "#00d4aa" }}>
              Demand: {z.price_low}–{z.price_high}
            </span>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          fontSize: 9, fontFamily: MONO, padding: "8px 10px", borderRadius: 4,
          background: "rgba(255,77,109,0.08)", border: "1px solid rgba(255,77,109,0.15)", color: "#ff4d6d",
        }}>
          {error.includes("Data unavailable") ? `Data unavailable for ${selectedInstrument}` :
           error.includes("market") || error.includes("After") ? "Market closed \u2014 showing last session data" :
           `ERROR: ${error}`}
        </div>
      )}

      {/* Signal Result */}
      {result && (
        <div style={{ background: "rgba(0,0,0,0.4)", border: `2px solid ${sigColor}`, borderRadius: 8, padding: 16 }}>
          {/* Countertrend close banner */}
          {result.countertrend_close_rule && (
            <div style={{ background: "rgba(255,77,109,0.12)", border: "1px solid rgba(255,77,109,0.3)", borderRadius: 4, padding: "5px 8px", marginBottom: 8, textAlign: "center", fontSize: 9, fontWeight: 700, fontFamily: MONO, color: "#ff4d6d", letterSpacing: "0.06em" }}>
              {"\u26A0"} CLOSE AT END OF SESSION — Countertrend rule
            </div>
          )}

          {/* Time context bar */}
          {result.time_context && (
            <div style={{ fontSize: 8, fontFamily: MONO, color: "#64748b", textAlign: "center", marginBottom: 8, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              {result.time_context}
            </div>
          )}

          {/* Top badges */}
          <div style={{ textAlign: "center", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "center", gap: 5, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 8, fontFamily: MONO, color: "#475569", padding: "1px 6px", background: "rgba(255,255,255,0.05)", borderRadius: 3 }}>{selectedInstrument}</span>
              {result.direction && result.direction !== "None" && (
                <span style={{ fontSize: 8, fontFamily: MONO, color: sigColor, padding: "1px 6px", background: sigColor + "15", borderRadius: 3 }}>{result.direction}</span>
              )}
              {result.target_r && result.target_r !== "None" && (
                <span style={{ fontSize: 8, fontFamily: MONO, color: "#00d4aa", padding: "1px 6px", background: "rgba(0,212,170,0.1)", borderRadius: 3 }}>{result.target_r}</span>
              )}
              {result.ib_status && (
                <span style={{ fontSize: 8, fontFamily: MONO, padding: "1px 6px", borderRadius: 3, fontWeight: 700,
                  color: result.ib_status === "set" ? "#00d4aa" : result.ib_status === "forming" ? "#f6c90e" : "#475569",
                  background: (result.ib_status === "set" ? "#00d4aa" : result.ib_status === "forming" ? "#f6c90e" : "#475569") + "15",
                }}>IB {result.ib_status.toUpperCase()}</span>
              )}
              {result.confidence && (
                <span style={{ fontSize: 8, fontFamily: MONO, color: confColor, padding: "1px 6px", background: confColor + "12", borderRadius: 3, fontWeight: 700 }}>{result.confidence}</span>
              )}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: sigColor, fontFamily: MONO, marginBottom: 2 }}>{result.signal}</div>
            <div style={{ fontSize: 9, fontWeight: 600, color: "#94a3b8", fontFamily: MONO, letterSpacing: "0.08em" }}>
              {PLAYBOOK_NAMES[result.playbook_selected || result.playbook] || result.playbook_selected || result.playbook}
            </div>
            {result.playbook_path && (
              <div style={{ fontSize: 8, color: "#475569", fontFamily: MONO, marginTop: 2 }}>{result.playbook_path}</div>
            )}
            {result.reason_selected && (
              <div style={{ fontSize: 8, color: "#64748b", fontFamily: MONO, marginTop: 4 }}>{result.reason_selected}</div>
            )}
          </div>

          {/* Warnings */}
          {result.warnings && result.warnings.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 8 }}>
              {result.warnings.map((w, i) => (
                <div key={i} style={{ fontSize: 8, fontFamily: MONO, color: "#f6c90e", padding: "3px 8px", background: "rgba(246,201,14,0.08)", border: "1px solid rgba(246,201,14,0.15)", borderRadius: 3 }}>
                  {"\u26A0"} {w}
                </div>
              ))}
            </div>
          )}

          {/* Conterminous used */}
          {result.conterminous_used && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "center", marginBottom: 6 }}>
              <span style={{ fontSize: 7, fontFamily: MONO, padding: "2px 5px", borderRadius: 3,
                background: result.conterminous_used.demand_conterminous ? "rgba(0,212,170,0.1)" : "rgba(255,77,109,0.08)",
                color: result.conterminous_used.demand_conterminous ? "#00d4aa" : "#ff4d6d",
                border: `1px solid ${result.conterminous_used.demand_conterminous ? "rgba(0,212,170,0.2)" : "rgba(255,77,109,0.15)"}`,
              }}>{result.conterminous_used.demand_conterminous ? "\u2713" : "\u2717"} Dem\u2194VAH {result.conterminous_used.demand_level ? `@ ${result.conterminous_used.demand_level}` : ""}</span>
              <span style={{ fontSize: 7, fontFamily: MONO, padding: "2px 5px", borderRadius: 3,
                background: result.conterminous_used.supply_conterminous ? "rgba(0,212,170,0.1)" : "rgba(255,77,109,0.08)",
                color: result.conterminous_used.supply_conterminous ? "#00d4aa" : "#ff4d6d",
                border: `1px solid ${result.conterminous_used.supply_conterminous ? "rgba(0,212,170,0.2)" : "rgba(255,77,109,0.15)"}`,
              }}>{result.conterminous_used.supply_conterminous ? "\u2713" : "\u2717"} Sup\u2194VAL {result.conterminous_used.supply_level ? `@ ${result.conterminous_used.supply_level}` : ""}</span>
            </div>
          )}

          {/* R target prices */}
          {result.stop && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "center", marginBottom: 10 }}>
              <LevelPill label="STOP" value={Number(result.stop).toFixed(2)} color="#ff4d6d" />
              {result.target_1r && <LevelPill label="1R" value={Number(result.target_1r).toFixed(2)} color="#f6c90e" />}
              {result.target_2r && <LevelPill label="2R" value={Number(result.target_2r).toFixed(2)} color="#00d4aa" />}
              {result.target_3r && <LevelPill label="3R" value={Number(result.target_3r).toFixed(2)} color="#4a9eff" />}
            </div>
          )}

          {/* Criteria checklist */}
          {result.criteria && result.criteria.length > 0 && (
            <div style={{ marginBottom: 10, background: "rgba(0,0,0,0.25)", borderRadius: 4, padding: 8 }}>
              <div style={{ fontSize: 8, color: "#334155", fontFamily: MONO, letterSpacing: "0.1em", marginBottom: 4 }}>CRITERIA — {result.playbook_selected || result.playbook}</div>
              {result.criteria.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 9, fontFamily: MONO, padding: "3px 0", borderBottom: i < result.criteria.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
                  <span style={{ color: c.met ? "#00d4aa" : "#ff4d6d", fontSize: 10, minWidth: 14, flexShrink: 0 }}>{c.met ? "\u2713" : "\u2717"}</span>
                  <div style={{ flex: 1 }}>
                    <span style={{ color: c.met ? "#94a3b8" : "#64748b" }}>{c.condition}</span>
                    {c.note && <div style={{ fontSize: 7, color: "#334155", marginTop: 1 }}>{c.note}</div>}
                  </div>
                  {c.playbook && c.playbook !== (result.playbook_selected || result.playbook) && (
                    <span style={{ fontSize: 7, color: "#334155", fontFamily: MONO }}>{c.playbook}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Reasoning */}
          {result.reasoning && (
            <div style={{ fontSize: 9, color: "#64748b", fontFamily: MONO, lineHeight: 1.6, background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: 8 }}>
              {result.reasoning}
            </div>
          )}

          {/* Failed playbooks (collapsed) */}
          {result.failed_playbooks && result.failed_playbooks.length > 0 && (
            <FailedPlaybooks items={result.failed_playbooks} />
          )}

          {/* Timestamp */}
          {result.ts && (
            <div style={{ fontSize: 7, color: "#1e293b", fontFamily: MONO, marginTop: 6, textAlign: "right" }}>
              {new Date(result.ts).toLocaleTimeString()} ET {timeAgo && `\u00b7 ${timeAgo}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── CHART SCREENSHOT ANALYSER ─────────────────────────────────────────────────
function ChartAnalyser({ onAutoFill }) {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [instrument, setInstrument] = useState("ES");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setImage(e.target.result);
      setPreview(e.target.result);
      setResult(null); setError(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const analyse = useCallback(async () => {
    if (!image) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/analyse-chart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, instrument }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (d.success && d.analysis) {
        setResult(d.analysis);
      } else throw new Error("Invalid response");
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [image, instrument]);

  const doAutoFill = useCallback(() => {
    if (!result || !onAutoFill) return;
    onAutoFill(result);
  }, [result, onAutoFill]);

  const inputStyle = { background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3, padding: "4px 6px", color: "#e2e8f0", fontSize: 10, fontFamily: MONO, outline: "none" };

  const levelRow = (label, value, conf) => (
    <div key={label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9, fontFamily: MONO, padding: "2px 0", borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
      <span style={{ color: value != null ? (conf === "high" ? "#00d4aa" : "#f6c90e") : "#334155", fontSize: 10, minWidth: 12 }}>
        {value != null ? (conf === "high" ? "\u2713" : "\u25CB") : "\u2014"}
      </span>
      <span style={{ color: "#64748b", minWidth: 60 }}>{label}</span>
      <span style={{ color: value != null ? "#e2e8f0" : "#334155", marginLeft: "auto" }}>
        {value != null ? (typeof value === "number" ? value.toFixed(2) : value) : "not detected"}
      </span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#4a9eff", fontFamily: MONO, letterSpacing: "0.1em" }}>
          CHART SCREENSHOT ANALYSER
        </div>
        <span style={{ fontSize: 7, color: "#334155", fontFamily: MONO }}>VISION AI</span>
      </div>

      {/* Drop zone / Upload */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "rgba(74,158,255,0.5)" : "rgba(255,255,255,0.1)"}`,
          borderRadius: 6, padding: preview ? 6 : 20,
          textAlign: "center", cursor: "pointer",
          background: dragOver ? "rgba(74,158,255,0.05)" : "rgba(0,0,0,0.2)",
          transition: "all 0.15s",
        }}
      >
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }}
          onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
        {preview ? (
          <img src={preview} alt="Chart" style={{ maxWidth: "100%", maxHeight: 160, borderRadius: 4, opacity: 0.9 }} />
        ) : (
          <>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{"\uD83D\uDCF7"}</div>
            <div style={{ fontSize: 10, color: "#64748b", fontFamily: MONO }}>Drop chart screenshot here or click to upload</div>
            <div style={{ fontSize: 8, color: "#334155", fontFamily: MONO, marginTop: 4 }}>PNG, JPG, WEBP</div>
          </>
        )}
      </div>

      {/* Instrument + Analyse */}
      {image && (
        <div style={{ display: "flex", gap: 6 }}>
          <select value={instrument} onChange={e => setInstrument(e.target.value)}
            style={{ ...inputStyle, cursor: "pointer", width: 80 }}>
            {INSTRUMENTS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
          <button onClick={analyse} disabled={loading} style={{
            flex: 1, padding: "8px 0", fontSize: 10, fontWeight: 700,
            fontFamily: MONO, letterSpacing: "0.08em",
            background: loading ? "rgba(74,158,255,0.05)" : "rgba(74,158,255,0.15)",
            border: "1px solid rgba(74,158,255,0.3)", borderRadius: 4,
            color: "#4a9eff", cursor: loading ? "default" : "pointer",
          }}>{loading ? "ANALYSING CHART..." : "\uD83D\uDD0D ANALYSE CHART"}</button>
        </div>
      )}

      {error && (
        <div style={{ fontSize: 9, color: "#ff4d6d", fontFamily: MONO, padding: "6px 8px", background: "rgba(255,77,109,0.1)", borderRadius: 4 }}>
          ERROR: {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(74,158,255,0.15)", borderRadius: 6, padding: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", fontFamily: MONO, letterSpacing: "0.1em", marginBottom: 6 }}>
            LEVELS DETECTED
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            <div>
              {levelRow("Price", result.current_price, result.confidence)}
              {levelRow("VAH", result.vah, result.confidence)}
              {levelRow("VAL", result.val, result.confidence)}
              {levelRow("POC", result.poc, result.confidence)}
              {levelRow("IB High", result.ib_high, result.confidence)}
              {levelRow("IB Low", result.ib_low, result.confidence)}
              {levelRow("Trend", result.trend, result.confidence)}
            </div>
            <div>
              {levelRow("D1 QP", result.d1_qp, "medium")}
              {levelRow("D1 QHi", result.d1_qhi, "medium")}
              {levelRow("D1 QLo", result.d1_qlo, "medium")}
              {levelRow("H4 QP", result.h4_qp, "medium")}
              {levelRow("Pattern", result.m30_pattern, result.confidence)}
              {levelRow("VA Open", result.va_open, result.confidence)}
              {levelRow("ADR Exh.", result.adr_exhausted === true ? "Yes" : result.adr_exhausted === false ? "No" : null, result.confidence)}
            </div>
          </div>

          {/* Notes */}
          {result.notes && (
            <div style={{ fontSize: 8, color: "#64748b", fontFamily: MONO, lineHeight: 1.5, marginTop: 8, padding: "6px 8px", background: "rgba(0,0,0,0.2)", borderRadius: 3 }}>
              {result.notes}
            </div>
          )}

          {/* Confidence badge */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span style={{
              fontSize: 8, fontFamily: MONO, fontWeight: 700, padding: "2px 8px", borderRadius: 3,
              color: result.confidence === "high" ? "#00d4aa" : result.confidence === "medium" ? "#f6c90e" : "#ff4d6d",
              background: (result.confidence === "high" ? "#00d4aa" : result.confidence === "medium" ? "#f6c90e" : "#ff4d6d") + "15",
            }}>{(result.confidence || "").toUpperCase()} CONFIDENCE</span>

            {onAutoFill && (
              <button onClick={doAutoFill} style={{
                flex: 1, padding: "5px 0", fontSize: 9, fontWeight: 700,
                fontFamily: MONO, letterSpacing: "0.06em",
                background: "rgba(0,212,170,0.12)", border: "1px solid rgba(0,212,170,0.3)",
                borderRadius: 4, color: "#00d4aa", cursor: "pointer",
              }}>AUTO-FILL AI ANALYSER \u2192</button>
            )}
          </div>
        </div>
      )}

      {/* Supported platforms */}
      <div style={{ fontSize: 7, color: "#1e293b", fontFamily: MONO, textAlign: "center" }}>
        Works with TradingView, Deepcharts, Sierra Chart, NinjaTrader, ThinkOrSwim, or any charting platform
      </div>
    </div>
  );
}

// ── AI SIGNAL ANALYSER (manual input) ─────────────────────────────────────────
function AISignalAnalyser({ chartData, onZonesLoaded }) {
  const [form, setForm] = useState({
    instrument: "ES", currentPrice: "", atr: "",
    vah: "", val: "",
    d1QP: "", d1QHi: "", d1QMid: "", d1QLo: "",
    h4QP: "", h4QHi: "", h4QMid: "", h4QLo: "",
    ibHigh: "", ibLow: "",
    trend: "UP", vaOpen: "Above VAH",
    m30Pattern: "None", adrExhausted: false,
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fetchingATR, setFetchingATR] = useState(false);
  const [qpLoading, setQpLoading] = useState(false);
  const [qpMsg, setQpMsg] = useState(null); // { type: "success"|"warning"|"error", text }
  const [vaLoading, setVaLoading] = useState(false);
  const [vaMsg, setVaMsg] = useState(null);
  const [h4SupplyZones, setH4SupplyZones] = useState([]);
  const [h4DemandZones, setH4DemandZones] = useState([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [zonesMsg, setZonesMsg] = useState(null);

  const calcQP = useCallback(async () => {
    setQpLoading(true); setQpMsg(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/qp-calculate?instrument=${form.instrument}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      const f = d.fields;
      if (f) {
        setForm(prev => ({
          ...prev,
          d1QP: String(f.d1QP), d1QHi: String(f.d1QHi), d1QMid: String(f.d1QMid), d1QLo: String(f.d1QLo),
          h4QP: String(f.h4QP), h4QHi: String(f.h4QHi), h4QMid: String(f.h4QMid), h4QLo: String(f.h4QLo),
        }));
      }
      if (d.valid) {
        setQpMsg({ type: "success", text: `${d.direction} QP confirmed \u00b7 ${d.swingHighTime} \u2192 ${d.swingLowTime}` });
      } else {
        setQpMsg({ type: "warning", text: d.reason || "50% not yet triggered \u2014 pending levels shown" });
      }
    } catch (e) { setQpMsg({ type: "error", text: e.message }); }
    setQpLoading(false);
  }, [form.instrument]);

  const calcVA = useCallback(async () => {
    setVaLoading(true); setVaMsg(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/tpo?instrument=${form.instrument}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      if (!d.success) throw new Error(d.reason || "No RTH data");
      const f = d.fields;
      if (f) {
        setForm(prev => ({
          ...prev,
          vah: String(f.vah),
          val: String(f.val),
          vaOpen: f.vaOpen || prev.vaOpen,
        }));
      }
      setVaMsg({ type: "success", text: `VAH ${d.vah} \u00b7 POC ${d.poc} \u00b7 VAL ${d.val} \u00b7 ${d.rthBarsUsed} bars` });
    } catch (e) { setVaMsg({ type: "error", text: e.message }); }
    setVaLoading(false);
  }, [form.instrument]);

  const YAHOO_MAP = { ES: "ES=F", NQ: "NQ=F", DAX: "^GDAXI", XAU: "GC=F", OIL: "CL=F" };
  const fetchZones = useCallback(async () => {
    setZonesLoading(true); setZonesMsg(null);
    try {
      const cp = parseFloat(form.currentPrice) || 0;
      const sym = YAHOO_MAP[form.instrument] || "ES=F";
      const r = await fetch(`${BACKEND_URL}/api/h4-zones?symbol=${encodeURIComponent(sym)}&current_price=${cp}&instrument=${form.instrument}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Failed");
      const sup = d.supply || [], dem = d.demand || [];
      setH4SupplyZones(sup);
      setH4DemandZones(dem);
      const sc = sup.length, dc = dem.length;
      setZonesMsg(sc || dc
        ? { type: "success", text: `${sc} supply \u00b7 ${dc} demand zones \u00b7 alerts active` }
        : { type: "warning", text: "No zones detected near current price" });
      // Register zones for price alerts
      if (onZonesLoaded && (sc || dc)) onZonesLoaded(sup, dem, d.atr_h4 || 0, form.instrument);
    } catch (e) { setZonesMsg({ type: "error", text: e.message }); }
    setZonesLoading(false);
  }, [form.instrument, form.currentPrice]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Auto-fill from chart analysis
  useEffect(() => {
    if (!chartData) return;
    const d = chartData;
    setForm(f => ({
      ...f,
      instrument: d.instrument || f.instrument,
      currentPrice: d.current_price != null ? String(d.current_price) : f.currentPrice,
      vah: d.vah != null ? String(d.vah) : f.vah,
      val: d.val != null ? String(d.val) : f.val,
      d1QP: d.d1_qp != null ? String(d.d1_qp) : f.d1QP,
      d1QHi: d.d1_qhi != null ? String(d.d1_qhi) : f.d1QHi,
      d1QMid: d.d1_qmid != null ? String(d.d1_qmid) : f.d1QMid,
      d1QLo: d.d1_qlo != null ? String(d.d1_qlo) : f.d1QLo,
      h4QP: d.h4_qp != null ? String(d.h4_qp) : f.h4QP,
      h4QHi: d.h4_qhi != null ? String(d.h4_qhi) : f.h4QHi,
      h4QMid: d.h4_qmid != null ? String(d.h4_qmid) : f.h4QMid,
      h4QLo: d.h4_qlo != null ? String(d.h4_qlo) : f.h4QLo,
      ibHigh: d.ib_high != null ? String(d.ib_high) : f.ibHigh,
      ibLow: d.ib_low != null ? String(d.ib_low) : f.ibLow,
      trend: d.trend || f.trend,
      vaOpen: d.va_open || f.vaOpen,
      m30Pattern: d.m30_pattern || f.m30Pattern,
      adrExhausted: d.adr_exhausted != null ? d.adr_exhausted : f.adrExhausted,
    }));
  }, [chartData]);

  const fetchATR = useCallback(async () => {
    setFetchingATR(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/market`);
      const d = await r.json();
      if (d.success && d.data) {
        const sym = form.instrument === "XAU" ? "GLD" : form.instrument === "OIL" ? "USO" : form.instrument;
        // Try to get price from ES/NQ futures or ETFs
        if (sym === "ES" && d.data.es) {
          set("currentPrice", String(d.data.es.price));
        } else if (sym === "NQ" && d.data.nq) {
          set("currentPrice", String(d.data.nq.price));
        } else {
          const etf = (d.data.etfs || []).find(e => e.sym === sym);
          if (etf && etf.price) set("currentPrice", String(etf.price));
        }
      }
    } catch (e) { console.warn("Fetch ATR failed:", e.message); }
    setFetchingATR(false);
  }, [form.instrument]);

  const analyse = useCallback(async () => {
    if (!form.currentPrice) { setError("Current price is required"); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      if (d.success && d.signal) {
        setResult({ ...d.signal, ts: d.ts });
      } else {
        throw new Error("Invalid response from AI");
      }
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [form]);

  const inputStyle = {
    background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 3, padding: "4px 6px", color: "#e2e8f0", fontSize: 10,
    fontFamily: MONO, outline: "none", width: "100%",
  };
  const labelStyle = { fontSize: 7, color: "#475569", fontFamily: MONO, letterSpacing: "0.06em", marginBottom: 1 };
  const sectionStyle = { fontSize: 8, fontWeight: 700, color: "#334155", fontFamily: MONO, letterSpacing: "0.1em", marginTop: 6, marginBottom: 4 };

  const sigColor = result ? (SIGNAL_COLORS[result.signal] || "#475569") : "#475569";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#4a9eff", fontFamily: MONO, letterSpacing: "0.1em" }}>
          AI SIGNAL ANALYSER
        </div>
        <span style={{ fontSize: 7, color: "#334155", fontFamily: MONO }}>POWERED BY CLAUDE</span>
      </div>

      {/* Instrument + Price + ATR row */}
      <div style={{ display: "grid", gridTemplateColumns: "0.8fr 1fr 1fr 0.7fr", gap: 6 }}>
        <div>
          <div style={labelStyle}>INSTRUMENT</div>
          <select value={form.instrument} onChange={e => set("instrument", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            {INSTRUMENTS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
        <div>
          <div style={labelStyle}>CURRENT PRICE</div>
          <input style={inputStyle} placeholder="e.g. 5420" value={form.currentPrice} onChange={e => set("currentPrice", e.target.value)} />
        </div>
        <div>
          <div style={labelStyle}>D1 ATR (14p/20d)</div>
          <input style={inputStyle} placeholder="e.g. 45.5" value={form.atr} onChange={e => set("atr", e.target.value)} />
        </div>
        <div>
          <div style={labelStyle}>&nbsp;</div>
          <button onClick={fetchATR} disabled={fetchingATR} style={{
            ...inputStyle, cursor: "pointer", textAlign: "center",
            background: "rgba(74,158,255,0.1)", border: "1px solid rgba(74,158,255,0.25)",
            color: "#4a9eff", fontWeight: 600,
          }}>{fetchingATR ? "..." : "FETCH"}</button>
        </div>
      </div>

      {/* VA */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={sectionStyle}>VALUE AREA (TPO)</div>
        <button onClick={calcVA} disabled={vaLoading} style={{
          fontSize: 7, fontFamily: MONO, fontWeight: 700, color: "#4a9eff",
          background: "rgba(74,158,255,0.08)", border: "1px solid rgba(74,158,255,0.2)",
          borderRadius: 3, padding: "2px 8px", cursor: vaLoading ? "default" : "pointer",
          letterSpacing: "0.06em",
        }}>{vaLoading ? "..." : "CALC VA"}</button>
      </div>
      {vaMsg && (
        <div style={{
          fontSize: 8, fontFamily: MONO, padding: "3px 6px", borderRadius: 3, marginBottom: 2,
          color: vaMsg.type === "success" ? "#00d4aa" : "#ff4d6d",
          background: (vaMsg.type === "success" ? "#00d4aa" : "#ff4d6d") + "10",
        }}>{vaMsg.text}</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <div><div style={labelStyle}>VAH</div><input style={inputStyle} placeholder="VAH" value={form.vah} onChange={e => set("vah", e.target.value)} /></div>
        <div><div style={labelStyle}>VAL</div><input style={inputStyle} placeholder="VAL" value={form.val} onChange={e => set("val", e.target.value)} /></div>
      </div>

      {/* Quarterly Pivots */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={sectionStyle}>D1 QUARTERLY PIVOTS</div>
        <button onClick={calcQP} disabled={qpLoading} style={{
          fontSize: 7, fontFamily: MONO, fontWeight: 700, color: "#4a9eff",
          background: "rgba(74,158,255,0.08)", border: "1px solid rgba(74,158,255,0.2)",
          borderRadius: 3, padding: "2px 8px", cursor: qpLoading ? "default" : "pointer",
          letterSpacing: "0.06em",
        }}>{qpLoading ? "..." : "CALC QP"}</button>
      </div>
      {qpMsg && (
        <div style={{
          fontSize: 8, fontFamily: MONO, padding: "3px 6px", borderRadius: 3, marginBottom: 2,
          color: qpMsg.type === "success" ? "#00d4aa" : qpMsg.type === "warning" ? "#f6c90e" : "#ff4d6d",
          background: (qpMsg.type === "success" ? "#00d4aa" : qpMsg.type === "warning" ? "#f6c90e" : "#ff4d6d") + "10",
        }}>{qpMsg.text}</div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
        <div><div style={labelStyle}>QHi</div><input style={inputStyle} value={form.d1QHi} onChange={e => set("d1QHi", e.target.value)} /></div>
        <div><div style={labelStyle}>QP (Mid)</div><input style={inputStyle} value={form.d1QP} onChange={e => set("d1QP", e.target.value)} /></div>
        <div><div style={labelStyle}>QMid (25%)</div><input style={inputStyle} value={form.d1QMid} onChange={e => set("d1QMid", e.target.value)} /></div>
        <div><div style={labelStyle}>QLo</div><input style={inputStyle} value={form.d1QLo} onChange={e => set("d1QLo", e.target.value)} /></div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={sectionStyle}>H4 QUARTERLY PIVOTS</div>
        <button onClick={() => { set("h4QP", form.d1QP); set("h4QHi", form.d1QHi); set("h4QMid", form.d1QMid); set("h4QLo", form.d1QLo); }}
          style={{ fontSize: 7, fontFamily: MONO, color: "#4a9eff", background: "none", border: "1px solid rgba(74,158,255,0.2)", borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>
          COPY D1 \u2192 H4
        </button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6 }}>
        <div><div style={labelStyle}>QP</div><input style={inputStyle} value={form.h4QP} onChange={e => set("h4QP", e.target.value)} /></div>
        <div><div style={labelStyle}>QHi</div><input style={inputStyle} value={form.h4QHi} onChange={e => set("h4QHi", e.target.value)} /></div>
        <div><div style={labelStyle}>QMid</div><input style={inputStyle} value={form.h4QMid} onChange={e => set("h4QMid", e.target.value)} /></div>
        <div><div style={labelStyle}>QLo</div><input style={inputStyle} value={form.h4QLo} onChange={e => set("h4QLo", e.target.value)} /></div>
      </div>

      {/* Conterminous check */}
      {form.vah && form.val && (form.h4QP || form.h4QHi || form.h4QMid || form.h4QLo) && (() => {
        const TV = { ES: 0.25, NQ: 0.25, DAX: 1.0, XAU: 0.1, OIL: 0.01 };
        const tv = TV[form.instrument] || 0.25;
        const tol = 10 * tv;
        const vah = parseFloat(form.vah), val = parseFloat(form.val);
        const h4s = [form.h4QP, form.h4QHi, form.h4QMid, form.h4QLo, form.h4SupplyNearest, form.h4DemandNearest].filter(Boolean).map(Number);
        const nearVAH = h4s.reduce((b, l) => { const d = Math.abs(l - vah); return (!b || d < b.d) ? { l, d } : b; }, null);
        const nearVAL = h4s.reduce((b, l) => { const d = Math.abs(l - val); return (!b || d < b.d) ? { l, d } : b; }, null);
        return (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {nearVAH && (
              <span style={{ fontSize: 7, fontFamily: MONO, padding: "2px 6px", borderRadius: 3,
                background: nearVAH.d <= tol ? "rgba(0,212,170,0.1)" : "rgba(255,77,109,0.08)",
                color: nearVAH.d <= tol ? "#00d4aa" : "#ff4d6d",
                border: `1px solid ${nearVAH.d <= tol ? "rgba(0,212,170,0.2)" : "rgba(255,77,109,0.15)"}`,
              }}>{nearVAH.d <= tol ? "\u2713" : "\u2717"} Dem\u2194VAH: {nearVAH.d.toFixed(2)}pt (tol: {tol})</span>
            )}
            {nearVAL && (
              <span style={{ fontSize: 7, fontFamily: MONO, padding: "2px 6px", borderRadius: 3,
                background: nearVAL.d <= tol ? "rgba(0,212,170,0.1)" : "rgba(255,77,109,0.08)",
                color: nearVAL.d <= tol ? "#00d4aa" : "#ff4d6d",
                border: `1px solid ${nearVAL.d <= tol ? "rgba(0,212,170,0.2)" : "rgba(255,77,109,0.15)"}`,
              }}>{nearVAL.d <= tol ? "\u2713" : "\u2717"} Sup\u2194VAL: {nearVAL.d.toFixed(2)}pt (tol: {tol})</span>
            )}
          </div>
        );
      })()}

      {/* H4 Supply/Demand Zones */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={sectionStyle}>H4 SUPPLY / DEMAND ZONES</div>
        <button onClick={fetchZones} disabled={zonesLoading} style={{
          fontSize: 7, fontFamily: MONO, fontWeight: 700, color: "#4a9eff",
          background: "rgba(74,158,255,0.08)", border: "1px solid rgba(74,158,255,0.2)",
          borderRadius: 3, padding: "2px 8px", cursor: zonesLoading ? "default" : "pointer",
          letterSpacing: "0.06em",
        }}>{zonesLoading ? "..." : "FETCH ZONES"}</button>
      </div>
      {zonesMsg && (
        <div style={{
          fontSize: 8, fontFamily: MONO, padding: "3px 6px", borderRadius: 3, marginBottom: 2,
          color: zonesMsg.type === "success" ? "#00d4aa" : zonesMsg.type === "warning" ? "#f6c90e" : "#ff4d6d",
          background: (zonesMsg.type === "success" ? "#00d4aa" : zonesMsg.type === "warning" ? "#f6c90e" : "#ff4d6d") + "10",
        }}>{zonesMsg.text}</div>
      )}
      {(h4SupplyZones.length > 0 || h4DemandZones.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
          {h4SupplyZones.map((z, i) => (
            <span key={`s${i}`} style={{ fontSize: 7, fontFamily: MONO, padding: "2px 6px", borderRadius: 3,
              background: "rgba(255,77,109,0.08)", border: "1px solid rgba(255,77,109,0.15)", color: "#ff4d6d",
            }}>Supply: {z.price_low}\u2013{z.price_high}</span>
          ))}
          {h4DemandZones.map((z, i) => (
            <span key={`d${i}`} style={{ fontSize: 7, fontFamily: MONO, padding: "2px 6px", borderRadius: 3,
              background: "rgba(0,212,170,0.08)", border: "1px solid rgba(0,212,170,0.15)", color: "#00d4aa",
            }}>Demand: {z.price_low}\u2013{z.price_high}</span>
          ))}
        </div>
      )}

      {/* IB */}
      <div style={sectionStyle}>INITIAL BALANCE (per instrument)</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <div><div style={labelStyle}>IB HIGH</div><input style={inputStyle} value={form.ibHigh} onChange={e => set("ibHigh", e.target.value)} /></div>
        <div><div style={labelStyle}>IB LOW</div><input style={inputStyle} value={form.ibLow} onChange={e => set("ibLow", e.target.value)} /></div>
      </div>

      {/* Context dropdowns */}
      <div style={sectionStyle}>MARKET CONTEXT</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
        <div>
          <div style={labelStyle}>TREND</div>
          <select value={form.trend} onChange={e => set("trend", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="UP">UP</option>
            <option value="DOWN">DOWN</option>
          </select>
        </div>
        <div>
          <div style={labelStyle}>VA OPEN</div>
          <select value={form.vaOpen} onChange={e => set("vaOpen", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="Above VAH">Above VAH</option>
            <option value="Inside VA">Inside VA</option>
            <option value="Below VAL">Below VAL</option>
          </select>
        </div>
        <div>
          <div style={labelStyle}>M30 PATTERN</div>
          <select value={form.m30Pattern} onChange={e => set("m30Pattern", e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="None">None</option>
            <option value="Bull Engulf">Bull Engulf</option>
            <option value="Bear Engulf">Bear Engulf</option>
            <option value="Consolidation">Consolidation</option>
            <option value="3-Bar Reversal">3-Bar Reversal</option>
          </select>
        </div>
      </div>

      {/* ADR toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
        <button onClick={() => set("adrExhausted", !form.adrExhausted)} style={{
          fontSize: 9, fontFamily: MONO, fontWeight: 600, padding: "4px 12px",
          borderRadius: 4, cursor: "pointer",
          background: form.adrExhausted ? "rgba(246,201,14,0.15)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${form.adrExhausted ? "rgba(246,201,14,0.4)" : "rgba(255,255,255,0.08)"}`,
          color: form.adrExhausted ? "#f6c90e" : "#475569",
        }}>{form.adrExhausted ? "\u2713 ADR EXHAUSTED" : "ADR EXHAUSTED?"}</button>
        <span style={{ fontSize: 7, color: "#334155", fontFamily: MONO }}>\u2265 80% of 20-day TR</span>
      </div>

      {/* Analyse button */}
      <button onClick={analyse} disabled={loading} style={{
        marginTop: 4, padding: "8px 0", fontSize: 11, fontWeight: 700,
        fontFamily: MONO, letterSpacing: "0.1em",
        background: loading ? "rgba(74,158,255,0.05)" : "rgba(74,158,255,0.15)",
        border: "1px solid rgba(74,158,255,0.3)", borderRadius: 5,
        color: "#4a9eff", cursor: loading ? "default" : "pointer",
      }}>{loading ? "ANALYSING..." : "ANALYSE SIGNAL"}</button>

      {error && (
        <div style={{ fontSize: 9, color: "#ff4d6d", fontFamily: MONO, padding: "6px 8px", background: "rgba(255,77,109,0.1)", borderRadius: 4 }}>
          ERROR: {error}
        </div>
      )}

      {/* AI Result Card */}
      {result && (
        <div style={{ background: "rgba(0,0,0,0.4)", border: `2px solid ${sigColor}`, borderRadius: 8, padding: 14 }}>
          {/* Signal + Playbook badges */}
          <div style={{ textAlign: "center", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 8, fontFamily: MONO, color: "#475569", padding: "1px 6px", background: "rgba(255,255,255,0.05)", borderRadius: 3 }}>{form.instrument}</span>
              <span style={{ fontSize: 8, fontFamily: MONO, color: sigColor, padding: "1px 6px", background: sigColor + "15", borderRadius: 3 }}>
                {result.direction || ""}
              </span>
              {result.target_r && result.target_r !== "None" && (
                <span style={{ fontSize: 8, fontFamily: MONO, color: "#00d4aa", padding: "1px 6px", background: "rgba(0,212,170,0.1)", borderRadius: 3 }}>
                  {result.target_r}
                </span>
              )}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: sigColor, fontFamily: MONO, marginBottom: 2 }}>
              {result.signal}
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, color: "#94a3b8", fontFamily: MONO, letterSpacing: "0.08em" }}>
              {PLAYBOOK_NAMES[result.playbook] || result.playbook}
            </div>
          </div>

          {/* R target prices */}
          {result.stop && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "center", marginBottom: 10 }}>
              <LevelPill label="STOP" value={Number(result.stop).toFixed(2)} color="#ff4d6d" />
              {result.target_1 && <LevelPill label="1R" value={Number(result.target_1).toFixed(2)} color="#f6c90e" />}
              {result.target_2 && <LevelPill label="2R" value={Number(result.target_2).toFixed(2)} color="#00d4aa" />}
              {result.target_3 && <LevelPill label="3R" value={Number(result.target_3).toFixed(2)} color="#4a9eff" />}
            </div>
          )}

          {/* Criteria checklist */}
          {result.criteria && result.criteria.length > 0 && (
            <div style={{ marginBottom: 10, background: "rgba(0,0,0,0.25)", borderRadius: 4, padding: 8 }}>
              <div style={{ fontSize: 8, color: "#334155", fontFamily: MONO, letterSpacing: "0.1em", marginBottom: 4 }}>CRITERIA CHECK</div>
              {result.criteria.map((c, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 6, fontSize: 9, fontFamily: MONO,
                  padding: "2px 0",
                  borderBottom: i < result.criteria.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
                }}>
                  <span style={{ color: c.met ? "#00d4aa" : "#ff4d6d", fontSize: 10, minWidth: 14 }}>
                    {c.met ? "\u2713" : "\u2717"}
                  </span>
                  <span style={{ color: c.met ? "#94a3b8" : "#64748b" }}>{c.condition}</span>
                </div>
              ))}
            </div>
          )}

          {/* Reasoning */}
          {result.reasoning && (
            <div style={{ fontSize: 9, color: "#64748b", fontFamily: MONO, lineHeight: 1.6, background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: 8 }}>
              {result.reasoning}
            </div>
          )}

          {/* Timestamp */}
          {result.ts && (
            <div style={{ fontSize: 7, color: "#1e293b", fontFamily: MONO, marginTop: 6, textAlign: "right" }}>
              {new Date(result.ts).toLocaleTimeString()} EST
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── MANUAL DECISION TREE COMPONENT ───────────────────────────────────────────
function ManualDecisionTree({ selectedInstrument }) {
  const [currentId, setCurrentId] = useState("start");
  const [history, setHistory] = useState([]);
  // Lightweight VA/H4 levels for live conterminous badges
  const [mtVah, setMtVah] = useState("");
  const [mtVal, setMtVal] = useState("");
  const [mtH4Dem, setMtH4Dem] = useState("");
  const [mtH4Sup, setMtH4Sup] = useState("");

  const node = TREE[currentId];
  const isSignal = node.step === 6;

  const handleAnswer = useCallback((option) => {
    setHistory(h => [...h, { question: node.question, answer: option.label, nodeId: node.id }]);
    setCurrentId(option.next);
  }, [node]);

  const reset = useCallback(() => { setCurrentId("start"); setHistory([]); }, []);

  const goBack = useCallback(() => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setCurrentId(prev.nodeId);
  }, [history]);

  const activeStep = isSignal ? STEPS.length - 1 : node.step;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                <span style={{ fontSize: 7, marginTop: 2, fontFamily: MONO, color: done ? "#00d4aa" : active ? "#4a9eff" : "#334155", letterSpacing: "0.05em" }}>{s}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ height: 1, flex: 1, minWidth: 8, background: done ? "rgba(0,212,170,0.3)" : "rgba(255,255,255,0.06)", marginBottom: 10 }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Conterminous level inputs — compact bar, always visible */}
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 7, color: "#334155", fontFamily: MONO }}>LEVELS:</span>
        {[["VAH", mtVah, setMtVah], ["VAL", mtVal, setMtVal], ["H4 Dem", mtH4Dem, setMtH4Dem], ["H4 Sup", mtH4Sup, setMtH4Sup]].map(([lbl, val, setter]) => (
          <input key={lbl} placeholder={lbl} value={val} onChange={e => setter(e.target.value)} style={{
            width: 58, fontSize: 8, fontFamily: MONO, padding: "2px 4px", borderRadius: 3,
            background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.08)",
            color: "#94a3b8", outline: "none",
          }} />
        ))}
      </div>

      {/* Question or Signal */}
      {!isSignal ? (
        <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(74,158,255,0.15)", borderRadius: 6, padding: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", fontFamily: MONO, marginBottom: 6 }}>{node.question}</div>
          <div style={{ fontSize: 9, color: "#64748b", fontFamily: MONO, lineHeight: 1.5, marginBottom: node.context.includes("Conterminous") ? 6 : 12 }}>{node.context}</div>
          {/* Live conterminous badges — only on steps that reference it */}
          {node.context.includes("Conterminous") && (() => {
            const TV = { ES: 0.25, NQ: 0.25, DAX: 1.0, XAU: 0.1, OIL: 0.01 };
            const tv = TV[selectedInstrument] || 0.25;
            const tol = 10 * tv;
            const vah = parseFloat(mtVah), val = parseFloat(mtVal);
            const h4d = parseFloat(mtH4Dem), h4s = parseFloat(mtH4Sup);
            const hasDem = !isNaN(vah) && !isNaN(h4d);
            const hasSup = !isNaN(val) && !isNaN(h4s);
            const demDist = hasDem ? Math.abs(h4d - vah) : null;
            const supDist = hasSup ? Math.abs(h4s - val) : null;
            if (!hasDem && !hasSup) return (
              <div style={{ fontSize: 7, color: "#334155", fontFamily: MONO, marginBottom: 8 }}>
                Enter VAH/VAL + H4 levels above to see live conterminous check
              </div>
            );
            return (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                {hasDem && (
                  <span style={{ fontSize: 7, fontFamily: MONO, padding: "2px 6px", borderRadius: 3,
                    background: demDist <= tol ? "rgba(0,212,170,0.1)" : "rgba(255,77,109,0.08)",
                    color: demDist <= tol ? "#00d4aa" : "#ff4d6d",
                    border: `1px solid ${demDist <= tol ? "rgba(0,212,170,0.2)" : "rgba(255,77,109,0.15)"}`,
                  }}>{demDist <= tol ? "\u2713" : "\u2717"} Dem\u2194VAH: {demDist.toFixed(2)}pt (tol: {tol})</span>
                )}
                {hasSup && (
                  <span style={{ fontSize: 7, fontFamily: MONO, padding: "2px 6px", borderRadius: 3,
                    background: supDist <= tol ? "rgba(0,212,170,0.1)" : "rgba(255,77,109,0.08)",
                    color: supDist <= tol ? "#00d4aa" : "#ff4d6d",
                    border: `1px solid ${supDist <= tol ? "rgba(0,212,170,0.2)" : "rgba(255,77,109,0.15)"}`,
                  }}>{supDist <= tol ? "\u2713" : "\u2717"} Sup\u2194VAL: {supDist.toFixed(2)}pt (tol: {tol})</span>
                )}
              </div>
            );
          })()}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {node.options.map((opt) => (
              <button key={opt.value} onClick={() => handleAnswer(opt)} style={{
                background: "rgba(74,158,255,0.08)", border: "1px solid rgba(74,158,255,0.2)",
                borderRadius: 4, padding: "8px 12px", color: "#e2e8f0", fontSize: 10,
                fontFamily: MONO, cursor: "pointer", textAlign: "left", transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.target.style.background = "rgba(74,158,255,0.18)"; e.target.style.borderColor = "rgba(74,158,255,0.4)"; }}
              onMouseLeave={e => { e.target.style.background = "rgba(74,158,255,0.08)"; e.target.style.borderColor = "rgba(74,158,255,0.2)"; }}
              >{opt.label}</button>
            ))}
          </div>
        </div>
      ) : (
        <div style={{ background: "rgba(0,0,0,0.4)", border: `2px solid ${node.color}`, borderRadius: 8, padding: 18, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 8, fontFamily: MONO, color: "#475569", padding: "1px 6px", background: "rgba(255,255,255,0.05)", borderRadius: 3 }}>{selectedInstrument}</span>
            <span style={{ fontSize: 8, fontFamily: MONO, color: node.color, padding: "1px 6px", background: node.color + "15", borderRadius: 3 }}>SIGNAL</span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: node.color, fontFamily: MONO, marginBottom: 4 }}>{node.signal}</div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#e2e8f0", fontFamily: MONO, marginBottom: 10, letterSpacing: "0.06em" }}>{node.label}</div>
          <div style={{ fontSize: 9, color: "#94a3b8", fontFamily: MONO, lineHeight: 1.6, textAlign: "left", background: "rgba(0,0,0,0.3)", borderRadius: 4, padding: 10 }}>{node.summary}</div>
        </div>
      )}

      {/* History log */}
      {history.length > 0 && (
        <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: 8, border: "1px solid rgba(255,255,255,0.04)" }}>
          <div style={{ fontSize: 8, color: "#334155", fontFamily: MONO, letterSpacing: "0.1em", marginBottom: 4 }}>DECISION LOG</div>
          {history.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 6, fontSize: 9, fontFamily: MONO, padding: "3px 0", borderBottom: i < history.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none" }}>
              <span style={{ color: "#334155", minWidth: 14 }}>{i + 1}.</span>
              <span style={{ color: "#475569" }}>{h.question}</span>
              <span style={{ color: "#4a9eff", marginLeft: "auto", whiteSpace: "nowrap" }}>{h.answer}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bottom controls */}
      <div style={{ display: "flex", gap: 8, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        {history.length > 0 && !isSignal && (
          <button onClick={goBack} style={{ flex: 1, padding: "6px 0", fontSize: 9, fontFamily: MONO, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "#94a3b8", cursor: "pointer" }}>
            \u2190 BACK
          </button>
        )}
        <button onClick={reset} style={{
          flex: 1, padding: "6px 0", fontSize: 9, fontFamily: MONO, fontWeight: 700, letterSpacing: "0.08em",
          background: isSignal ? `${node.color}22` : "rgba(255,77,109,0.1)",
          border: `1px solid ${isSignal ? node.color + "44" : "rgba(255,77,109,0.2)"}`,
          borderRadius: 4, color: isSignal ? node.color : "#ff4d6d", cursor: "pointer",
        }}>{isSignal ? "\u21BB NEW SIGNAL" : "\u21BB RESET"}</button>
      </div>
    </div>
  );
}

// ── PRICE ALERT SYSTEM ───────────────────────────────────────────────────────
function useZoneAlerts(instrument) {
  const [watchedZones, setWatchedZones] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [monitoring, setMonitoring] = useState(false);
  const pollRef = useRef(null);
  const firedRef = useRef(new Set()); // track which zones already fired

  const YAHOO_MAP = { ES: "ES=F", NQ: "NQ=F", DAX: "^GDAXI", XAU: "GC=F", OIL: "CL=F" };

  const setZones = useCallback((supply, demand, atr, inst) => {
    const zones = [
      ...supply.map((z, i) => ({ id: `sup_${i}`, type: "supply", ...z, instrument: inst })),
      ...demand.map((z, i) => ({ id: `dem_${i}`, type: "demand", ...z, instrument: inst })),
    ];
    setWatchedZones(zones);
    firedRef.current = new Set();
    setMonitoring(zones.length > 0);
    // Request notification permission
    if (zones.length > 0 && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
  }, []);

  const dismissAlert = useCallback((id) => {
    setAlerts(a => a.filter(x => x.id !== id));
  }, []);

  const clearAll = useCallback(() => { setAlerts([]); }, []);

  // Poll price every 30 seconds
  useEffect(() => {
    if (!monitoring || watchedZones.length === 0) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    const checkPrice = async () => {
      try {
        const inst = watchedZones[0]?.instrument || instrument;
        const sym = YAHOO_MAP[inst] || "ES=F";
        const r = await fetch(`${BACKEND_URL}/api/market`);
        const d = await r.json();
        if (!d.success) return;

        let price = 0;
        if (inst === "ES" && d.data?.es) price = d.data.es.price;
        else if (inst === "NQ" && d.data?.nq) price = d.data.nq.price;
        else {
          const etf = (d.data?.etfs || []).find(e => e.sym === inst || e.sym === sym);
          if (etf) price = etf.price;
        }
        if (!price) return;

        // Check each zone
        for (const zone of watchedZones) {
          if (firedRef.current.has(zone.id)) continue;
          const threshold = (zone.distance || 50) * 0.5; // 0.5x of the zone's distance as proximity
          const zoneMid = (zone.price_high + zone.price_low) / 2;
          const dist = Math.abs(price - zoneMid);
          const zoneHalf = (zone.price_high - zone.price_low) / 2;
          const triggerDist = Math.max(zoneHalf * 2, 5); // within 2x zone width or 5 pts

          if (dist <= triggerDist) {
            firedRef.current.add(zone.id);
            const alert = {
              id: `${zone.id}_${Date.now()}`,
              zoneId: zone.id,
              type: zone.type,
              instrument: zone.instrument,
              price,
              zoneHigh: zone.price_high,
              zoneLow: zone.price_low,
              ts: new Date(),
            };
            setAlerts(a => [alert, ...a]);

            // Browser notification
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification(`Axiom Edge \u2014 ${zone.type.toUpperCase()} Zone Hit`, {
                body: `${zone.instrument} @ ${price.toFixed(2)} entered ${zone.type} zone ${zone.price_low.toFixed(2)}\u2013${zone.price_high.toFixed(2)}`,
                icon: "/favicon.ico",
              });
            }
          }
        }
      } catch {}
    };

    checkPrice(); // immediate check
    pollRef.current = setInterval(checkPrice, 30000);
    return () => clearInterval(pollRef.current);
  }, [monitoring, watchedZones, instrument]);

  return { watchedZones, alerts, monitoring, setZones, dismissAlert, clearAll, setMonitoring };
}

// ── ALERT BANNER ─────────────────────────────────────────────────────────────
function AlertBanner({ alerts, onDismiss, onClearAll }) {
  if (alerts.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {alerts.map(a => (
        <div key={a.id} style={{
          display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 4,
          background: a.type === "supply" ? "rgba(255,77,109,0.12)" : "rgba(0,212,170,0.12)",
          border: `1px solid ${a.type === "supply" ? "rgba(255,77,109,0.3)" : "rgba(0,212,170,0.3)"}`,
          animation: "fadeIn 0.3s ease",
        }}>
          <span style={{ fontSize: 12 }}>{a.type === "supply" ? "\uD83D\uDD34" : "\uD83D\uDFE2"}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, fontWeight: 700, fontFamily: MONO, color: a.type === "supply" ? "#ff4d6d" : "#00d4aa" }}>
              {a.instrument} {a.type.toUpperCase()} ZONE HIT
            </div>
            <div style={{ fontSize: 8, fontFamily: MONO, color: "#94a3b8" }}>
              Price {a.price.toFixed(2)} entered {a.zoneLow.toFixed(2)}\u2013{a.zoneHigh.toFixed(2)} \u00b7 {a.ts.toLocaleTimeString()}
            </div>
          </div>
          <button onClick={() => onDismiss(a.id)} style={{
            fontSize: 10, color: "#475569", background: "none", border: "none", cursor: "pointer", padding: "0 4px",
          }}>\u2715</button>
        </div>
      ))}
      {alerts.length > 1 && (
        <button onClick={onClearAll} style={{
          fontSize: 7, fontFamily: MONO, color: "#334155", background: "none",
          border: "none", cursor: "pointer", textAlign: "center", padding: 2,
        }}>Clear all alerts</button>
      )}
    </div>
  );
}

// ── MULTI-INSTRUMENT SCANNER ──────────────────────────────────────────────────
function InstrumentScanner() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastScan, setLastScan] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const autoRef = useRef(null);

  const scan = useCallback(async () => {
    setLoading(true); setError(null);
    setScanProgress("Scanning ES\u2026 NQ\u2026 DAX\u2026 XAU\u2026 OIL\u2026");
    try {
      const r = await fetch(`${BACKEND_URL}/api/scanner`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setResults(d.results);
      setLastScan(new Date());
    } catch (e) { setError(e.message); }
    setLoading(false); setScanProgress("");
  }, []);

  useEffect(() => {
    if (autoRefresh) {
      autoRef.current = setInterval(scan, 5 * 60 * 1000);
      return () => clearInterval(autoRef.current);
    } else { if (autoRef.current) clearInterval(autoRef.current); }
  }, [autoRefresh, scan]);

  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 30000); return () => clearInterval(t); }, []);
  const timeAgo = lastScan ? (() => {
    const diff = Math.floor((Date.now() - lastScan.getTime()) / 60000);
    return diff < 1 ? "just now" : `${diff}m ago`;
  })() : null;

  const sigColor = (sig) => SIGNAL_COLORS[sig] || "#475569";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={scan} disabled={loading} style={{
          flex: 1, padding: "10px 0", fontSize: 12, fontWeight: 700,
          fontFamily: MONO, letterSpacing: "0.12em",
          background: loading ? "rgba(74,158,255,0.05)" : "rgba(74,158,255,0.15)",
          border: "1px solid rgba(74,158,255,0.35)", borderRadius: 5,
          color: "#4a9eff", cursor: loading ? "default" : "pointer",
        }}>{loading ? "\u23F3 SCANNING..." : "\u26A1 SCAN ALL"}</button>
        <button onClick={() => setAutoRefresh(!autoRefresh)} style={{
          padding: "10px 14px", fontSize: 8, fontWeight: 700,
          fontFamily: MONO, letterSpacing: "0.06em", borderRadius: 5, cursor: "pointer",
          background: autoRefresh ? "rgba(0,212,170,0.12)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${autoRefresh ? "rgba(0,212,170,0.3)" : "rgba(255,255,255,0.08)"}`,
          color: autoRefresh ? "#00d4aa" : "#475569",
        }}>{autoRefresh ? "\u25CF 5m" : "AUTO"}</button>
      </div>

      {scanProgress && (
        <div style={{ fontSize: 8, color: "#475569", fontFamily: MONO, textAlign: "center" }}>{scanProgress}</div>
      )}
      {timeAgo && (
        <div style={{ fontSize: 7, color: "#334155", fontFamily: MONO, textAlign: "center" }}>
          Last scanned: {timeAgo} {autoRefresh && "\u00b7 auto-refresh ON"}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 9, fontFamily: MONO, padding: "6px 8px", borderRadius: 4, background: "rgba(255,77,109,0.08)", color: "#ff4d6d" }}>
          ERROR: {error}
        </div>
      )}

      {results && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {INSTRUMENTS.map(inst => {
            const r = results[inst];
            if (!r) return null;
            const hasSignal = r.signal === "LONG" || r.signal === "SHORT";
            const sc = sigColor(r.signal);
            return (
              <div key={inst} style={{
                background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: 10,
                border: `1px solid ${hasSignal ? sc + "55" : "rgba(255,255,255,0.06)"}`,
              }}>
                {r.error ? (
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, fontFamily: MONO, color: "#94a3b8", marginBottom: 4 }}>{inst}</div>
                    <div style={{ fontSize: 8, fontFamily: MONO, color: "#ff4d6d" }}>{r.error}</div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, fontFamily: MONO, color: "#e2e8f0" }}>{inst}</span>
                      <span style={{ fontSize: 8, fontFamily: MONO, color: "#64748b" }}>{r.current_price?.toFixed(2)}</span>
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: sc, fontFamily: MONO, marginBottom: 4 }}>
                      {r.signal || "NO TRADE"}
                    </div>
                    {r.playbook_selected && (
                      <div style={{ fontSize: 8, fontFamily: MONO, color: "#94a3b8", marginBottom: 2 }}>
                        {PLAYBOOK_NAMES[r.playbook_selected] || r.playbook_selected}
                      </div>
                    )}
                    {r.playbook_path && (
                      <div style={{ fontSize: 7, fontFamily: MONO, color: "#475569", marginBottom: 4 }}>{r.playbook_path}</div>
                    )}
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {r.confidence && (
                        <span style={{ fontSize: 7, fontFamily: MONO, padding: "1px 5px", borderRadius: 3, fontWeight: 700,
                          color: CONFIDENCE_COLORS[r.confidence] || "#475569",
                          background: (CONFIDENCE_COLORS[r.confidence] || "#475569") + "15",
                        }}>{r.confidence}</span>
                      )}
                      {r.target_r && r.target_r !== "None" && (
                        <span style={{ fontSize: 7, fontFamily: MONO, padding: "1px 5px", borderRadius: 3, color: "#00d4aa", background: "rgba(0,212,170,0.1)" }}>{r.target_r}</span>
                      )}
                      {r.ib_status && (
                        <span style={{ fontSize: 7, fontFamily: MONO, padding: "1px 5px", borderRadius: 3,
                          color: r.ib_status === "set" ? "#00d4aa" : r.ib_status === "forming" ? "#f6c90e" : "#475569",
                          background: (r.ib_status === "set" ? "#00d4aa" : r.ib_status === "forming" ? "#f6c90e" : "#475569") + "15",
                        }}>IB {r.ib_status}</span>
                      )}
                      {r.adr_exhausted && (
                        <span style={{ fontSize: 7, fontFamily: MONO, padding: "1px 5px", borderRadius: 3, color: "#f6c90e", background: "rgba(246,201,14,0.1)" }}>ADR EXH</span>
                      )}
                    </div>
                    {r.reasoning && (
                      <div style={{ fontSize: 7, fontFamily: MONO, color: "#334155", marginTop: 4, lineHeight: 1.4 }}>{r.reasoning}</div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function SignalsPanel() {
  const [mode, setMode] = useState("auto"); // "auto" | "chart" | "ai" | "manual" | "calc"
  const [selectedInstrument, setSelectedInstrument] = useState("ES");
  const [chartData, setChartData] = useState(null);
  const zoneAlerts = useZoneAlerts(selectedInstrument);

  const handleChartAutoFill = useCallback((data) => {
    setChartData(data);
    setMode("ai");
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
      {/* Header */}
      <div style={{ textAlign: "center", paddingBottom: 6, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.14em", color: "#4a9eff", fontFamily: MONO }}>
          AXIOM EDGE
        </div>
        <div style={{ fontSize: 9, color: "#475569", fontFamily: MONO, marginTop: 2 }}>
          Intelligent signals engine \u00b7 PB1 \u00b7 PB2 \u00b7 PB3 \u00b7 PB4
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
      <SessionClock instrument={selectedInstrument} />

      {/* Zone alerts */}
      <AlertBanner alerts={zoneAlerts.alerts} onDismiss={zoneAlerts.dismissAlert} onClearAll={zoneAlerts.clearAll} />

      {/* Monitoring indicator */}
      {zoneAlerts.monitoring && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <span style={{ fontSize: 7, fontFamily: MONO, color: "#00d4aa" }}>{"\u25CF"} Monitoring {zoneAlerts.watchedZones.length} zones</span>
          <button onClick={() => zoneAlerts.setMonitoring(false)} style={{
            fontSize: 7, fontFamily: MONO, color: "#475569", background: "none",
            border: "1px solid rgba(255,255,255,0.08)", borderRadius: 3, padding: "1px 5px", cursor: "pointer",
          }}>STOP</button>
        </div>
      )}

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 2, background: "rgba(0,0,0,0.3)", borderRadius: 4, padding: 2 }}>
        {[["auto", "AUTO"], ["scanner", "SCAN"], ["chart", "CHART"], ["ai", "ANALYSER"], ["manual", "MANUAL"], ["calc", "ATR"]].map(([k, label]) => (
          <button key={k} onClick={() => setMode(k)} style={{
            flex: 1, padding: "5px 0", fontSize: 8, fontWeight: 700,
            fontFamily: MONO, letterSpacing: "0.08em", borderRadius: 3,
            cursor: "pointer", border: "none",
            background: mode === k ? "rgba(74,158,255,0.2)" : "transparent",
            color: mode === k ? "#4a9eff" : "#475569",
          }}>{label}</button>
        ))}
      </div>

      {/* Content area */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {mode === "auto" && <AutoSignalEngine selectedInstrument={selectedInstrument} onInstrumentChange={setSelectedInstrument} onZonesLoaded={zoneAlerts.setZones} />}
        {mode === "scanner" && <InstrumentScanner />}
        {mode === "chart" && <ChartAnalyser onAutoFill={handleChartAutoFill} />}
        {mode === "ai" && <AISignalAnalyser chartData={chartData} onZonesLoaded={zoneAlerts.setZones} />}
        {mode === "calc" && <ATRCalculator />}
        {mode === "manual" && <ManualDecisionTree selectedInstrument={selectedInstrument} />}
      </div>
    </div>
  );
}
