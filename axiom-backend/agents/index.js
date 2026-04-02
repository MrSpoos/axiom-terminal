// ── Axiom Agent Routes ────────────────────────────────────────────────────────
const { runMacroAgent }       = require('./macroAgent');
const { runCorrelationAgent } = require('./correlationAgent');
const { VESPER_TOOLS, executeTool } = require('./vesperTools');
const { readMemory, writeMemory, getMemoryContext } = require('./vesperMemory');
const fetch = require('node-fetch');

const VALID_INSTRUMENTS = ['ES', 'NQ', 'GC', 'CL'];
const MAX_TOOL_ITERATIONS = 4; // max agent calls per Vesper turn

module.exports = function registerAgentRoutes(app) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
  const BACKEND_URL   = process.env.BACKEND_URL || 'http://localhost:3001';

  // ── GET /api/agents/macro ─────────────────────────────────────────────────
  app.get('/api/agents/macro', async (req, res) => {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
    try {
      const result = await runMacroAgent(ANTHROPIC_KEY);
      res.json({ success: true, data: result, ts: new Date().toISOString() });
    } catch (err) {
      console.error('Macro agent error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/agents/correlation?instrument=ES ─────────────────────────────
  app.get('/api/agents/correlation', async (req, res) => {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
    const instrument = (req.query.instrument || 'ES').toUpperCase();
    if (!VALID_INSTRUMENTS.includes(instrument)) {
      return res.status(400).json({ error: `instrument must be one of: ${VALID_INSTRUMENTS.join(', ')}` });
    }
    try {
      const result = await runCorrelationAgent(instrument, ANTHROPIC_KEY);
      res.json({ success: true, data: result, ts: new Date().toISOString() });
    } catch (err) {
      console.error('Correlation agent error:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  console.log('✅ Agent routes registered: /api/agents/macro, /api/agents/correlation');
  console.log('✅ Vesper routes registered: /api/vesper, /api/vesper/memory, /api/vesper/reflect');

  // ── POST /api/vesper — Agentic Vesper with tool use ───────────────────────
  // Full agentic loop: Vesper can call agents mid-conversation before answering.
  app.post('/api/vesper', async (req, res) => {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });

    try {
      const { messages, sessionContext } = req.body;

      // Build context block from session data
      const contextBlock = `
LIVE SESSION CONTEXT (${new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York' })} ET):
Instrument: ${sessionContext?.instrument || 'ES'} | Price: ${sessionContext?.currentPrice || 'unknown'}
Session Bias: ${(sessionContext?.sessionBias || 'unknown')?.toUpperCase()} | Day Type: ${sessionContext?.dayType || '—'}
VAH: ${sessionContext?.vah || '—'} | POC: ${sessionContext?.poc || '—'} | VAL: ${sessionContext?.val || '—'}
ADR Consumed: ${sessionContext?.adrConsumed ?? '—'}% | IB: ${sessionContext?.ibStatus || '—'} | VIX: ${sessionContext?.vix || '—'}
Gap: ${sessionContext?.gap ?? '—'} | Key Level: ${sessionContext?.keyLevel || '—'}
Active Setups: ${sessionContext?.activeSetups?.length
  ? sessionContext.activeSetups.map(s =>
      `${s.playbook} ${s.name} (${s.direction?.toUpperCase()}) — ${s.conviction?.conviction || 'unscored'}`
    ).join(' | ')
  : 'None identified'}`.trim();

      // Inject Vesper's learned memory
      const memoryContext = getMemoryContext(8);

      // System prompt (reuse TRADING_BUDDY_SYSTEM from server.js scope — passed via closure)
      const systemPrompt = `You are Vesper — an autonomous AI trading intelligence built into the Axiom Terminal.
You trade ES, NQ, GC, and CL futures using Market Stalkers (MS) methodology: Market Profile, TPO value areas, PB1-PB4 playbooks, ADR/ASR targets, conterminous supply/demand, and swing quartile levels (QP/QHi/QMid/QLo).

You have a suite of specialist AI agents you can call at any time to deepen your analysis:
- run_macro_agent: checks economic calendar and event risk
- run_correlation_agent: checks DXY/VIX/ZN alignment vs the instrument
- get_market_snapshot: pulls live prices across all instruments and VIX
- get_news_feed: fetches latest market headlines

Use your tools proactively. If you are asked about bias, risk, or entries — call the agents. Do not answer from assumptions when fresh data is available. You can call multiple agents in sequence if needed.

When you do call a tool, DO NOT acknowledge it out loud to the trader. Just call it, receive the result, and incorporate it into your answer naturally. Your answer should feel seamless — like you already knew this information.

After gathering what you need, give your answer in direct desk-talk style. Specific levels. Specific reasons. Short. No disclaimers. No fluff. Real-time thinking, not a report.

${contextBlock}
${memoryContext ? '\n' + memoryContext : ''}`;

      // ── Agentic loop ────────────────────────────────────────────────────
      let currentMessages = [...messages];
      let toolCallLog = [];
      let iterations = 0;
      let finalText = '';

      while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1000,
            system: systemPrompt,
            tools: VESPER_TOOLS,
            messages: currentMessages,
          }),
        });

        if (!aiRes.ok) {
          const err = await aiRes.text();
          throw new Error(`Anthropic ${aiRes.status}: ${err.slice(0, 200)}`);
        }

        const data = await aiRes.json();
        const stopReason = data.stop_reason;

        // Extract any text blocks
        const textBlocks = data.content.filter(b => b.type === 'text');
        const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');

        if (stopReason === 'end_turn' || toolUseBlocks.length === 0) {
          // Final answer — no more tool calls needed
          finalText = textBlocks.map(b => b.text).join('');
          break;
        }

        // Process tool calls
        // Add assistant message with tool_use blocks to history
        currentMessages.push({ role: 'assistant', content: data.content });

        // Execute all requested tools and build tool_result blocks
        const toolResults = [];
        for (const toolUse of toolUseBlocks) {
          console.log(`Vesper calling tool: ${toolUse.name}`, toolUse.input);
          toolCallLog.push({ tool: toolUse.name, input: toolUse.input });

          let result;
          try {
            result = await executeTool(toolUse.name, toolUse.input, ANTHROPIC_KEY, BACKEND_URL);
          } catch (err) {
            result = `Tool error: ${err.message}`;
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result,
          });
        }

        // Feed tool results back for next iteration
        currentMessages.push({ role: 'user', content: toolResults });
      }

      if (!finalText) {
        finalText = 'I ran out of analysis iterations. Please ask again.';
      }

      res.json({
        reply: finalText,
        toolCalls: toolCallLog,
        iterations,
      });

    } catch (err) {
      console.error('Vesper agentic error:', err);
      res.status(500).json({ error: err.message });
    }
  });


  // ── GET /api/vesper/memory ────────────────────────────────────────────────
  app.get('/api/vesper/memory', (req, res) => {
    try {
      const memory = readMemory();
      res.json({ success: true, data: memory });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── POST /api/vesper/reflect — End-of-day self-reflection ─────────────────
  // Vesper reviews the day's conversation and market outcome, writes learnings.
  app.post('/api/vesper/reflect', async (req, res) => {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
    try {
      const { conversationHistory, marketOutcome, instrument } = req.body;
      const memory = readMemory();
      const existingInsights = memory.learnings.slice(-5).map(l => l.insight).join('\n');

      const reflectionPrompt = `You are Vesper reflecting on today's trading session to extract learnings.

INSTRUMENT: ${instrument || 'ES'}
TODAY'S DATE: ${new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York' })}

CONVERSATION HISTORY TODAY:
${(conversationHistory || []).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n').slice(0, 3000)}

WHAT ACTUALLY HAPPENED IN THE MARKET TODAY:
${marketOutcome || 'Not provided — infer from conversation context'}

YOUR EXISTING LEARNINGS (do not duplicate):
${existingInsights || 'None yet'}

Extract 1-3 specific, actionable trading insights from today. Focus on:
- What setups worked or failed and why
- Inter-market signals that confirmed or contradicted price action
- Session behavior patterns you observed
- Anything that should change how you assess similar setups next time

Respond ONLY with valid JSON, no markdown:
{
  "learnings": [
    {
      "insight": "<specific actionable insight>",
      "confidence": <0.0-1.0>,
      "tags": ["macro", "correlation", "session", "playbook", "levels"]
    }
  ],
  "session_accurate": <true/false — was your bias for the day directionally correct?>,
  "summary": "<one sentence on the day>"
}`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 600,
          messages: [{ role: 'user', content: reflectionPrompt }],
        }),
      });

      const aiData = await aiRes.json();
      const text = (aiData?.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const reflection = JSON.parse(text);

      // Write learnings to memory
      const today = new Date().toISOString().split('T')[0];
      const newLearnings = (reflection.learnings || []).map(l => ({
        date: today,
        insight: l.insight,
        confidence: l.confidence,
        tags: l.tags || [],
        source: 'self_reflection',
      }));

      memory.learnings = [...memory.learnings, ...newLearnings].slice(-50); // keep last 50
      memory.performance.total_sessions = (memory.performance.total_sessions || 0) + 1;
      if (reflection.session_accurate) {
        memory.performance.accurate_bias = (memory.performance.accurate_bias || 0) + 1;
      }
      memory.performance.notes.push({ date: today, summary: reflection.summary, accurate: reflection.session_accurate });
      memory.performance.notes = memory.performance.notes.slice(-30);
      writeMemory(memory);

      res.json({ success: true, newLearnings, reflection });
    } catch (err) {
      console.error('Vesper reflect error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });



}; // end registerAgentRoutes
