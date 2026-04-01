import { useState, useEffect, useRef, useCallback } from "react";


const API_BASE = process.env.REACT_APP_API_URL || "https://axiom-terminal-production.up.railway.app";


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

