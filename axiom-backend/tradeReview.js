// ── Trade Review Module ───────────────────────────────────────────────────────
// Registers ProjectX trade history + Vesper trade debrief endpoints.
// Mount in server.js: require('./tradeReview')(app, ANTHROPIC_KEY);

const fetch = require('node-fetch');
const PX_API = 'https://api.topstepx.com/api';

async function pxFetch(endpoint, body, token) {
  const r = await fetch(`${PX_API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (r.status === 401) throw new Error('ProjectX token expired — please reconnect');
  if (!r.ok) throw new Error(`ProjectX ${endpoint} HTTP ${r.status}`);
  return r.json();
}

function contractToSymbol(contractId) {
  if (!contractId) return 'UNKNOWN';
  if (contractId.includes('.EP.'))  return 'ES';
  if (contractId.includes('.ENQ.')) return 'NQ';
  if (contractId.includes('.GC.'))  return 'GC';
  if (contractId.includes('.CL.'))  return 'CL';
  if (contractId.includes('.YM.'))  return 'YM';
  if (contractId.includes('.RTY.')) return 'RTY';
  return contractId.split('.').slice(-2, -1)[0] || contractId;
}

function pairTrades(rawTrades) {
  const entries = rawTrades.filter(t => t.profitAndLoss == null && !t.voided);
  const exits   = rawTrades.filter(t => t.profitAndLoss != null && !t.voided);
  const completed = [];

  for (const exit of exits) {
    const entry = entries
      .filter(e => e.contractId === exit.contractId && e.side !== exit.side &&
        new Date(e.creationTimestamp) <= new Date(exit.creationTimestamp))
      .sort((a, b) => new Date(b.creationTimestamp) - new Date(a.creationTimestamp))[0];

    const direction = exit.side === 1 ? 'SHORT' : 'LONG';
    const pnl       = +exit.profitAndLoss.toFixed(2);
    const fees      = +((exit.fees || 0) + (entry?.fees || 0)).toFixed(2);
    const netPnl    = +(pnl - fees).toFixed(2);
    const durationMs = entry
      ? new Date(exit.creationTimestamp) - new Date(entry.creationTimestamp) : null;

    completed.push({
      id: exit.id, accountId: exit.accountId,
      contractId: exit.contractId, instrument: contractToSymbol(exit.contractId),
      direction, size: exit.size,
      entryPrice: entry?.price || null, exitPrice: exit.price,
      pnl, fees, netPnl,
      result: pnl > 0 ? 'W' : pnl < 0 ? 'L' : 'BE',
      durationMin: durationMs != null ? Math.round(durationMs / 60000) : null,
      entryTime: entry?.creationTimestamp || null, exitTime: exit.creationTimestamp,
      entryOrderId: entry?.orderId || null, exitOrderId: exit.orderId,
    });
  }
  return completed.sort((a, b) => new Date(b.exitTime) - new Date(a.exitTime));
}

module.exports = function registerTradeReviewRoutes(app, ANTHROPIC_KEY) {

  // ── GET /api/projectx/accounts ─────────────────────────────────────────────
  app.get('/api/projectx/accounts', async (req, res) => {
    const token = req.headers['x-projectx-token'];
    if (!token) return res.status(400).json({ error: 'x-projectx-token header required' });
    try {
      const data = await pxFetch('/Account/search', { onlyActiveAccounts: true }, token);
      res.json({ success: true, accounts: data.accounts || [] });
    } catch (err) {
      console.error('PX accounts error:', err.message);
      res.status(err.message.includes('expired') ? 401 : 500).json({ success: false, error: err.message });
    }
  });

  // ── GET /api/projectx/trades?accountId=X&days=30 ──────────────────────────
  app.get('/api/projectx/trades', async (req, res) => {
    const token = req.headers['x-projectx-token'];
    if (!token) return res.status(400).json({ error: 'x-projectx-token header required' });
    const accountId = parseInt(req.query.accountId);
    const days = parseInt(req.query.days || '30');
    if (!accountId) return res.status(400).json({ error: 'accountId required' });
    try {
      const startTimestamp = new Date(Date.now() - days * 86400000).toISOString();
      const data = await pxFetch('/Trade/search', { accountId, startTimestamp }, token);
      const trades = pairTrades(data.trades || []);
      res.json({ success: true, trades, rawCount: (data.trades || []).length });
    } catch (err) {
      console.error('PX trades error:', err.message);
      res.status(err.message.includes('expired') ? 401 : 500).json({ success: false, error: err.message });
    }
  });

  // ── POST /api/vesper/review-trade ──────────────────────────────────────────
  app.post('/api/vesper/review-trade', async (req, res) => {
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
    const { trade, agentContext } = req.body;
    if (!trade) return res.status(400).json({ error: 'trade object required' });

    const { readMemory, writeMemory, getMemoryContext } = require('./agents/vesperMemory');

    try {
      const memCtx    = getMemoryContext(5);
      const tradeDate = new Date(trade.exitTime).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
      const entryET   = trade.entryTime
        ? new Date(trade.entryTime).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true })
        : 'unknown';

      const systemPrompt = `You are Vesper — an elite futures trading coach using Market Stalkers (MS) methodology.
Deliver a structured, honest trade debrief. Reference actual prices. Be direct. No fluff.

DEBRIEF STRUCTURE (use these exact headers):
**SETUP QUALITY** — Was this a valid MS playbook setup? Did it respect value area, IB structure, session context?
**ENTRY TIMING** — Was entry at a high-quality level or was it chased? Reference the actual entry price.
**RISK MANAGEMENT** — Was the stop logical relative to structure? Size appropriate for the session?
**OUTCOME ANALYSIS** — Did it work for the right reasons? (A winner with bad process is still a bad trade)
**IMPROVEMENT** — One specific, actionable change for next time.
**VESPER NOTE** — What pattern does this trade confirm or challenge in your model?
${memCtx ? '\nPAST LEARNINGS:\n' + memCtx : ''}`;

      const ctx = agentContext;
      const userPrompt = `TRADE DEBRIEF REQUEST:
Instrument: ${trade.instrument} | Direction: ${trade.direction} | Date: ${tradeDate} | Entry: ${entryET} ET
Entry price: ${trade.entryPrice ?? 'unknown'} → Exit: ${trade.exitPrice}
P&L: $${trade.pnl > 0 ? '+' : ''}${trade.pnl} (net $${trade.netPnl > 0 ? '+' : ''}${trade.netPnl} after fees)
Size: ${trade.size} contract${trade.size !== 1 ? 's' : ''} | Duration: ${trade.durationMin != null ? trade.durationMin + ' min' : 'unknown'}
Outcome: ${trade.result === 'W' ? '✓ WINNER' : trade.result === 'L' ? '✗ LOSER' : '— BREAKEVEN'}

MARKET CONTEXT AT ENTRY:
${ctx ? `Macro: ${ctx.macro?.event_risk_level || '?'} risk — ${ctx.macro?.thesis || ''}
Correlation: ${ctx.correlation?.alignment || '?'} (tailwind ${ctx.correlation?.tailwind_score ?? '?'}) — DXY ${ctx.correlation?.dxy_trend || '?'}, VIX ${ctx.correlation?.vix_level || '?'}
Session: ${ctx.session?.day_type || '?'} day, ${(ctx.session?.value_position || '?').replace('_', ' ')}, IB ${ctx.session?.ib_formed ? `set H:${ctx.session?.ib_high} L:${ctx.session?.ib_low}` : 'forming'}
Trap: ${ctx.trap?.trap_risk || '?'} risk — ${ctx.trap?.thesis || ''}
Arbiter: Bull ${ctx.arbiter_verdict?.bull_pct || '?'}% / Bear ${ctx.arbiter_verdict?.bear_pct || '?'}% — ${ctx.arbiter_verdict?.alert_gate || '?'} gate` : 'Not available — trade predates agent integration.'}

Deliver your debrief now.`;

      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1200, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
      });

      if (!aiRes.ok) throw new Error(`Anthropic ${aiRes.status}`);
      const aiData = await aiRes.json();
      const debrief = aiData?.content?.[0]?.text || '';

      // Write to memory
      const memory = readMemory();
      const today  = new Date().toISOString().split('T')[0];
      memory.learnings = [...memory.learnings, {
        date: today, source: 'trade_review',
        insight: `${trade.instrument} ${trade.direction} ${trade.result}: entry ${trade.entryPrice}→${trade.exitPrice} $${trade.netPnl > 0 ? '+' : ''}${trade.netPnl}`,
        confidence: 0.85,
        tags: ['trade_review', trade.instrument?.toLowerCase(), trade.result === 'W' ? 'winner' : 'loser'],
        debrief: debrief.slice(0, 400),
      }].slice(-50);
      writeMemory(memory);

      res.json({ success: true, debrief, trade, ts: new Date().toISOString() });
    } catch (err) {
      console.error('Trade review error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── EOD auto-scheduler ──────────────────────────────────────────────────────
  scheduleEOD(ANTHROPIC_KEY);
  console.log('✅ Trade review: /api/projectx/accounts, /api/projectx/trades, /api/vesper/review-trade');
};

function scheduleEOD(ANTHROPIC_KEY) {
  const accountId = process.env.PROJECTX_ACCOUNT_ID;
  const pxToken   = process.env.PROJECTX_JWT_TOKEN;
  if (!accountId || !pxToken) {
    console.log('⏭  EOD auto-reflection: PROJECTX_ACCOUNT_ID or PROJECTX_JWT_TOKEN not set');
    return;
  }

  const { readMemory, writeMemory } = require('./agents/vesperMemory');

  function msUntilNext4_15ET() {
    const now = new Date();
    const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const t   = new Date(et); t.setHours(16, 15, 0, 0);
    if (t <= et) t.setDate(t.getDate() + 1);
    while (t.getDay() === 0 || t.getDay() === 6) t.setDate(t.getDate() + 1);
    return t - now;
  }

  const go = () => {
    const ms = msUntilNext4_15ET();
    console.log(`⏰ EOD reflection scheduled in ${Math.round(ms / 60000)} min`);
    setTimeout(async () => {
      try {
        const todayStart = new Date(); todayStart.setHours(0,0,0,0);
        const data = await pxFetch('/Trade/search', {
          accountId: parseInt(accountId), startTimestamp: todayStart.toISOString(),
        }, pxToken);
        const trades = pairTrades(data.trades || []);
        const wins   = trades.filter(t => t.result === 'W').length;
        const losses = trades.filter(t => t.result === 'L').length;
        const netPnl = trades.reduce((s, t) => s + t.netPnl, 0);
        const memory = readMemory();
        const today  = new Date().toISOString().split('T')[0];
        memory.learnings = [...memory.learnings, {
          date: today, source: 'eod_auto',
          insight: `EOD: ${trades.length} trades — ${wins}W/${losses}L, net $${netPnl.toFixed(2)}`,
          confidence: 0.9, tags: ['eod', 'session_summary'],
        }].slice(-50);
        memory.performance.total_sessions = (memory.performance.total_sessions || 0) + 1;
        if (wins > losses) memory.performance.accurate_bias = (memory.performance.accurate_bias || 0) + 1;
        writeMemory(memory);
        console.log(`✅ EOD auto: ${trades.length} trades logged`);
      } catch (err) { console.error('EOD error:', err.message); }
      go();
    }, ms);
  };
  go();
}
