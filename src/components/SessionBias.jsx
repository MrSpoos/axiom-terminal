import { useState, useEffect, useCallback } from "react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:3001";

const BIAS_COLORS = {
  BULLISH:  { color: "#00d4aa", bg: "rgba(0,212,170,0.12)",  border: "rgba(0,212,170,0.25)"  },
  BEARISH:  { color: "#ff4d6d", bg: "rgba(255,77,109,0.12)", border: "rgba(255,77,109,0.25)" },
  NEUTRAL:  { color: "#f6c90e", bg: "rgba(246,201,14,0.12)", border: "rgba(246,201,14,0.25)" },
};

const CONF_COLORS = {
  HIGH:   "#00d4aa",
  MEDIUM: "#f6c90e",
  LOW:    "#ff4d6d",
};

const SIZE_COLORS = {
  FULL:    "#00d4aa",
  REDUCED: "#f6c90e",
  FLAT:    "#ff4d6d",
};

const AGENT_META = {
  macro:     { label: "MACRO REGIME",           icon: "◈", accent: "#a78bfa" },
  technical: { label: "TECHNICAL STRUCTURE",    icon: "◐", accent: "#4a9eff" },
  flow:      { label: "ORDER FLOW",             icon: "◎", accent: "#00d4aa" },
  session:   { label: "SESSION PLAYBOOK",       icon: "◉", accent: "#f6c90e" },
};

const SYMBOLS = ["ES", "NQ", "DAX", "XAU", "OIL"];

// ── helpers ──────────────────────────────────────────────────────────────────

function BiasChip({ bias, size = "sm" }) {
  const c = BIAS_COLORS[bias] || BIAS_COLORS.NEUTRAL;
  const fs = size === "lg" ? 12 : 8;
  return (
    <span style={{
      fontSize: fs, fontWeight: 700,
      color: c.color, background: c.bg,
      border: `1px solid ${c.border}`,
      padding: size === "lg" ? "3px 10px" : "1px 6px",
      borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace",
      letterSpacing: "0.06em",
    }}>{bias || "—"}</span>
  );
}

function ConfidenceChip({ confidence }) {
  const col = CONF_COLORS[confidence] || "#64748b";
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, color: col,
      background: `${col}18`, padding: "1px 6px",
      borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace",
      letterSpacing: "0.04em",
    }}>{confidence}</span>
  );
}

function Field({ label, value, color, mono = true }) {
  if (value == null || value === "") return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 9, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{
        fontSize: 10, color: color || "#cbd5e1", textAlign: "right",
        fontFamily: mono ? "'IBM Plex Mono', monospace" : "'DM Sans', sans-serif",
      }}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "6px 0" }} />;
}

function GapBadge({ gap, gapPct }) {
  if (gap == null) return null;
  const up = gap >= 0;
  const color = up ? "#00d4aa" : "#ff4d6d";
  return (
    <span style={{
      fontSize: 9, color, background: `${color}18`,
      padding: "1px 6px", borderRadius: 3,
      fontFamily: "'IBM Plex Mono', monospace",
    }}>
      {up ? "▲" : "▼"} GAP {up ? "+" : ""}{gap?.toFixed(2)} ({up ? "+" : ""}{gapPct?.toFixed(2)}%)
    </span>
  );
}

function VaOpenChip({ vaOpen }) {
  const map = {
    "Above VAH":  { color: "#00d4aa", bg: "rgba(0,212,170,0.12)"  },
    "Inside VA":  { color: "#f6c90e", bg: "rgba(246,201,14,0.12)" },
    "Below VAL":  { color: "#ff4d6d", bg: "rgba(255,77,109,0.12)" },
  };
  const c = map[vaOpen] || { color: "#64748b", bg: "rgba(100,116,139,0.12)" };
  return (
    <span style={{
      fontSize: 8, fontWeight: 700, color: c.color, background: c.bg,
      padding: "1px 6px", borderRadius: 3,
      fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.04em",
    }}>{vaOpen || "—"}</span>
  );
}

// ── Context snapshot ──────────────────────────────────────────────────────────

function ContextPanel({ ctx, livePrice, pxConnected }) {
  if (!ctx) return null;
  const trendColor = ctx.trend === "UP" ? "#00d4aa" : ctx.trend === "DOWN" ? "#ff4d6d" : "#f6c90e";
  const displayPrice = (pxConnected && livePrice) ? livePrice : ctx.current_price;
  const priceSource = (pxConnected && livePrice) ? "PROJECTX" : ctx.price_source?.toUpperCase();
  return (
    <div style={{ background: "rgba(10,14,26,0.85)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "12px 14px" }}>
      {/* Price row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: "#e2e8f0", fontFamily: "'IBM Plex Mono', monospace" }}>
          {displayPrice?.toFixed(2)}
        </span>
        <GapBadge gap={ctx.gap} gapPct={ctx.gap_pct} />
        <VaOpenChip vaOpen={ctx.va_open} />
        <span style={{ fontSize: 8, fontWeight: 700, color: trendColor, background: `${trendColor}18`, padding: "1px 6px", borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.04em" }}>
          TREND {ctx.trend}
        </span>
        <span style={{ fontSize: 8, color: pxConnected && livePrice ? "#00d4aa" : "#475569", fontFamily: "'IBM Plex Mono', monospace", marginLeft: "auto" }}>
          src: {priceSource}
        </span>
      </div>

      {/* Data columns */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px 20px" }}>
        <Field label="PRIOR CLOSE" value={ctx.priorClose?.toFixed(2)} />
        <Field label="VAH" value={ctx.vah?.toFixed(2)} color="#00d4aa" />
        <Field label="D1 QHI" value={ctx.d1_qhi?.toFixed(2)} color="#a78bfa" />

        <Field label="OVERNIGHT H" value={ctx.overnightHigh?.toFixed(2) ?? "—"} color="#00d4aa" />
        <Field label="POC" value={ctx.poc?.toFixed(2)} color="#f6c90e" />
        <Field label="D1 QP" value={ctx.d1_qp?.toFixed(2)} color="#a78bfa" />

        <Field label="OVERNIGHT L" value={ctx.overnightLow?.toFixed(2) ?? "—"} color="#ff4d6d" />
        <Field label="VAL" value={ctx.val?.toFixed(2)} color="#ff4d6d" />
        <Field label="D1 QMID" value={ctx.d1_qmid?.toFixed(2)} color="#a78bfa" />

        <Field label="ATR(14)" value={ctx.atr14?.toFixed(2)} />
        <Field label="ADR(20)" value={ctx.adr20?.toFixed(2)} />
        <Field label="D1 QLO" value={ctx.d1_qlo?.toFixed(2)} color="#a78bfa" />
      </div>

      <Divider />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "4px 20px" }}>
        <Field label="VIX" value={ctx.vix != null ? `${ctx.vix} (${ctx.vix_chg >= 0 ? "+" : ""}${ctx.vix_chg})` : "—"}
          color={ctx.vix >= 25 ? "#ff4d6d" : ctx.vix >= 18 ? "#f6c90e" : "#00d4aa"} />
        <Field label="SESSION" value={ctx.session} />
        <Field label="TIME (ET)" value={ctx.current_time_et} />

        <Field label="GAP vs ATR" value={ctx.gap_vs_atr != null ? `${ctx.gap_vs_atr.toFixed(2)}x` : "—"} />
        <Field label="IB STATUS" value={ctx.ib_status} />
        <Field label="IB WINDOW" value={ctx.ib_window} />
      </div>
    </div>
  );
}

// ── Individual agent cards ────────────────────────────────────────────────────

function MacroCard({ data, idx }) {
  if (!data) return null;
  return (
    <AgentShell agentKey="macro" bias={data.bias} confidence={data.confidence} idx={idx}>
      <Field label="REGIME" value={data.regime} color={AGENT_META.macro.accent} />
      <Divider />
      {data.key_factors?.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 3 }}>KEY FACTORS</div>
          {data.key_factors.map((f, i) => (
            <div key={i} style={{ fontSize: 9, color: "#cbd5e1", fontFamily: "'IBM Plex Mono', monospace", paddingLeft: 8, lineHeight: 1.6 }}>· {f}</div>
          ))}
        </div>
      )}
      {data.vix_read && <ReasonLine label="VIX" text={data.vix_read} />}
      {data.overnight_read && <ReasonLine label="OVERNIGHT" text={data.overnight_read} />}
      {data.reasoning && <ReasonBlock text={data.reasoning} />}
    </AgentShell>
  );
}

function TechnicalCard({ data, idx }) {
  if (!data) return null;
  return (
    <AgentShell agentKey="technical" bias={data.bias} confidence={data.confidence} idx={idx}>
      <Field label="STRUCTURE" value={data.structure} color={AGENT_META.technical.accent} />
      <Field label="VA OPEN" value={data.va_open?.replace(/_/g, " ")} />
      <Field label="QP POSITION" value={data.qp_position} />
      <Divider />
      {data.gap_analysis && <ReasonLine label="GAP" text={data.gap_analysis} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 }}>
        {data.key_levels_above?.length > 0 && (
          <div>
            <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 2 }}>LEVELS ABOVE</div>
            {data.key_levels_above.map((l, i) => (
              <div key={i} style={{ fontSize: 10, color: "#00d4aa", fontFamily: "'IBM Plex Mono', monospace" }}>{l}</div>
            ))}
          </div>
        )}
        {data.key_levels_below?.length > 0 && (
          <div>
            <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 2 }}>LEVELS BELOW</div>
            {data.key_levels_below.map((l, i) => (
              <div key={i} style={{ fontSize: 10, color: "#ff4d6d", fontFamily: "'IBM Plex Mono', monospace" }}>{l}</div>
            ))}
          </div>
        )}
      </div>
      {data.reasoning && <ReasonBlock text={data.reasoning} />}
    </AgentShell>
  );
}

function FlowCard({ data, idx }) {
  if (!data) return null;
  return (
    <AgentShell agentKey="flow" bias={data.bias} confidence={data.confidence} idx={idx}>
      <Field label="POSITIONING" value={data.positioning} color={AGENT_META.flow.accent} />
      <Divider />
      {data.trapped_traders && <ReasonLine label="TRAPPED" text={data.trapped_traders} />}
      {data.ib_expectation && <ReasonLine label="IB EXPECT" text={data.ib_expectation} />}
      {(data.stop_clusters?.above?.length > 0 || data.stop_clusters?.below?.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 }}>
          {data.stop_clusters?.above?.length > 0 && (
            <div>
              <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 2 }}>STOPS ABOVE</div>
              {data.stop_clusters.above.map((l, i) => (
                <div key={i} style={{ fontSize: 10, color: "#00d4aa", fontFamily: "'IBM Plex Mono', monospace" }}>{l}</div>
              ))}
            </div>
          )}
          {data.stop_clusters?.below?.length > 0 && (
            <div>
              <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 2 }}>STOPS BELOW</div>
              {data.stop_clusters.below.map((l, i) => (
                <div key={i} style={{ fontSize: 10, color: "#ff4d6d", fontFamily: "'IBM Plex Mono', monospace" }}>{l}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {data.adr_capacity && (
        <div style={{ marginTop: 6 }}>
          <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 3 }}>ADR CAPACITY</div>
          <div style={{ display: "flex", gap: 12 }}>
            <span style={{ fontSize: 9, color: "#00d4aa", fontFamily: "'IBM Plex Mono', monospace" }}>▲ {data.adr_capacity.upside_pct}%</span>
            <span style={{ fontSize: 9, color: "#ff4d6d", fontFamily: "'IBM Plex Mono', monospace" }}>▼ {data.adr_capacity.downside_pct}%</span>
          </div>
        </div>
      )}
      {data.reasoning && <ReasonBlock text={data.reasoning} />}
    </AgentShell>
  );
}

function SessionCard({ data, idx }) {
  if (!data) return null;
  const PB_COLORS = { PB1: "#4a9eff", PB2: "#a78bfa", PB3: "#f6c90e", PB4: "#f472b6", NONE: "#475569" };
  return (
    <AgentShell agentKey="session" bias={data.bias} confidence={data.confidence} idx={idx}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        {data.primary_playbook && (
          <span style={{ fontSize: 10, fontWeight: 700, color: PB_COLORS[data.primary_playbook] || "#4a9eff", background: `${PB_COLORS[data.primary_playbook] || "#4a9eff"}20`, padding: "2px 8px", borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace" }}>
            PRIMARY: {data.primary_playbook}
          </span>
        )}
        {data.secondary_playbook && data.secondary_playbook !== "NONE" && (
          <span style={{ fontSize: 10, fontWeight: 700, color: PB_COLORS[data.secondary_playbook] || "#64748b", background: `${PB_COLORS[data.secondary_playbook] || "#64748b"}18`, padding: "2px 8px", borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace" }}>
            ALT: {data.secondary_playbook}
          </span>
        )}
        {data.day_type_expectation && (
          <span style={{ fontSize: 8, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace" }}>{data.day_type_expectation}</span>
        )}
      </div>
      <Divider />
      {data.entry_windows?.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 2 }}>ENTRY WINDOWS</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {data.entry_windows.map((w, i) => (
              <span key={i} style={{ fontSize: 9, color: "#4a9eff", background: "rgba(74,158,255,0.08)", padding: "1px 6px", borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace" }}>{w}</span>
            ))}
          </div>
        </div>
      )}
      {data.watch_for?.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 2 }}>WATCH FOR</div>
          {data.watch_for.map((w, i) => (
            <div key={i} style={{ fontSize: 9, color: "#00d4aa", fontFamily: "'IBM Plex Mono', monospace", paddingLeft: 8, lineHeight: 1.6 }}>✓ {w}</div>
          ))}
        </div>
      )}
      {data.avoid?.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 2 }}>AVOID</div>
          {data.avoid.map((a, i) => (
            <div key={i} style={{ fontSize: 9, color: "#ff4d6d", fontFamily: "'IBM Plex Mono', monospace", paddingLeft: 8, lineHeight: 1.6 }}>✕ {a}</div>
          ))}
        </div>
      )}
      {data.reasoning && <ReasonBlock text={data.reasoning} />}
    </AgentShell>
  );
}

// ── Agent shell wrapper ───────────────────────────────────────────────────────

function AgentShell({ agentKey, bias, confidence, idx, children }) {
  const meta = AGENT_META[agentKey];
  const biasC = BIAS_COLORS[bias] || BIAS_COLORS.NEUTRAL;
  return (
    <div style={{
      background: "rgba(10,14,26,0.85)",
      border: `1px solid rgba(255,255,255,0.08)`,
      borderTop: `2px solid ${meta.accent}`,
      borderRadius: 8, padding: "12px 14px",
      animation: `biasFadeIn 0.4s ease both`,
      animationDelay: `${idx * 0.12}s`,
    }}>
      {/* Agent header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 14, color: meta.accent }}>{meta.icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: meta.accent, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.08em", flex: 1 }}>{meta.label}</span>
        <BiasChip bias={bias} />
        <ConfidenceChip confidence={confidence} />
      </div>
      {children}
    </div>
  );
}

// ── Synthesis card ────────────────────────────────────────────────────────────

function SynthesisCard({ data }) {
  if (!data) return null;
  const biasC = BIAS_COLORS[data.composite_bias] || BIAS_COLORS.NEUTRAL;
  const sizeColor = SIZE_COLORS[data.size_recommendation] || "#64748b";
  const total = (data.agent_agreement?.bullish_count || 0) + (data.agent_agreement?.bearish_count || 0) + (data.agent_agreement?.neutral_count || 0);

  return (
    <div style={{
      background: "rgba(10,14,26,0.9)",
      border: `1px solid ${biasC.border}`,
      borderRadius: 8, padding: "16px 18px",
      animation: "biasFadeIn 0.5s ease both",
      animationDelay: "0.55s",
      position: "relative", overflow: "hidden",
    }}>
      {/* Subtle glow */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${biasC.color}, transparent)` }} />

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.1em" }}>◈ SYNTHESIS</span>
        <BiasChip bias={data.composite_bias} size="lg" />
        <ConfidenceChip confidence={data.confidence} />
        {data.size_recommendation && (
          <span style={{ fontSize: 9, fontWeight: 700, color: sizeColor, background: `${sizeColor}18`, padding: "2px 8px", borderRadius: 3, fontFamily: "'IBM Plex Mono', monospace", marginLeft: "auto" }}>
            SIZE: {data.size_recommendation}
          </span>
        )}
      </div>

      {/* Bias statement */}
      {data.bias_statement && (
        <div style={{ fontSize: 12, color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5, marginBottom: 12, padding: "8px 12px", background: `${biasC.bg}`, borderRadius: 6, borderLeft: `3px solid ${biasC.color}` }}>
          {data.bias_statement}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px", marginBottom: 10 }}>
        {/* Agent vote tally */}
        {data.agent_agreement && (
          <div>
            <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 4 }}>AGENT VOTES ({total})</div>
            <div style={{ display: "flex", gap: 8 }}>
              <span style={{ fontSize: 10, color: "#00d4aa", fontFamily: "'IBM Plex Mono', monospace" }}>▲ {data.agent_agreement.bullish_count}</span>
              <span style={{ fontSize: 10, color: "#ff4d6d", fontFamily: "'IBM Plex Mono', monospace" }}>▼ {data.agent_agreement.bearish_count}</span>
              <span style={{ fontSize: 10, color: "#f6c90e", fontFamily: "'IBM Plex Mono', monospace" }}>— {data.agent_agreement.neutral_count}</span>
            </div>
            {/* Vote bar */}
            <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", marginTop: 4, gap: 1 }}>
              {data.agent_agreement.bullish_count > 0 && (
                <div style={{ flex: data.agent_agreement.bullish_count, background: "#00d4aa", borderRadius: 2 }} />
              )}
              {data.agent_agreement.neutral_count > 0 && (
                <div style={{ flex: data.agent_agreement.neutral_count, background: "#f6c90e", borderRadius: 2 }} />
              )}
              {data.agent_agreement.bearish_count > 0 && (
                <div style={{ flex: data.agent_agreement.bearish_count, background: "#ff4d6d", borderRadius: 2 }} />
              )}
            </div>
          </div>
        )}

        {/* Key levels */}
        <div>
          <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 4 }}>KEY LEVELS</div>
          {data.key_level_bull != null && (
            <div style={{ fontSize: 10, color: "#00d4aa", fontFamily: "'IBM Plex Mono', monospace" }}>▲ BULL: {data.key_level_bull}</div>
          )}
          {data.key_level_bear != null && (
            <div style={{ fontSize: 10, color: "#ff4d6d", fontFamily: "'IBM Plex Mono', monospace" }}>▼ BEAR: {data.key_level_bear}</div>
          )}
        </div>
      </div>

      <Divider />

      {/* Primary risk */}
      {data.primary_risk && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 2 }}>PRIMARY RISK</div>
          <div style={{ fontSize: 10, color: "#ff4d6d", background: "rgba(255,77,109,0.06)", padding: "4px 8px", borderRadius: 4, fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1.5 }}>
            ⚠ {data.primary_risk}
          </div>
        </div>
      )}

      {/* Session plan */}
      {data.session_plan && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 4 }}>SESSION PLAN</div>
          <div style={{ fontSize: 11, color: "#cbd5e1", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.6 }}>
            {data.session_plan}
          </div>
        </div>
      )}

      {/* Conflicts */}
      {data.conflicts?.length > 0 && (
        <div>
          <div style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 2 }}>CONFLICTS NOTED</div>
          {data.conflicts.map((c, i) => (
            <div key={i} style={{ fontSize: 9, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace", paddingLeft: 8, lineHeight: 1.6 }}>· {c}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared text blocks ────────────────────────────────────────────────────────

function ReasonLine({ label, text }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <span style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace" }}>{label}: </span>
      <span style={{ fontSize: 9, color: "#94a3b8", fontFamily: "'IBM Plex Mono', monospace", lineHeight: 1.5 }}>{text}</span>
    </div>
  );
}

function ReasonBlock({ text }) {
  return (
    <div style={{ marginTop: 8, fontSize: 10, color: "#94a3b8", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.6, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 8 }}>
      {text}
    </div>
  );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function AgentSkeleton({ label, idx }) {
  return (
    <div style={{
      background: "rgba(10,14,26,0.85)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 8, padding: "12px 14px",
      animation: "biasFadeIn 0.3s ease both",
      animationDelay: `${idx * 0.08}s`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ width: 14, height: 14, borderRadius: "50%", background: "rgba(255,255,255,0.06)", animation: "biasPulse 1.5s infinite", animationDelay: `${idx * 0.2}s` }} />
        <div style={{ height: 10, width: 120, background: "rgba(255,255,255,0.06)", borderRadius: 3, animation: "biasPulse 1.5s infinite", animationDelay: `${idx * 0.2 + 0.1}s` }} />
        <div style={{ height: 18, width: 60, background: "rgba(255,255,255,0.06)", borderRadius: 3, animation: "biasPulse 1.5s infinite", animationDelay: `${idx * 0.2 + 0.2}s`, marginLeft: "auto" }} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {[80, 100, 65, 90].map((w, i) => (
          <div key={i} style={{ height: 8, width: `${w}%`, background: "rgba(255,255,255,0.04)", borderRadius: 2, animation: "biasPulse 1.5s infinite", animationDelay: `${idx * 0.2 + i * 0.1}s` }} />
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 9, color: "#334155", fontFamily: "'IBM Plex Mono', monospace", textAlign: "center" }}>
        {label} · ANALYSING…
      </div>
    </div>
  );
}

// ── Error card ────────────────────────────────────────────────────────────────

function AgentError({ agentKey, message }) {
  const meta = AGENT_META[agentKey];
  return (
    <div style={{ background: "rgba(255,77,109,0.05)", border: "1px solid rgba(255,77,109,0.15)", borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#ff4d6d", fontFamily: "'IBM Plex Mono', monospace", marginBottom: 4 }}>
        {meta?.icon} {meta?.label} · FAILED
      </div>
      <div style={{ fontSize: 9, color: "#64748b", fontFamily: "'IBM Plex Mono', monospace" }}>{message}</div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SessionBias({ symbolLivePrices, pxConnected }) {
  const [symbol, setSymbol] = useState("ES");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [error, setError] = useState(null);

  const fetchBias = useCallback(async (sym, livePrice) => {
    setLoading(true);
    setError(null);
    try {
      const lpParam = livePrice ? `&livePrice=${livePrice}` : "";
      const res = await fetch(`${BACKEND_URL}/api/session-bias?symbol=${sym}${lpParam}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "API error");
      setData(json);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount / symbol change — pass live price if available
  useEffect(() => {
    const lp = symbolLivePrices?.[symbol];
    fetchBias(symbol, lp);
  }, [fetchBias, symbol, symbolLivePrices, pxConnected]);

  const agents = data?.agents || {};
  const synthesis = data?.synthesis || null;
  const ctx = data?.context || null;
  const agentErrors = data?.errors || {};

  const agentOrder = ["macro", "technical", "flow", "session"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}>

      {/* Keyframes */}
      <style>{`
        @keyframes biasFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes biasPulse  { 0%,100% { opacity: 0.4; } 50% { opacity: 0.8; } }
        @keyframes biasGlow   { 0%,100% { box-shadow: 0 0 8px rgba(0,212,170,0.2); } 50% { box-shadow: 0 0 16px rgba(0,212,170,0.4); } }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.08em" }}>SESSION BIAS</span>
          <span style={{ fontSize: 8, color: "#475569", fontFamily: "'IBM Plex Mono', monospace" }}>4-AGENT SYNTHESIS</span>
          {pxConnected
            ? <span style={{ fontSize: 7, fontWeight: 700, color: "#00d4aa", background: "rgba(0,212,170,0.12)", padding: "1px 6px", borderRadius: 2, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.04em" }}>● LIVE</span>
            : <span style={{ fontSize: 7, fontWeight: 700, color: "#f6c90e", background: "rgba(246,201,14,0.12)", padding: "1px 6px", borderRadius: 2, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.04em" }}>DELAYED</span>
          }
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Symbol selector */}
          <div style={{ display: "flex", gap: 2, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 5, padding: 2 }}>
            {SYMBOLS.map(s => (
              <button
                key={s}
                onClick={() => setSymbol(s)}
                disabled={loading}
                style={{
                  fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 3, cursor: loading ? "wait" : "pointer",
                  fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.04em", border: "none",
                  color: symbol === s ? "#0a0e1a" : "#475569",
                  background: symbol === s ? "#4a9eff" : "transparent",
                  transition: "all 0.15s ease",
                }}
              >{s}</button>
            ))}
          </div>

          {lastUpdated && (
            <span style={{ fontSize: 9, color: "#475569", fontFamily: "'IBM Plex Mono', monospace" }}>
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={() => fetchBias(symbol, symbolLivePrices?.[symbol])}
            disabled={loading}
            style={{ fontSize: 9, color: "#4a9eff", background: "none", border: "1px solid rgba(74,158,255,0.2)", borderRadius: 3, padding: "2px 8px", cursor: loading ? "wait" : "pointer", fontFamily: "'IBM Plex Mono', monospace", opacity: loading ? 0.5 : 1 }}
          >{loading ? "⟳ …" : "↻ REFRESH"}</button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{ background: "rgba(255,77,109,0.08)", border: "1px solid rgba(255,77,109,0.2)", borderRadius: 6, padding: "6px 10px", fontSize: 10, color: "#ff4d6d", fontFamily: "'IBM Plex Mono', monospace" }}>
          ✕ {error}
        </div>
      )}

      {/* ── Live price preview (shows before first fetch completes) ── */}
      {!data && pxConnected && symbolLivePrices?.[symbol] && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", background: "rgba(0,212,170,0.06)", border: "1px solid rgba(0,212,170,0.15)", borderRadius: 6 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: "#e2e8f0", fontFamily: "'IBM Plex Mono', monospace" }}>{symbolLivePrices[symbol].toFixed(2)}</span>
          <span style={{ fontSize: 8, color: "#00d4aa", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: "0.06em" }}>● LIVE · {symbol}</span>
          <span style={{ fontSize: 9, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", marginLeft: "auto" }}>loading analysis…</span>
        </div>
      )}

      {/* ── Initial loading splash ── */}
      {loading && !data && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 40, gap: 12 }}>
          <div style={{ position: "relative", width: 40, height: 40 }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid rgba(74,158,255,0.15)" }} />
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid transparent", borderTopColor: "#4a9eff", animation: "biasGlow 1.5s linear infinite" }} />
          </div>
          <div style={{ fontSize: 11, color: "#475569", fontFamily: "'IBM Plex Mono', monospace", textAlign: "center" }}>
            Fetching {symbol} data + firing 4 agents in parallel…
          </div>
          {/* Skeleton cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10, width: "100%", marginTop: 8 }}>
            {agentOrder.map((k, i) => <AgentSkeleton key={k} label={AGENT_META[k].label} idx={i} />)}
          </div>
        </div>
      )}

      {/* ── Main content ── */}
      {data && (
        <>
          {/* Context snapshot */}
          <ContextPanel ctx={ctx} livePrice={symbolLivePrices?.[symbol]} pxConnected={pxConnected} />

          {/* Refresh loading bar */}
          {loading && (
            <div style={{ height: 2, background: "rgba(74,158,255,0.1)", borderRadius: 1, overflow: "hidden" }}>
              <div style={{ height: "100%", background: "#4a9eff", animation: "loadbar 1.4s ease infinite" }} />
            </div>
          )}

          {/* ── Agent cards 2×2 grid ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 10 }}>
            {agentOrder.map((key, idx) => {
              if (agentErrors[key]) return <AgentError key={key} agentKey={key} message={agentErrors[key]} />;
              const d = agents[key];
              if (!d) return null;
              if (key === "macro")     return <MacroCard     key={key} data={d} idx={idx} />;
              if (key === "technical") return <TechnicalCard key={key} data={d} idx={idx} />;
              if (key === "flow")      return <FlowCard      key={key} data={d} idx={idx} />;
              if (key === "session")   return <SessionCard   key={key} data={d} idx={idx} />;
              return null;
            })}
          </div>

          {/* ── Synthesis card (full-width) ── */}
          {(synthesis || agentErrors.synthesizer) && (
            <div style={{ marginTop: 2 }}>
              {agentErrors.synthesizer ? (
                <div style={{ background: "rgba(255,77,109,0.05)", border: "1px solid rgba(255,77,109,0.15)", borderRadius: 8, padding: "12px 14px", fontSize: 10, color: "#ff4d6d", fontFamily: "'IBM Plex Mono', monospace" }}>
                  ◈ SYNTHESIS FAILED · {agentErrors.synthesizer}
                </div>
              ) : (
                <SynthesisCard data={synthesis} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
