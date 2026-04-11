// ── Axiom Agent Routes ────────────────────────────────────────────────────────
const { runMacroAgent }           = require('./macroAgent');
const { runCorrelationAgent }     = require('./correlationAgent');
const { runSessionAgent }         = require('./sessionAgent');
const { runTrapAgent }            = require('./trapAgent');
const { runDevilsAdvocateAgent }  = require('./devilsAdvocateAgent');
const { runBearCaseAgent }        = require('./bearCaseAgent');
const { runArbiterAgent }         = require('./arbiterAgent');
const { VESPER_TOOLS, executeTool } = require('./vesperTools');
const { readMemory, writeMemory, getMemoryContext } = require('./vesperMemory');
const fetch = require('node-fetch');

const VALID_INSTRUMENTS  = ['ES', 'NQ', 'GC', 'CL'];
const MAX_TOOL_ITERATIONS = 8;

module.exports = function registerAgentRoutes(app) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const BACKEND_URL   = process.env.BACKEND_URL || 'http://localhost:3001';

  // ── GET /api/agents/macro ─────────────────────────────────────────────────
  app.get('/api/agents/macro', async (req, res) => {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
    try {
      const result = await runMacroAgent(ANTHROPIC_KEY);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('Macro agent error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/agents/correlation?instrument=ES ─────────────────────────────
  app.get('/api/agents/correlation', async (req, res) => {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
    const instrument = (req.query.instrument || 'ES').toUpperCase();
    if (!VALID_INSTRUMENTS.includes(instrument)) return res.status(400).json({ error: 'invalid instrument' });
    try {
      const result = await runCorrelationAgent(instrument, ANTHROPIC_KEY);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('Correlation agent error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/agents/session?instrument=ES ─────────────────────────────────
  app.get('/api/agents/session', async (req, res) => {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
    const instrument = (req.query.instrument || 'ES').toUpperCase();
    const levels = req.query.vah ? { vah: req.query.vah, val: req.query.val, poc: req.query.poc } : null;
    if (!VALID_INSTRUMENTS.includes(instrument)) return res.status(400).json({ error: 'invalid instrument' });
    try {
      const result = await runSessionAgent(instrument, levels, ANTHROPIC_KEY);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('Session agent error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/agents/trap?instrument=ES ───────────────────────────────────
  app.get('/api/agents/trap', async (req, res) => {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
    const instrument = (req.query.instrument || 'ES').toUpperCase();
    const levels = req.query.vah ? { vah: req.query.vah, val: req.query.val, poc: req.query.poc, ibHigh: req.query.ibHigh, ibLow: req.query.ibLow } : null;
    if (!VALID_INSTRUMENTS.includes(instrument)) return res.status(400).json({ error: 'invalid instrument' });
    try {
      const result = await runTrapAgent(instrument, levels, ANTHROPIC_KEY);
      res.json({ success: true, data: result });
    } catch (err) {
      console.error('Trap agent error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── POST /api/agents/full — Run all 6 agents + Arbiter in sequence ─────────
  // Tier 1 runs in parallel, Tier 2 runs after, Arbiter synthesises all
  app.post('/api/agents/full', async (req, res) => {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
    const instrument = ((req.body?.instrument) || 'ES').toUpperCase();
    const sessionLevels = req.body?.sessionLevels || null;
    if (!VALID_INSTRUMENTS.includes(instrument)) return res.status(400).json({ error: 'invalid instrument' });

    try {
      // ── TIER 1: Run all four specialist agents in parallel ──────────────
      console.log(`[Agents] Running Tier 1 for ${instrument}...`);
      const [macroR, corrR, sessionR, trapR] = await Promise.allSettled([
        runMacroAgent(ANTHROPIC_KEY),
        runCorrelationAgent(instrument, ANTHROPIC_KEY),
        runSessionAgent(instrument, sessionLevels, ANTHROPIC_KEY),
        runTrapAgent(instrument, sessionLevels, ANTHROPIC_KEY),
      ]);

      const tier1 = {
        macro:       macroR.status   === 'fulfilled' ? macroR.value   : { error: macroR.reason?.message,   agent_id: 'macro_catalyst' },
        correlation: corrR.status    === 'fulfilled' ? corrR.value    : { error: corrR.reason?.message,    agent_id: 'correlation' },
        session:     sessionR.status === 'fulfilled' ? sessionR.value : { error: sessionR.reason?.message, agent_id: 'session_behavior' },
        trap:        trapR.status    === 'fulfilled' ? trapR.value    : { error: trapR.reason?.message,    agent_id: 'trap_detector' },
      };

      // ── TIER 2: Devil's Advocate + Bear Case (in parallel, need Tier 1) ──
      console.log(`[Agents] Running Tier 2 for ${instrument}...`);
      const [daR, bcR] = await Promise.allSettled([
        runDevilsAdvocateAgent(instrument, tier1, ANTHROPIC_KEY),
        runBearCaseAgent(instrument, tier1, ANTHROPIC_KEY),
      ]);

      const tier2 = {
        devilsAdvocate: daR.status === 'fulfilled' ? daR.value : { error: daR.reason?.message, agent_id: 'devils_advocate' },
        bearCase:       bcR.status === 'fulfilled' ? bcR.value : { error: bcR.reason?.message, agent_id: 'bear_case' },
      };

      // ── TIER 3: Arbiter synthesises everything ────────────────────────────
      console.log(`[Agents] Running Arbiter for ${instrument}...`);
      const allResults = { ...tier1, ...tier2 };
      let arbiter;
      try {
        arbiter = await runArbiterAgent(instrument, allResults, ANTHROPIC_KEY);
      } catch (err) {
        arbiter = { error: err.message, agent_id: 'arbiter' };
      }

      console.log(`[Agents] Full run complete for ${instrument} — bull: ${arbiter?.bull_pct}% bear: ${arbiter?.bear_pct}% gate: ${arbiter?.alert_gate}`);

      res.json({
        success: true,
        instrument,
        tier1,
        tier2,
        arbiter,
        ts: new Date().toISOString(),
      });

    } catch (err) {
      console.error('Full agent run error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });


  // ── GET /api/agents/quick-gate?instrument=ES ─────────────────────────────
  // Fast 2-agent check: Macro + Correlation → mini Arbiter
  // Used by SetupMonitor to show alert_gate badge without running full suite
  // Macro result is cached server-side for 10min to avoid redundant calls
  let _macroCache = null;
  let _macroCacheTs = 0;

  app.get('/api/agents/quick-gate', async (req, res) => {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
    const instrument = (req.query.instrument || 'ES').toUpperCase();
    if (!VALID_INSTRUMENTS.includes(instrument)) return res.status(400).json({ error: 'invalid instrument' });
    try {
      // Use cached macro if fresh (10 min)
      const now = Date.now();
      if (!_macroCache || now - _macroCacheTs > 10 * 60 * 1000) {
        _macroCache = await runMacroAgent(ANTHROPIC_KEY);
        _macroCacheTs = now;
      }
      const macro = _macroCache;

      // Correlation is instrument-specific, always fresh
      const correlation = await runCorrelationAgent(instrument, ANTHROPIC_KEY);

      // Hard veto: extreme event risk → always suppress
      if (macro.event_risk_level === 'extreme' || macro.setup_verdict === 'avoid') {
        return res.json({
          success: true,
          instrument,
          alert_gate: 'suppress',
          confidence_tier: 'low',
          bull_pct: 50, bear_pct: 50,
          dominant_narrative: 'contested',
          veto_applied: true,
          veto_reason: `Macro: ${macro.setup_verdict} — ${macro.next_event?.name || 'extreme event risk'}`,
          synthesis: macro.thesis || 'Extreme event risk — standing aside.',
          macro: { event_risk_level: macro.event_risk_level, setup_verdict: macro.setup_verdict, thesis: macro.thesis },
          correlation: { alignment: correlation.alignment, tailwind_score: correlation.tailwind_score, thesis: correlation.thesis },
          ts: new Date().toISOString(),
        });
      }

      // Score-based gate logic (no AI call needed for quick gate)
      const tailwind = correlation.tailwind_score ?? 0;
      const macroBoost = macro.event_risk_level === 'none' || macro.event_risk_level === 'low' ? 10 : 0;
      const corrPenalty = correlation.alignment === 'contradicting' ? -20 : correlation.alignment === 'neutral' ? -5 : 10;
      const rawBull = Math.max(10, Math.min(90, 50 + tailwind / 4 + macroBoost + corrPenalty));
      const bull_pct = Math.round(rawBull);
      const bear_pct = 100 - bull_pct;
      const confidence = Math.abs(tailwind) > 50 ? 'high' : Math.abs(tailwind) > 25 ? 'medium' : 'low';
      const gate = macro.setup_verdict === 'avoid' ? 'suppress'
        : (confidence === 'low' || Math.abs(50 - bull_pct) < 10) ? 'monitor'
        : bull_pct >= 60 ? 'alert'
        : bear_pct >= 60 ? 'monitor'
        : 'monitor';

      res.json({
        success: true,
        instrument,
        alert_gate: gate,
        confidence_tier: confidence,
        bull_pct, bear_pct,
        dominant_narrative: bull_pct > 60 ? 'bull' : bear_pct > 60 ? 'bear' : 'contested',
        veto_applied: false,
        veto_reason: null,
        synthesis: `${correlation.thesis || ''} ${macro.thesis || ''}`.trim(),
        macro: { event_risk_level: macro.event_risk_level, setup_verdict: macro.setup_verdict, thesis: macro.thesis },
        correlation: { alignment: correlation.alignment, tailwind_score: correlation.tailwind_score, thesis: correlation.thesis },
        ts: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Quick gate error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── POST /api/vesper — Agentic Vesper with full tool suite ────────────────
  app.post('/api/vesper', async (req, res) => {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
    try {
      const { messages, sessionContext } = req.body;
      const contextBlock = `LIVE SESSION CONTEXT (${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET):
Instrument: ${sessionContext?.instrument || 'ES'} | Price: ${sessionContext?.currentPrice || 'unknown'}
Session Bias: ${(sessionContext?.sessionBias || 'unknown')?.toUpperCase()} | Day Type: ${sessionContext?.dayType || '—'}
VAH: ${sessionContext?.vah || '—'} | POC: ${sessionContext?.poc || '—'} | VAL: ${sessionContext?.val || '—'}
ADR Consumed: ${sessionContext?.adrConsumed ?? '—'}% | IB: ${sessionContext?.ibStatus || '—'} | VIX: ${sessionContext?.vix || '—'}
Gap: ${sessionContext?.gap ?? '—'} | Key Level: ${sessionContext?.keyLevel || '—'}
Active Setups: ${sessionContext?.activeSetups?.length ? sessionContext.activeSetups.map(s => `${s.playbook} ${s.name} (${s.direction?.toUpperCase()})`).join(' | ') : 'None'}`;

      const memoryContext = getMemoryContext(8);
      const instrument = sessionContext?.instrument || 'ES';
      const systemPrompt = `You are Vesper — an autonomous AI trading intelligence built into the Axiom Terminal.
You trade ES, NQ, GC, and CL futures using Market Stalkers (MS) methodology: Market Profile, TPO value areas, PB1-PB4 playbooks, ADR/ASR targets, conterminous supply/demand, and swing quartile levels.

═══ YOUR AGENT SUITE ═══
You have 7 tools. You MUST call them — never guess or rely on memory for live market data.

PRIMARY TOOL (use for all broad assessments):
- run_full_analysis → runs ALL 7 agents: Macro, Correlation, Session, Trap, Devil's Advocate, Bear Case, and Probability Arbiter. Returns the complete picture including contrarian stress test and bull/bear probability split. Use this for any broad market question.

SPECIALIST TOOLS (use for specific targeted questions only):
- run_macro_agent → economic calendar and event risk
- run_correlation_agent → DXY, VIX, ZN inter-market alignment
- run_session_agent → day type, IB status, value area position
- run_trap_agent → stop hunts, liquidity grabs
- get_market_snapshot → live prices for all instruments
- get_news_feed → latest market headlines
- run_gex_agent → live GEX levels: gamma flip, call wall, put wall, dealer regime (positive/negative gamma)
- run_full_analysis → NOW INCLUDES GEX levels automatically in the full picture

═══ ASSESSMENT PROTOCOL — MANDATORY ═══
When the trader asks ANY of the following, you MUST call run_full_analysis FIRST:
- "assess the market" / "what's your read" / "market assessment" / "what do you think"
- "should I take this trade" / "is this a good setup" / "give me your honest read"
- "what's happening" / "what's the bias" / "where are we" / "read the tape"
- Any question about direction, bias, entries, or whether to be long or short

run_full_analysis returns: bull/bear % split, alert gate, contrarian stress-test verdict (Devil's Advocate), independent bear thesis, and Arbiter synthesis. Use ALL of this in your answer.

For SPECIFIC questions (e.g. "any news?", "what's VIX doing?", "is this a trap?"), call only the relevant agent.
For "what are prices?" use get_market_snapshot only.

═══ ANSWER STYLE ═══
After your agents report back:
- Lead with the Arbiter verdict: bull/bear %, confidence, gate (alert/monitor/suppress)
- Call out the single most important factor driving the bias
- Give a specific level the trader should watch
- Flag any contradictions between agents honestly
- Keep it under 150 words. Direct desk-talk. No disclaimers. No fluff.

═══ WHEN AGENTS CONTRADICT ═══
If session says trend day up but correlation says contradicting — say so explicitly.
"Session is running trend-day long but DXY is fighting it — that's a contested setup, take smaller size."
Never hide contradictions. Contradictions ARE the signal.

${contextBlock}
${memoryContext ? '\n' + memoryContext : ''}`;

      let currentMessages = [...messages];
      let toolCallLog = [], iterations = 0, finalText = '';

      while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;
        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, system: systemPrompt, tools: VESPER_TOOLS, messages: currentMessages }),
        });
        if (!aiRes.ok) throw new Error(`Anthropic ${aiRes.status}`);
        const data = await aiRes.json();
        const textBlocks   = data.content.filter(b => b.type === 'text');
        const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
        if (data.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
          finalText = textBlocks.map(b => b.text).join(''); break;
        }
        currentMessages.push({ role: 'assistant', content: data.content });
        const toolResults = [];
        for (const toolUse of toolUseBlocks) {
          toolCallLog.push({ tool: toolUse.name, input: toolUse.input });
          let result;
          try { result = await executeTool(toolUse.name, toolUse.input, ANTHROPIC_KEY, BACKEND_URL); }
          catch (err) { result = `Tool error: ${err.message}`; }
          toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result });
        }
        currentMessages.push({ role: 'user', content: toolResults });
      }

      res.json({ reply: finalText || 'Analysis complete.', toolCalls: toolCallLog, iterations });
    } catch (err) {
      console.error('Vesper error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /api/vesper/memory ────────────────────────────────────────────────
  app.get('/api/vesper/memory', (req, res) => {
    try { res.json({ success: true, data: readMemory() }); }
    catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ── POST /api/vesper/reflect ──────────────────────────────────────────────
  app.post('/api/vesper/reflect', async (req, res) => {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
    try {
      const { conversationHistory, marketOutcome, instrument } = req.body;
      const memory = readMemory();
      const existingInsights = memory.learnings.slice(-5).map(l => l.insight).join('\n');
      const reflectionPrompt = `You are Vesper reflecting on today's trading session.
INSTRUMENT: ${instrument || 'ES'} | DATE: ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })}
CONVERSATION: ${(conversationHistory || []).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n').slice(0, 3000)}
MARKET OUTCOME: ${marketOutcome || 'Not provided'}
EXISTING LEARNINGS (don't duplicate): ${existingInsights || 'None'}
Extract 1-3 specific actionable insights. Return ONLY valid JSON:
{"learnings":[{"insight":"<text>","confidence":<0-1>,"tags":["macro","session","playbook"]}],"session_accurate":<true|false>,"summary":"<one sentence>"}`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: reflectionPrompt }] }),
      });
      const aiData = await aiRes.json();
      const text = (aiData?.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const reflection = JSON.parse(text);
      const today = new Date().toISOString().split('T')[0];
      const newLearnings = (reflection.learnings || []).map(l => ({ date: today, insight: l.insight, confidence: l.confidence, tags: l.tags || [], source: 'self_reflection' }));
      memory.learnings = [...memory.learnings, ...newLearnings].slice(-50);
      memory.performance.total_sessions = (memory.performance.total_sessions || 0) + 1;
      if (reflection.session_accurate) memory.performance.accurate_bias = (memory.performance.accurate_bias || 0) + 1;
      memory.performance.notes = [...(memory.performance.notes || []), { date: today, summary: reflection.summary, accurate: reflection.session_accurate }].slice(-30);
      writeMemory(memory);
      res.json({ success: true, newLearnings, reflection });
    } catch (err) {
      console.error('Vesper reflect error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log('✅ Axiom agents: macro, correlation, session, trap, devils_advocate, bear_case, arbiter');
  console.log('✅ Full tier run: POST /api/agents/full');
  console.log('✅ Vesper: POST /api/vesper | GET /api/vesper/memory | POST /api/vesper/reflect');
}; // end registerAgentRoutes
