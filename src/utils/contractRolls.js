// ── Futures Contract Roll Schedule ────────────────────────────────────────────
// Update this file each roll cycle.
// Roll date = when to switch subscription (volume shifts to next contract).
// Expiry date = actual last trading day.
//
// Month codes: F=Jan G=Feb H=Mar J=Apr K=May M=Jun N=Jul Q=Aug U=Sep V=Oct X=Nov Z=Dec

export const CONTRACT_ROLLS = [
  {
    instrument: "CL",
    current:    "CON.F.US.CL.K26",   // May 2026
    next:       "CON.F.US.CL.M26",   // June 2026
    rollDate:   "2026-04-17",         // Roll by Apr 17 — volume shifts before Apr 22 expiry
    expiryDate: "2026-04-22",         // CL May 2026 last trading day
    label:      "Crude Oil May→Jun",
  },
  {
    instrument: "GC",
    current:    "CON.F.US.GC.M26",   // June 2026
    next:       "CON.F.US.GC.Q26",   // August 2026
    rollDate:   "2026-05-22",         // Roll by May 22 — ahead of first notice May 29
    expiryDate: "2026-05-29",         // GC June 2026 first notice day
    label:      "Gold Jun→Aug",
  },
  {
    instrument: "ES",
    current:    "CON.F.US.EP.M26",   // June 2026
    next:       "CON.F.US.EP.U26",   // September 2026
    rollDate:   "2026-06-12",         // Roll by Jun 12 — 1 week before expiry
    expiryDate: "2026-06-19",         // ES June 2026 expiry (3rd Friday)
    label:      "ES Jun→Sep",
  },
  {
    instrument: "NQ",
    current:    "CON.F.US.ENQ.M26",  // June 2026
    next:       "CON.F.US.ENQ.U26",  // September 2026
    rollDate:   "2026-06-12",
    expiryDate: "2026-06-19",
    label:      "NQ Jun→Sep",
  },
];

// Returns all rolls sorted by urgency (soonest first)
// Each entry includes daysToRoll and urgency level
export function getUpcomingRolls() {
  const now = Date.now();
  return CONTRACT_ROLLS
    .map(roll => {
      const rollMs   = new Date(roll.rollDate).getTime();
      const expiryMs = new Date(roll.expiryDate).getTime();
      const daysToRoll   = Math.ceil((rollMs - now)   / 86400000);
      const daysToExpiry = Math.ceil((expiryMs - now) / 86400000);
      const urgency =
        daysToRoll <= 0  ? "expired"  :
        daysToRoll <= 5  ? "critical" :
        daysToRoll <= 14 ? "warning"  : "ok";
      return { ...roll, daysToRoll, daysToExpiry, urgency };
    })
    .filter(r => r.daysToExpiry > -3)        // hide 3 days after expiry
    .sort((a, b) => a.daysToRoll - b.daysToRoll);
}

// Returns only rolls that need a visible reminder
export function getActiveReminders() {
  return getUpcomingRolls().filter(r => r.urgency !== "ok");
}
