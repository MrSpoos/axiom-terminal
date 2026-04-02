// ── Vesper Agent Tools ────────────────────────────────────────────────────────
const fetch = require('node-fetch');
const { runMacroAgent }       = require('./macroAgent');
const { runCorrelationAgent } = require('./correlationAgent');
const { runSessionAgent }     = require('./sessionAgent');
const { runTrapAgent }        = require('./trapAgent');

const VESPER_TOOLS = [
  {
    name: 'run_macro_agent',
    description: 'Fetches the economic calendar and assesses macro/catalyst risk for the next 48 hours. Use when the trader asks about news risk, upcoming events, whether it is safe to trade, or when a setup might be invalidated by a scheduled release.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'run_correlation_agent',
    description: 'Fetches DXY, VIX, and ZN (10yr Treasury) and assesses inter-market alignment for a given instrument. Use when assessing whether macro tailwinds or headwinds support or contradict a directional bias.',
    input_schema: {
      type: 'object',
      properties: {
        instrument: { type: 'string', enum: ['ES', 'NQ', 'GC', 'CL'], description: 'The futures instrument to assess.' },
      },
      required: ['instrument'],
    },
  },
  {
    name: 'run_session_agent',
    description: 'Classifies the current trading session: day type in progress (trend/normal/neutral), Initial Balance status, value area position (above VAH / inside VA / below VAL), and overnight context. Use when assessing session character, IB formation, or what kind of day is developing.',
    input_schema: {
      type: 'object',
      properties: {
        instrument: { type: 'string', enum: ['ES', 'NQ', 'GC', 'CL'], description: 'The futures instrument to assess.' },
      },
      required: ['instrument'],
    },
  },
  {
    name: 'run_trap_agent',
    description: 'Identifies stop hunts, liquidity grabs, bull traps, bear traps, and false breakouts using structural levels (prior day high/low, overnight extremes, IB levels, value area). Use when the trader asks if a move is real or a trap, or when price is approaching a known stop cluster zone.',
    input_schema: {
      type: 'object',
      properties: {
        instrument: { type: 'string', enum: ['ES', 'NQ', 'GC', 'CL'], description: 'The futures instrument to assess.' },
      },
      required: ['instrument'],
    },
  },
  {
    name: 'get_market_snapshot',
    description: 'Gets live prices for ES, NQ, GC, CL, VIX, and ETFs. Use when you need current price levels or want to reference where instruments are trading right now.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_news_feed',
    description: 'Fetches the latest market news headlines. Use when the trader asks about what is moving the market, recent headlines, or breaking news context.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

async function executeTool(toolName, toolInput, anthropicKey, backendUrl) {
  switch (toolName) {
    case 'run_macro_agent': {
      const r = await runMacroAgent(anthropicKey);
      return JSON.stringify(r, null, 2);
    }
    case 'run_correlation_agent': {
      const r = await runCorrelationAgent(toolInput.instrument || 'ES', anthropicKey);
      return JSON.stringify(r, null, 2);
    }
    case 'run_session_agent': {
      const r = await runSessionAgent(toolInput.instrument || 'ES', null, anthropicKey);
      return JSON.stringify(r, null, 2);
    }
    case 'run_trap_agent': {
      const r = await runTrapAgent(toolInput.instrument || 'ES', null, anthropicKey);
      return JSON.stringify(r, null, 2);
    }
    case 'get_market_snapshot': {
      const r = await fetch(`${backendUrl}/api/market`);
      const d = await r.json();
      if (!d.success) return 'Market data unavailable';
      const { es, nq, gc, cl, vix } = d.data;
      return JSON.stringify({ es, nq, gc, cl, vix, ts: d.ts }, null, 2);
    }
    case 'get_news_feed': {
      const r = await fetch(`${backendUrl}/api/news`);
      const d = await r.json();
      if (!d.success) return 'News unavailable';
      return (d.data || []).slice(0, 8).map(n => `[${n.impact?.toUpperCase()}] ${n.source} — ${n.headline}`).join('\n');
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}

module.exports = { VESPER_TOOLS, executeTool };
