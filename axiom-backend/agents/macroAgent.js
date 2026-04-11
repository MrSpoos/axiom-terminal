// ── Macro / Catalyst Agent ────────────────────────────────────────────────────
// Fetches the economic calendar and classifies event risk for active instruments.
// Uses Forex Factory public JSON + FOMC schedule awareness.
// Returns structured JSON per the Axiom agent schema.

const fetch = require('node-fetch');

const SYSTEM_PROMPT = `You are the Macro/Catalyst Agent for the Axiom Terminal, a professional futures trading platform.

Your sole job: assess whether any scheduled economic events in the next 48 hours create meaningful risk for futures trading setups on ES, NQ, GC, or CL.

You receive a list of upcoming economic calendar events. Analyse them and output a structured risk assessment.

CLASSIFICATION RULES:
- event_risk_level "extreme": FOMC rate decision, CPI, NFP, GDP advance estimate — market-moving releases that can gap instruments 20+ points
- event_risk_level "high": PPI, PCE, Retail Sales, ISM, JOLTS, Fed Chair speech, Treasury auctions >$40B
- event_risk_level "medium": Jobless Claims, Housing data, regional Fed surveys, minor Fed speak
- event_risk_level "low": No significant events, or only low-impact foreign data
- event_risk_level "none": No events in the next 48 hours

SETUP VERDICT:
- "clear": No high/extreme events in the next 6 hours — setups can be taken normally
- "caution": High event within 2 hours or extreme event within 6 hours — reduce size, tighten stops
- "avoid": Extreme event within 2 hours — do not initiate new positions

Respond ONLY with valid JSON, no markdown, no code fences:
{
  "agent_id": "macro_catalyst",
  "timestamp": "<ISO8601>",
  "event_risk_level": "none|low|medium|high|extreme",
  "next_event": {
    "name": "<event name or null>",
    "time_et": "<HH:MM ET or null>",
    "time_until_hours": <number or null>,
    "expected_impact": "<brief description or null>"
  },
  "events_next_48h": [
    { "name": "<string>", "time_et": "<string>", "impact": "low|medium|high|extreme", "currency": "<USD/EUR/etc>" }
  ],
  "setup_verdict": "clear|caution|avoid",
  "thesis": "<1-2 sentence plain English summary of macro risk environment>",
  "confidence": <0-100>
}`;

// Forex Factory public calendar (no auth, updated weekly)
const FF_CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

// High-impact keywords that override FF impact rating
const EXTREME_KEYWORDS = /\b(fomc|fed rate|interest rate decision|cpi|nonfarm|nfp|gdp advance|gdp preliminary)\b/i;
const HIGH_KEYWORDS = /\b(ppi|pce|retail sales|ism manufacturing|ism services|jolts|powell|fed chair|yellen|treasury auction)\b/i;

async function fetchCalendar() {
  const r = await fetch(FF_CALENDAR_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    timeout: 8000,
  });
  if (!r.ok) throw new Error(`FF calendar HTTP ${r.status}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

function classifyImpact(event) {
  const title = (event.title || event.name || '').toLowerCase();
  const ffImpact = (event.impact || '').toLowerCase();
  if (EXTREME_KEYWORDS.test(title)) return 'extreme';
  if (HIGH_KEYWORDS.test(title)) return 'high';
  if (ffImpact === 'high') return 'high';
  if (ffImpact === 'medium') return 'medium';
  return 'low';
}

function getEtTime(event) {
  // FF calendar returns date field as ISO string
  if (!event.date) return null;
  const d = new Date(event.date);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function hoursUntil(event) {
  if (!event.date) return null;
  const d = new Date(event.date);
  if (isNaN(d.getTime())) return null;
  return +((d - Date.now()) / 3600000).toFixed(1);
}

async function runMacroAgent(anthropicKey) {
  // 1. Fetch calendar
  let events = [];
  try {
    const raw = await fetchCalendar();
    const now = Date.now();
    const cutoff = now + 48 * 3600000;
    events = raw
      .filter(e => {
        if (!e.date) return false;
        const t = new Date(e.date).getTime();
        return t >= now && t <= cutoff && (e.currency === 'USD' || e.currency === 'EUR');
      })
      .map(e => ({
        name: e.title || e.name || 'Unknown',
        time_et: getEtTime(e),
        time_until_hours: hoursUntil(e),
        impact: classifyImpact(e),
        currency: e.currency || 'USD',
      }))
      .sort((a, b) => (a.time_until_hours ?? 999) - (b.time_until_hours ?? 999));
  } catch (err) {
    console.warn('Macro agent: calendar fetch failed:', err.message);
    // Continue with empty calendar — Claude will note the gap
  }

  // 2. Build user prompt
  const calendarText = events.length > 0
    ? events.map(e => `- ${e.name} [${e.impact.toUpperCase()}] at ${e.time_et} ET (in ${e.time_until_hours}h) — ${e.currency}`).join('\n')
    : 'No calendar data available (fetch failed or no USD/EUR events this week)';

  const userPrompt = `Current time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour12: false })} ET

UPCOMING ECONOMIC EVENTS (next 48 hours):
${calendarText}

Active instruments: ES (S&P 500 futures), NQ (Nasdaq futures), GC (Gold futures), CL (Crude Oil futures)

Assess the macro/catalyst risk environment and return your JSON analysis.`;

  // 3. Call Claude
  const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    throw new Error(`Anthropic macro agent error ${aiRes.status}: ${err}`);
  }

  const aiData = await aiRes.json();
  const text = (aiData?.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error(`Macro agent JSON parse failed: ${text.slice(0, 200)}`);
  }

  // Attach raw calendar for frontend transparency
  result._raw_events = events;
  result.timestamp = new Date().toISOString();
  return result;
}

module.exports = { runMacroAgent };
