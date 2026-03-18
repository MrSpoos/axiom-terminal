import { useState, useCallback } from "react";

// ── DECISION TREE ────────────────────────────────────────────────────────────
// Each node: { id, step (breadcrumb index), question, context, options: [{ label, next, value }] }
// Terminal nodes have: { id, step:6, signal, color, label, summary }

const STEPS = ["Trend", "VA Open", "Playbook", "Setup", "Entry", "R:R", "Signal"];

const TREE = {
  // ── STEP 0: TREND ──────────────────────────────────────────────────────────
  start: {
    id: "start", step: 0,
    question: "What is the higher-timeframe trend?",
    context: "Check the daily / 4H chart. Is price making higher highs + higher lows (uptrend), lower highs + lower lows (downtrend), or chopping inside a range?",
    options: [
      { label: "⬆ UPTREND", value: "uptrend", next: "va_open_up" },
      { label: "⬇ DOWNTREND", value: "downtrend", next: "va_open_down" },
      { label: "↔ RANGE / CHOP", value: "range", next: "va_open_range" },
    ],
  },

  // ── STEP 1: VA OPEN — UPTREND ─────────────────────────────────────────────
  va_open_up: {
    id: "va_open_up", step: 1,
    question: "Where did price open relative to Value Area?",
    context: "Uptrend context. Compare the open to yesterday's VAH / VAL / POC. An open above VA is strongest for continuation.",
    options: [
      { label: "Above VA", value: "above_va", next: "pb1_up_setup" },
      { label: "Inside VA", value: "inside_va", next: "pb2_up_setup" },
      { label: "Below VA", value: "below_va", next: "pb_ct_check_up" },
    ],
  },

  // ── STEP 1: VA OPEN — DOWNTREND ───────────────────────────────────────────
  va_open_down: {
    id: "va_open_down", step: 1,
    question: "Where did price open relative to Value Area?",
    context: "Downtrend context. An open below VA is strongest for short continuation.",
    options: [
      { label: "Below VA", value: "below_va", next: "pb1_down_setup" },
      { label: "Inside VA", value: "inside_va", next: "pb2_down_setup" },
      { label: "Above VA", value: "above_va", next: "pb_ct_check_down" },
    ],
  },

  // ── STEP 1: VA OPEN — RANGE ───────────────────────────────────────────────
  va_open_range: {
    id: "va_open_range", step: 1,
    question: "Where did price open relative to Value Area?",
    context: "Range / chop context. Look for mean-reversion plays back to POC or VA edges.",
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
    context: "Price opened above VA in an uptrend. This is the highest-probability setup. We want a pullback into VAH or POC as support, then continuation higher.",
    options: [
      { label: "Pullback to VAH/POC holding", value: "pb_holding", next: "pb1_up_entry" },
      { label: "No pullback — running away", value: "no_pb", next: "signal_no_trade_chasing" },
      { label: "Pullback broke through VA", value: "pb_broke", next: "pb2_up_setup" },
    ],
  },
  pb1_up_entry: {
    id: "pb1_up_entry", step: 3,
    question: "Is there a valid entry trigger?",
    context: "Look for: reclaim of VAH on volume, bullish engulfing on 5m, delta flip positive, or VWAP hold. Need at least 2 confirmations.",
    options: [
      { label: "Yes — 2+ confirmations", value: "confirmed", next: "pb1_up_rr" },
      { label: "Weak — only 1 signal", value: "weak", next: "signal_no_trade_weak" },
      { label: "No — price rejecting", value: "no", next: "signal_no_trade_reject" },
    ],
  },
  pb1_up_rr: {
    id: "pb1_up_rr", step: 4,
    question: "What is the risk:reward?",
    context: "Stop below the pullback low / VAH. Target the prior high, +1 ATR, or next resistance level. Minimum 2:1 R:R required for PB1.",
    options: [
      { label: "≥ 3:1 R:R — excellent", value: "3to1", next: "signal_pb1_long_strong" },
      { label: "2:1 R:R — acceptable", value: "2to1", next: "signal_pb1_long" },
      { label: "< 2:1 R:R — pass", value: "sub2", next: "signal_no_trade_rr" },
    ],
  },

  // ── PB1: TREND CONTINUATION (DOWN) ────────────────────────────────────────
  pb1_down_setup: {
    id: "pb1_down_setup", step: 2,
    question: "PB1 — Trend Continuation Short",
    context: "Price opened below VA in a downtrend. Highest-probability short setup. Look for a bounce into VAL or POC as resistance, then continuation lower.",
    options: [
      { label: "Bounce to VAL/POC rejected", value: "bounce_reject", next: "pb1_down_entry" },
      { label: "No bounce — flushing down", value: "no_bounce", next: "signal_no_trade_chasing" },
      { label: "Bounce reclaimed VA", value: "bounce_reclaim", next: "pb2_down_setup" },
    ],
  },
  pb1_down_entry: {
    id: "pb1_down_entry", step: 3,
    question: "Is there a valid entry trigger?",
    context: "Look for: rejection at VAL on volume, bearish engulfing on 5m, delta flip negative, or VWAP rejection. Need at least 2 confirmations.",
    options: [
      { label: "Yes — 2+ confirmations", value: "confirmed", next: "pb1_down_rr" },
      { label: "Weak — only 1 signal", value: "weak", next: "signal_no_trade_weak" },
      { label: "No — price reclaiming", value: "no", next: "signal_no_trade_reject" },
    ],
  },
  pb1_down_rr: {
    id: "pb1_down_rr", step: 4,
    question: "What is the risk:reward?",
    context: "Stop above the bounce high / VAL. Target the prior low, -1 ATR, or next support level. Minimum 2:1 R:R required.",
    options: [
      { label: "≥ 3:1 R:R — excellent", value: "3to1", next: "signal_pb1_short_strong" },
      { label: "2:1 R:R — acceptable", value: "2to1", next: "signal_pb1_short" },
      { label: "< 2:1 R:R — pass", value: "sub2", next: "signal_no_trade_rr" },
    ],
  },

  // ── PB2: RETURN TO VA (UP — inside VA open) ──────────────────────────────
  pb2_up_setup: {
    id: "pb2_up_setup", step: 2,
    question: "PB2 — Return to VAH (Long)",
    context: "Uptrend but opened inside VA. Price should push back toward VAH. Look for acceptance above POC as the trigger zone.",
    options: [
      { label: "Holding above POC", value: "above_poc", next: "pb2_up_entry" },
      { label: "Stuck at POC — no momentum", value: "stuck", next: "signal_no_trade_chop" },
      { label: "Rejected below POC", value: "below_poc", next: "signal_no_trade_reject" },
    ],
  },
  pb2_up_entry: {
    id: "pb2_up_entry", step: 3,
    question: "Is there a valid entry trigger?",
    context: "Look for: price reclaiming POC with increasing volume, bid stacking on DOM, or bullish structure on 15m. Target VAH.",
    options: [
      { label: "Yes — POC reclaim confirmed", value: "confirmed", next: "pb2_up_rr" },
      { label: "Marginal — low conviction", value: "marginal", next: "signal_no_trade_weak" },
    ],
  },
  pb2_up_rr: {
    id: "pb2_up_rr", step: 4,
    question: "What is the risk:reward to VAH?",
    context: "Stop below POC / session low. Target VAH. PB2 typically has tighter targets than PB1.",
    options: [
      { label: "≥ 2:1 R:R", value: "2to1", next: "signal_pb2_long" },
      { label: "< 2:1 R:R — too tight", value: "sub2", next: "signal_no_trade_rr" },
    ],
  },

  // ── PB2: RETURN TO VA (DOWN — inside VA open) ────────────────────────────
  pb2_down_setup: {
    id: "pb2_down_setup", step: 2,
    question: "PB2 — Return to VAL (Short)",
    context: "Downtrend but opened inside VA. Price should push back toward VAL. Look for rejection below POC as the trigger zone.",
    options: [
      { label: "Holding below POC", value: "below_poc", next: "pb2_down_entry" },
      { label: "Stuck at POC — no momentum", value: "stuck", next: "signal_no_trade_chop" },
      { label: "Reclaimed above POC", value: "above_poc", next: "signal_no_trade_reject" },
    ],
  },
  pb2_down_entry: {
    id: "pb2_down_entry", step: 3,
    question: "Is there a valid entry trigger?",
    context: "Look for: price rejecting POC with increasing volume, offer stacking on DOM, or bearish structure on 15m. Target VAL.",
    options: [
      { label: "Yes — POC rejection confirmed", value: "confirmed", next: "pb2_down_rr" },
      { label: "Marginal — low conviction", value: "marginal", next: "signal_no_trade_weak" },
    ],
  },
  pb2_down_rr: {
    id: "pb2_down_rr", step: 4,
    question: "What is the risk:reward to VAL?",
    context: "Stop above POC / session high. Target VAL.",
    options: [
      { label: "≥ 2:1 R:R", value: "2to1", next: "signal_pb2_short" },
      { label: "< 2:1 R:R — too tight", value: "sub2", next: "signal_no_trade_rr" },
    ],
  },

  // ── PB3: COUNTERTREND — ADR EXHAUSTION ────────────────────────────────────
  pb_ct_check_up: {
    id: "pb_ct_check_up", step: 2,
    question: "PB3/PB4 — Countertrend Check",
    context: "Price opened below VA in an uptrend — unusual. Check if ADR is exhausted (price already moved ≥ 80% of average daily range) for a CT fade, or look for a swing reversal setup.",
    options: [
      { label: "ADR ≥ 80% exhausted — PB3 fade", value: "adr_exhausted", next: "pb3_ct_long_entry" },
      { label: "Major level + reversal candle — PB4 swing", value: "swing_setup", next: "pb4_swing_long_entry" },
      { label: "Neither — no setup", value: "neither", next: "signal_no_trade_nosetup" },
    ],
  },
  pb_ct_check_down: {
    id: "pb_ct_check_down", step: 2,
    question: "PB3/PB4 — Countertrend Check",
    context: "Price opened above VA in a downtrend — unusual. Check if ADR is exhausted for a CT fade, or look for a swing reversal setup.",
    options: [
      { label: "ADR ≥ 80% exhausted — PB3 fade", value: "adr_exhausted", next: "pb3_ct_short_entry" },
      { label: "Major level + reversal candle — PB4 swing", value: "swing_setup", next: "pb4_swing_short_entry" },
      { label: "Neither — no setup", value: "neither", next: "signal_no_trade_nosetup" },
    ],
  },

  // PB3 CT intraday entries
  pb3_ct_long_entry: {
    id: "pb3_ct_long_entry", step: 3,
    question: "PB3 — CT Intraday Long: Entry trigger?",
    context: "ADR exhausted to the downside. Look for: hammer / doji at support, volume climax + absorption, delta divergence. This is countertrend — size down 50%.",
    options: [
      { label: "Reversal confirmed — volume + candle", value: "confirmed", next: "pb3_ct_long_rr" },
      { label: "No clear reversal signal", value: "no", next: "signal_no_trade_noconfirm" },
    ],
  },
  pb3_ct_long_rr: {
    id: "pb3_ct_long_rr", step: 4,
    question: "R:R for CT intraday long?",
    context: "Stop below the exhaustion low. Target VWAP or POC (not full VA — this is a scalp). Minimum 1.5:1 for CT trades. Half size.",
    options: [
      { label: "≥ 2:1 R:R", value: "2to1", next: "signal_pb3_ct_long" },
      { label: "1.5:1 R:R — marginal", value: "1.5to1", next: "signal_pb3_ct_long_marginal" },
      { label: "< 1.5:1 — skip", value: "sub1.5", next: "signal_no_trade_rr" },
    ],
  },
  pb3_ct_short_entry: {
    id: "pb3_ct_short_entry", step: 3,
    question: "PB3 — CT Intraday Short: Entry trigger?",
    context: "ADR exhausted to the upside. Look for: shooting star at resistance, volume climax + absorption, delta divergence. Countertrend — size down 50%.",
    options: [
      { label: "Reversal confirmed — volume + candle", value: "confirmed", next: "pb3_ct_short_rr" },
      { label: "No clear reversal signal", value: "no", next: "signal_no_trade_noconfirm" },
    ],
  },
  pb3_ct_short_rr: {
    id: "pb3_ct_short_rr", step: 4,
    question: "R:R for CT intraday short?",
    context: "Stop above the exhaustion high. Target VWAP or POC. Minimum 1.5:1 for CT trades. Half size.",
    options: [
      { label: "≥ 2:1 R:R", value: "2to1", next: "signal_pb3_ct_short" },
      { label: "1.5:1 R:R — marginal", value: "1.5to1", next: "signal_pb3_ct_short_marginal" },
      { label: "< 1.5:1 — skip", value: "sub1.5", next: "signal_no_trade_rr" },
    ],
  },

  // PB3 Range fades
  pb3_range_long: {
    id: "pb3_range_long", step: 2,
    question: "PB3 — Range Fade Long",
    context: "Price opened below VA in a range. Fade back toward POC/VAL. Look for exhaustion + reversal candle at support.",
    options: [
      { label: "Reversal signal at support", value: "confirmed", next: "pb3_range_long_rr" },
      { label: "No reversal — breaking down", value: "no", next: "signal_no_trade_noconfirm" },
    ],
  },
  pb3_range_long_rr: {
    id: "pb3_range_long_rr", step: 4,
    question: "R:R for range fade long?",
    context: "Stop below range low. Target POC. Half size — range trades are lower conviction.",
    options: [
      { label: "≥ 2:1 R:R", value: "2to1", next: "signal_pb3_range_long" },
      { label: "< 2:1 — skip", value: "sub2", next: "signal_no_trade_rr" },
    ],
  },
  pb3_range_short: {
    id: "pb3_range_short", step: 2,
    question: "PB3 — Range Fade Short",
    context: "Price opened above VA in a range. Fade back toward POC/VAH. Look for exhaustion + reversal candle at resistance.",
    options: [
      { label: "Reversal signal at resistance", value: "confirmed", next: "pb3_range_short_rr" },
      { label: "No reversal — breaking out", value: "no", next: "signal_no_trade_noconfirm" },
    ],
  },
  pb3_range_short_rr: {
    id: "pb3_range_short_rr", step: 4,
    question: "R:R for range fade short?",
    context: "Stop above range high. Target POC. Half size.",
    options: [
      { label: "≥ 2:1 R:R", value: "2to1", next: "signal_pb3_range_short" },
      { label: "< 2:1 — skip", value: "sub2", next: "signal_no_trade_rr" },
    ],
  },

  // ── PB4: COUNTERTREND SWING ───────────────────────────────────────────────
  pb4_swing_long_entry: {
    id: "pb4_swing_long_entry", step: 3,
    question: "PB4 — CT Swing Long: Confirm reversal",
    context: "Major support level + reversal candle on the daily. This is a multi-day swing — need strong conviction. Check: weekly S/R, monthly VWAP, volume profile HVN.",
    options: [
      { label: "Daily reversal + major level — high conviction", value: "high", next: "pb4_swing_long_rr" },
      { label: "Level OK but candle weak", value: "weak", next: "signal_no_trade_weak" },
    ],
  },
  pb4_swing_long_rr: {
    id: "pb4_swing_long_rr", step: 4,
    question: "R:R for swing long?",
    context: "Stop below the reversal candle low. Target the prior swing high or weekly level. Swing trades need ≥ 3:1 R:R.",
    options: [
      { label: "≥ 3:1 R:R", value: "3to1", next: "signal_pb4_swing_long" },
      { label: "< 3:1 — not enough for swing", value: "sub3", next: "signal_no_trade_rr" },
    ],
  },
  pb4_swing_short_entry: {
    id: "pb4_swing_short_entry", step: 3,
    question: "PB4 — CT Swing Short: Confirm reversal",
    context: "Major resistance level + reversal candle on the daily. Multi-day swing short. Check: weekly R, monthly VWAP, volume profile HVN.",
    options: [
      { label: "Daily reversal + major level — high conviction", value: "high", next: "pb4_swing_short_rr" },
      { label: "Level OK but candle weak", value: "weak", next: "signal_no_trade_weak" },
    ],
  },
  pb4_swing_short_rr: {
    id: "pb4_swing_short_rr", step: 4,
    question: "R:R for swing short?",
    context: "Stop above the reversal candle high. Target the prior swing low or weekly level. Swing trades need ≥ 3:1 R:R.",
    options: [
      { label: "≥ 3:1 R:R", value: "3to1", next: "signal_pb4_swing_short" },
      { label: "< 3:1 — not enough for swing", value: "sub3", next: "signal_no_trade_rr" },
    ],
  },

  // ── TERMINAL SIGNALS ──────────────────────────────────────────────────────
  // PB1
  signal_pb1_long_strong:  { id: "signal_pb1_long_strong",  step: 6, signal: "LONG",  color: "#00d4aa", label: "PB1 LONG — HIGH CONVICTION", summary: "Trend continuation long. Open above VA, pullback held, 3:1+ R:R. Full size. Trail stop to breakeven at 1R." },
  signal_pb1_long:         { id: "signal_pb1_long",         step: 6, signal: "LONG",  color: "#00d4aa", label: "PB1 LONG — STANDARD",        summary: "Trend continuation long. Open above VA, pullback held, 2:1 R:R. Standard size. Stop below pullback low." },
  signal_pb1_short_strong: { id: "signal_pb1_short_strong", step: 6, signal: "SHORT", color: "#ff4d6d", label: "PB1 SHORT — HIGH CONVICTION", summary: "Trend continuation short. Open below VA, bounce rejected, 3:1+ R:R. Full size. Trail stop to breakeven at 1R." },
  signal_pb1_short:        { id: "signal_pb1_short",        step: 6, signal: "SHORT", color: "#ff4d6d", label: "PB1 SHORT — STANDARD",        summary: "Trend continuation short. Open below VA, bounce rejected, 2:1 R:R. Standard size. Stop above bounce high." },

  // PB2
  signal_pb2_long:  { id: "signal_pb2_long",  step: 6, signal: "LONG",  color: "#00d4aa", label: "PB2 LONG — RETURN TO VAH",  summary: "Inside VA, holding above POC in uptrend. Target VAH. Standard size. Stop below POC." },
  signal_pb2_short: { id: "signal_pb2_short", step: 6, signal: "SHORT", color: "#ff4d6d", label: "PB2 SHORT — RETURN TO VAL", summary: "Inside VA, holding below POC in downtrend. Target VAL. Standard size. Stop above POC." },

  // PB3 CT intraday
  signal_pb3_ct_long:           { id: "signal_pb3_ct_long",           step: 6, signal: "CT LONG",  color: "#f6c90e", label: "PB3 CT INTRADAY LONG",          summary: "ADR exhausted to downside. Reversal confirmed. Target VWAP/POC. HALF SIZE — countertrend." },
  signal_pb3_ct_long_marginal:  { id: "signal_pb3_ct_long_marginal",  step: 6, signal: "CT LONG",  color: "#f6c90e", label: "PB3 CT LONG — MARGINAL",        summary: "ADR exhausted, marginal R:R (1.5:1). Quarter size max. Quick scalp to VWAP only." },
  signal_pb3_ct_short:          { id: "signal_pb3_ct_short",          step: 6, signal: "CT SHORT", color: "#f6c90e", label: "PB3 CT INTRADAY SHORT",         summary: "ADR exhausted to upside. Reversal confirmed. Target VWAP/POC. HALF SIZE — countertrend." },
  signal_pb3_ct_short_marginal: { id: "signal_pb3_ct_short_marginal", step: 6, signal: "CT SHORT", color: "#f6c90e", label: "PB3 CT SHORT — MARGINAL",       summary: "ADR exhausted, marginal R:R (1.5:1). Quarter size max. Quick scalp to VWAP only." },
  signal_pb3_range_long:        { id: "signal_pb3_range_long",        step: 6, signal: "CT LONG",  color: "#f6c90e", label: "PB3 RANGE FADE LONG",           summary: "Range market, fading from below VA back to POC. Half size. Stop below range low." },
  signal_pb3_range_short:       { id: "signal_pb3_range_short",       step: 6, signal: "CT SHORT", color: "#f6c90e", label: "PB3 RANGE FADE SHORT",          summary: "Range market, fading from above VA back to POC. Half size. Stop above range high." },

  // PB4 CT swing
  signal_pb4_swing_long:  { id: "signal_pb4_swing_long",  step: 6, signal: "SWING LONG",  color: "#4a9eff", label: "PB4 CT SWING LONG",  summary: "Major daily reversal at key support. Multi-day hold. 3:1+ R:R. Standard size. Stop below reversal low." },
  signal_pb4_swing_short: { id: "signal_pb4_swing_short", step: 6, signal: "SWING SHORT", color: "#4a9eff", label: "PB4 CT SWING SHORT", summary: "Major daily reversal at key resistance. Multi-day hold. 3:1+ R:R. Standard size. Stop above reversal high." },

  // No-trade signals
  signal_no_trade_chasing:   { id: "signal_no_trade_chasing",   step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE — CHASING",         summary: "Price is running without a pullback. Do not chase. Wait for a pullback to enter or find another setup." },
  signal_no_trade_weak:      { id: "signal_no_trade_weak",      step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE — WEAK SIGNAL",     summary: "Insufficient confirmation signals. Need at least 2 confluences. Sit on hands." },
  signal_no_trade_reject:    { id: "signal_no_trade_reject",    step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE — REJECTION",       summary: "Price is rejecting the setup level. The thesis is invalidated. Move on." },
  signal_no_trade_rr:        { id: "signal_no_trade_rr",        step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE — BAD R:R",         summary: "Risk:reward is below the minimum threshold. The math doesn't work. Pass." },
  signal_no_trade_chop:      { id: "signal_no_trade_chop",      step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE — CHOP",            summary: "Price is chopping around POC with no directional conviction. Wait for a break." },
  signal_no_trade_nosetup:   { id: "signal_no_trade_nosetup",   step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE — NO SETUP",        summary: "No valid playbook applies. ADR not exhausted, no swing level. Flat is a position." },
  signal_no_trade_noconfirm: { id: "signal_no_trade_noconfirm", step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE — NO CONFIRMATION", summary: "Setup was there but no reversal confirmation. Patience pays. Wait for the candle." },
  signal_no_trade_range:     { id: "signal_no_trade_range",     step: 6, signal: "NO TRADE", color: "#475569", label: "NO TRADE — INSIDE VA RANGE", summary: "Range market, opened inside VA. No edge. Wait for price to reach VA extremes." },
};

// ── COMPONENT ────────────────────────────────────────────────────────────────
export default function SignalsPanel() {
  const [currentId, setCurrentId] = useState("start");
  const [history, setHistory] = useState([]);

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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
      {/* Header */}
      <div style={{ textAlign: "center", paddingBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.14em", color: "#4a9eff", fontFamily: "'IBM Plex Mono', monospace" }}>
          MARKET STALKERS — SIGNALS PANEL
        </div>
        <div style={{ fontSize: 9, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginTop: 2 }}>
          Full decision engine · PB1 · PB2 · PB3 · PB4
        </div>
      </div>

      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, padding: "0 4px" }}>
        {STEPS.map((s, i) => {
          const done = i < activeStep;
          const active = i === activeStep;
          return (
            <div key={s} style={{ display: "flex", alignItems: "center", flex: 1 }}>
              <div style={{
                display: "flex", flexDirection: "column", alignItems: "center", flex: 1,
              }}>
                <div style={{
                  width: 18, height: 18, borderRadius: "50%",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 8, fontWeight: 700, fontFamily: "'IBM Plex Mono', monospace",
                  background: done ? "rgba(0,212,170,0.2)" : active ? "rgba(74,158,255,0.25)" : "rgba(255,255,255,0.05)",
                  color: done ? "#00d4aa" : active ? "#4a9eff" : "#334155",
                  border: `1px solid ${done ? "rgba(0,212,170,0.3)" : active ? "rgba(74,158,255,0.4)" : "rgba(255,255,255,0.08)"}`,
                }}>
                  {done ? "✓" : i + 1}
                </div>
                <span style={{
                  fontSize: 7, marginTop: 2, fontFamily: "'IBM Plex Mono', monospace",
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
            <div style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 6 }}>
              {node.question}
            </div>
            <div style={{ fontSize: 9, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1.5, marginBottom: 12 }}>
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
                    fontFamily: "'IBM Plex Mono', monospace",
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
            background: `rgba(0,0,0,0.4)`,
            border: `2px solid ${node.color}`,
            borderRadius: 8, padding: 18, textAlign: "center",
          }}>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
              color: node.color, fontFamily: "'IBM Plex Mono', monospace", marginBottom: 4,
            }}>
              SIGNAL
            </div>
            <div style={{
              fontSize: 20, fontWeight: 700, color: node.color,
              fontFamily: "'IBM Plex Mono', monospace", marginBottom: 4,
            }}>
              {node.signal}
            </div>
            <div style={{
              fontSize: 10, fontWeight: 600, color: "#e2e8f0",
              fontFamily: "'IBM Plex Mono', monospace", marginBottom: 10,
              letterSpacing: "0.06em",
            }}>
              {node.label}
            </div>
            <div style={{
              fontSize: 9, color: "#94a3b8", fontFamily: "'IBM Plex Mono', monospace",
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
            <div style={{ fontSize: 8, color: "#334155", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.1em", marginBottom: 4 }}>
              DECISION LOG
            </div>
            {history.map((h, i) => (
              <div key={i} style={{
                display: "flex", gap: 6, fontSize: 9,
                fontFamily: "'IBM Plex Mono', monospace",
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
            fontFamily: "'IBM Plex Mono', monospace",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 4, color: "#94a3b8", cursor: "pointer",
          }}>
            ← BACK
          </button>
        )}
        <button onClick={reset} style={{
          flex: 1, padding: "6px 0", fontSize: 9,
          fontFamily: "'IBM Plex Mono', monospace",
          fontWeight: 700, letterSpacing: "0.08em",
          background: isSignal ? `${node.color}22` : "rgba(255,77,109,0.1)",
          border: `1px solid ${isSignal ? node.color + "44" : "rgba(255,77,109,0.2)"}`,
          borderRadius: 4,
          color: isSignal ? node.color : "#ff4d6d",
          cursor: "pointer",
        }}>
          {isSignal ? "↻ NEW SIGNAL" : "↻ RESET"}
        </button>
      </div>
    </div>
  );
}
