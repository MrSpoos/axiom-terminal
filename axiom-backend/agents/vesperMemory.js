// ── Vesper Memory ─────────────────────────────────────────────────────────────
// Persists Vesper's learnings across sessions.
// Stored as JSON on the Railway filesystem (same pattern as trade journal).

const fs   = require('fs');
const path = require('path');

const MEMORY_PATH = process.env.VESPER_MEMORY_PATH
  || path.join(__dirname, '..', 'vesper_memory.json');

const DEFAULT_MEMORY = {
  learnings:   [],   // [{ date, insight, confidence, tags, source }]
  performance: { total_sessions: 0, accurate_bias: 0, notes: [] },
  last_updated: null,
};

function readMemory() {
  try {
    if (fs.existsSync(MEMORY_PATH)) {
      return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
    }
  } catch (e) { console.warn('Vesper memory read error:', e.message); }
  return { ...DEFAULT_MEMORY };
}

function writeMemory(memory) {
  try {
    memory.last_updated = new Date().toISOString();
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2));
    return true;
  } catch (e) { console.error('Vesper memory write error:', e.message); return false; }
}

// Returns the last N learnings formatted for Vesper's context
function getMemoryContext(n = 10) {
  const memory = readMemory();
  const recent = memory.learnings.slice(-n);
  if (recent.length === 0) return '';
  const lines = recent.map(l =>
    `[${l.date}] ${l.insight}${l.confidence ? ` (confidence: ${Math.round(l.confidence * 100)}%)` : ''}`
  );
  return `VESPER LEARNED INSIGHTS (from past sessions):\n${lines.join('\n')}`;
}

module.exports = { readMemory, writeMemory, getMemoryContext };
