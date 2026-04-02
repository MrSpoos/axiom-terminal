import { useState, useEffect } from "react";
import { getActiveReminders } from "../utils/contractRolls";

const URGENCY_STYLE = {
  critical: { bg: "rgba(255,77,109,0.12)", border: "rgba(255,77,109,0.5)", dot: "#ff4d6d", text: "#ff4d6d", label: "ROLL NOW" },
  warning:  { bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.4)", dot: "#f59e0b", text: "#f59e0b", label: "ROLL SOON" },
  expired:  { bg: "rgba(255,77,109,0.18)", border: "rgba(255,77,109,0.7)", dot: "#ff4d6d", text: "#ff4d6d", label: "EXPIRED" },
};

const DISMISS_KEY = "axiom_roll_dismissed";

function getDismissed() {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}"); } catch { return {}; }
}
function dismiss(instrument) {
  const d = getDismissed();
  d[instrument] = new Date().toDateString(); // dismiss for today only
  localStorage.setItem(DISMISS_KEY, JSON.stringify(d));
}
function isDismissed(instrument) {
  const d = getDismissed();
  return d[instrument] === new Date().toDateString();
}

export default function RollReminder() {
  const [reminders, setReminders] = useState([]);
  const [dismissed, setDismissed] = useState({});

  useEffect(() => {
    const update = () => {
      setReminders(getActiveReminders());
      setDismissed(getDismissed());
    };
    update();
    const t = setInterval(update, 60 * 60 * 1000); // refresh hourly
    return () => clearInterval(t);
  }, []);

  const visible = reminders.filter(r => !isDismissed(r.instrument));
  if (visible.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {visible.map(roll => {
        const s = URGENCY_STYLE[roll.urgency] || URGENCY_STYLE.warning;
        return (
          <div key={roll.instrument}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px 3px 6px", borderRadius: 4, background: s.bg, border: `1px solid ${s.border}`, fontFamily: "'IBM Plex Mono', monospace" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, flexShrink: 0,
              animation: roll.urgency === "critical" ? "pulse 1s ease-in-out infinite" : "none" }} />
            <span style={{ fontSize: 9, color: s.text, fontWeight: 700, letterSpacing: "0.06em" }}>{s.label}</span>
            <span style={{ fontSize: 9, color: "#94a3b8" }}>{roll.label}</span>
            <span style={{ fontSize: 9, color: s.text }}>
              {roll.urgency === "expired" ? "EXPIRED" : `${roll.daysToRoll}d`}
            </span>
            <button onClick={() => { dismiss(roll.instrument); setDismissed(getDismissed()); }}
              title={`New ID: ${roll.next}`}
              style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 10, padding: "0 2px", lineHeight: 1 }}>
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
