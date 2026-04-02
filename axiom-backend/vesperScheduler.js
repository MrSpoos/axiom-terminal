// ── Vesper Pre-Market Brief + Performance Tracker ────────────────────────────
// 1. Pre-market scheduler: fires at 9:25 AM ET Mon-Fri, runs full analysis,
//    writes morning brief to memory so Vesper is briefed before market open.
// 2. Performance tracker: records Vesper's arbiter calls vs actual outcomes,
//    exposes /api/vesper/stats for playbook + instrument hit-rate tracking.
//
// Mount in server.js: require('./vesperScheduler')(app, ANTHROPIC_KEY);

const fetch = require('node-fetch');
const { readMemory, writeMemory } = require('./agents/vesperMemory');
const { runMacroAgent }        = require('./agents/macroAgent');
const { runCorrelationAgent }  = require('./agents/correlationAgent');
const { runSessionAgent }      = require('./agents/sessionAgent');
const { runTrapAgent }         = require('./agents/trapAgent');
const { runDevilsAdvocateAgent } = require('./agents/devilsAdvocateAgent');
const { runBearCaseAgent }     = require('./agents/bearCaseAgent');
const { runArbiterAgent }      = require('./agents/arbiterAgent');

// ── Pre-market brief ──────────────────────────────────────────────────────────
async function runPreMarketBrief(anthropicKey, backendUrl) {
  const instruments = ['ES', 'NQ'];
  console.log('◈ Vesper pre-market brief starting...');
  const briefs = [];

  for (const inst of instruments) {
    try {
      // Tier 1 in parallel
      const [macroR, corrR, sessionR, trapR] = await Promise.allSettled([
        runMacroAgent(anthropicKey),
        runCorrelationAgent(inst, anthropicKey),
        runSessionAgent(inst, null, anthropicKey),
        runTrapAgent(inst, null, anthropicKey),
      ]);
      const tier1 = {
        macro:       macroR.status   === 'fulfilled' ? macroR.value   : { error: macroR.reason?.message },
        correlation: corrR.status    === 'fulfilled' ? corrR.value    : { error: corrR.reason?.message },
        session:     sessionR.status === 'fulfilled' ? sessionR.value : { error: sessionR.reason?.message },
        trap:        trapR.status    === 'fulfilled' ? trapR.value    : { error: trapR.reason?.message },
      };

      // Tier 2
      const [daR, bcR] = await Promise.allSettled([
        runDevilsAdvocateAgent(inst, tier1, anthropicKey),
        runBearCaseAgent(inst, tier1, anthropicKey),
      ]);
      const allResults = {
        ...tier1,
        devilsAdvocate: daR.status === 'fulfilled' ? daR.value : { error: daR.reason?.message },
        bearCase:       bcR.status === 'fulfilled' ? bcR.value : { error: bcR.reason?.message },
      };

      // Tier 3 — Arbiter
      const arbiter = await runArbiterAgent(inst, allResults, anthropicKey);

      // Try to get GEX levels
      let gex = null;
      try {
        const gexR = await fetch(`${backendUrl}/api/gex/enhanced`);
        const gexD = await gexR.json();
        if (gexD.success) gex = gexD;
      } catch {}

      const brief = {
        instrument:  inst,
        arbiter_gate: arbiter.alert_gate,
        bull_pct:    arbiter.bull_pct,
        bear_pct:    arbiter.bear_pct,
        confidence:  arbiter.confidence_tier,
        narrative:   arbiter.dominant_narrative,
        synthesis:   arbiter.synthesis,
        macro_risk:  tier1.macro?.event_risk_level,
        correlation: tier1.correlation?.alignment,
        tailwind:    tier1.correlation?.tailwind_score,
        trap_risk:   tier1.trap?.trap_risk,
        gex_flip:    gex?.gamma_flip || null,
        gex_call:    gex?.call_wall  || null,
        gex_put:     gex?.put_wall   || null,
        gex_regime:  gex?.regime     || null,
        key_factors: arbiter.key_factors?.slice(0, 2) || [],
      };
      briefs.push(brief);
      console.log(`  ${inst}: ${brief.arbiter_gate?.toUpperCase()} | Bull ${brief.bull_pct}% Bear ${brief.bear_pct}% | ${brief.narrative}`);
    } catch (err) {
      console.warn(`  ${inst} brief failed:`, err.message);
    }
  }

  if (briefs.length === 0) return;

  // Write to memory as today's pre-market brief
  const memory = readMemory();
  const today  = new Date().toISOString().split('T')[0];
  const briefSummary = briefs.map(b =>
    `${b.instrument}: ${b.narrative?.toUpperCase()} ${b.bull_pct}%/${b.bear_pct}% gate=${b.arbiter_gate} corr=${b.correlation} trap=${b.trap_risk}${b.gex_flip ? ` gex_flip=${b.gex_flip}` : ''}`
  ).join(' | ');

  memory.learnings = [...memory.learnings, {
    date:       today,
    source:     'pre_market_brief',
    insight:    `PRE-MARKET ${today}: ${briefSummary}`,
    confidence: 0.9,
    tags:       ['pre_market', 'auto_brief'],
    briefs,
  }].slice(-50);

  // Store today's brief separately for easy retrieval
  memory.today_brief = {
    date:   today,
    briefs,
    ts:     new Date().toISOString(),
  };

  writeMemory(memory);
  console.log(`✅ Vesper pre-market brief complete: ${briefSummary}`);
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
function scheduleDailyBrief(anthropicKey, backendUrl) {
  function msUntilNextBrief() {
    const now    = new Date();
    const et     = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const target = new Date(et);
    target.setHours(9, 25, 0, 0);
    if (target <= et) target.setDate(target.getDate() + 1);
    while (target.getDay() === 0 || target.getDay() === 6) target.setDate(target.getDate() + 1);
    return target - now;
  }

  const fire = () => {
    const ms = msUntilNextBrief();
    console.log(`⏰ Vesper pre-market brief scheduled in ${Math.round(ms / 60000)} min (9:25 AM ET)`);
    setTimeout(async () => {
      await runPreMarketBrief(anthropicKey, backendUrl);
      fire(); // schedule next
    }, ms);
  };
  fire();
}

// ── Performance tracker ───────────────────────────────────────────────────────
// Records arbiter predictions and actual outcomes for accuracy tracking.
// Call recordPrediction() when a setup is flagged, recordOutcome() at EOD.

function recordPrediction({ instrument, direction, gate, bull_pct, bear_pct, playbook, source }) {
  const memory = readMemory();
  if (!memory.predictions) memory.predictions = [];
  const pred = {
    id:          `${Date.now()}`,
    date:        new Date().toISOString().split('T')[0],
    ts:          new Date().toISOString(),
    instrument:  instrument || 'ES',
    direction:   direction  || 'unknown',
    gate:        gate       || 'monitor',
    bull_pct:    bull_pct   ?? 50,
    bear_pct:    bear_pct   ?? 50,
    playbook:    playbook   || null,
    source:      source     || 'agent',
    outcome:     null, // filled in later
    accurate:    null,
  };
  memory.predictions = [...memory.predictions, pred].slice(-200);
  writeMemory(memory);
  return pred.id;
}

function recordOutcome(predictionId, { outcome, pnl, correct }) {
  const memory = readMemory();
  if (!memory.predictions) return;
  const pred = memory.predictions.find(p => p.id === predictionId);
  if (!pred) return;
  pred.outcome  = outcome; // 'won' | 'lost' | 'scratch'
  pred.pnl      = pnl     ?? null;
  pred.accurate = correct ?? null;
  writeMemory(memory);
}

function getPerformanceStats() {
  const memory = readMemory();
  const preds  = (memory.predictions || []).filter(p => p.outcome !== null);
  if (preds.length === 0) return { message: 'No completed predictions yet', total: 0 };

  // Overall accuracy
  const correct = preds.filter(p => p.accurate === true).length;
  const total   = preds.length;

  // By instrument
  const byInstrument = {};
  for (const p of preds) {
    const k = p.instrument;
    if (!byInstrument[k]) byInstrument[k] = { total: 0, correct: 0, pnl: 0 };
    byInstrument[k].total++;
    if (p.accurate) byInstrument[k].correct++;
    byInstrument[k].pnl += p.pnl || 0;
  }

  // By playbook
  const byPlaybook = {};
  for (const p of preds.filter(p => p.playbook)) {
    const k = p.playbook;
    if (!byPlaybook[k]) byPlaybook[k] = { total: 0, correct: 0, pnl: 0 };
    byPlaybook[k].total++;
    if (p.accurate) byPlaybook[k].correct++;
    byPlaybook[k].pnl += p.pnl || 0;
  }

  // By gate level
  const byGate = {};
  for (const p of preds) {
    const k = p.gate;
    if (!byGate[k]) byGate[k] = { total: 0, correct: 0 };
    byGate[k].total++;
    if (p.accurate) byGate[k].correct++;
  }

  // Recent form: last 10
  const recent = preds.slice(-10);
  const recentCorrect = recent.filter(p => p.accurate).length;

  // Win rate helpers
  const pct = (c, t) => t ? Math.round(c / t * 100) : 0;

  return {
    total,
    overall_accuracy: pct(correct, total),
    recent_accuracy:  pct(recentCorrect, recent.length),
    by_instrument: Object.fromEntries(
      Object.entries(byInstrument).map(([k, v]) => [k, { ...v, accuracy: pct(v.correct, v.total), pnl: +v.pnl.toFixed(2) }])
    ),
    by_playbook: Object.fromEntries(
      Object.entries(byPlaybook).map(([k, v]) => [k, { ...v, accuracy: pct(v.correct, v.total), pnl: +v.pnl.toFixed(2) }])
    ),
    by_gate: Object.fromEntries(
      Object.entries(byGate).map(([k, v]) => [k, { ...v, accuracy: pct(v.correct, v.total) }])
    ),
    trade_stats:     memory.performance || {},
    today_brief:     memory.today_brief || null,
    last_updated:    memory.last_updated,
  };
}

// ── Route registration ────────────────────────────────────────────────────────
module.exports = function registerVesperScheduler(app, ANTHROPIC_KEY) {
  const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

  // Start pre-market daily brief scheduler
  scheduleDailyBrief(ANTHROPIC_KEY, BACKEND_URL);

  // ── GET /api/vesper/stats ───────────────────────────────────────────────────
  app.get('/api/vesper/stats', (req, res) => {
    try {
      res.json({ success: true, data: getPerformanceStats() });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/vesper/brief ───────────────────────────────────────────────────
  // Returns today's pre-market brief, or triggers one if not yet run
  app.get('/api/vesper/brief', async (req, res) => {
    const memory = readMemory();
    const today  = new Date().toISOString().split('T')[0];
    if (memory.today_brief?.date === today) {
      return res.json({ success: true, data: memory.today_brief, cached: true });
    }
    // Not yet run — trigger now (e.g. user opens terminal post-open)
    try {
      await runPreMarketBrief(ANTHROPIC_KEY, BACKEND_URL);
      const fresh = readMemory();
      res.json({ success: true, data: fresh.today_brief, cached: false });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── POST /api/vesper/predict ────────────────────────────────────────────────
  // Log an arbiter prediction for accuracy tracking
  app.post('/api/vesper/predict', (req, res) => {
    try {
      const id = recordPrediction(req.body);
      res.json({ success: true, prediction_id: id });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── POST /api/vesper/outcome ────────────────────────────────────────────────
  // Record the actual outcome of a prediction
  app.post('/api/vesper/outcome', (req, res) => {
    const { prediction_id, outcome, pnl, correct } = req.body;
    if (!prediction_id) return res.status(400).json({ error: 'prediction_id required' });
    try {
      recordOutcome(prediction_id, { outcome, pnl, correct });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log('✅ Vesper scheduler: 9:25 AM ET pre-market brief (ES + NQ)');
  console.log('✅ Vesper routes: GET /api/vesper/stats | GET /api/vesper/brief | POST /api/vesper/predict | POST /api/vesper/outcome');
};
