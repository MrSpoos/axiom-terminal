// ── Vesper Agent Tools ────────────────────────────────────────────────────────
// Defines the tools Vesper can call during a conversation.
// Each tool runs against real backend data and returns structured JSON.

const fetch = require('node-fetch');
const { runMacroAgent } = require('./macroAgent');
const { runCorrelationAgent } = require('./correlationAgent');

// ── Tool definitions for Claude API ──────────────────────────────────────────
const VESPER_TOOLS = [
  {
    name: 'run_macro_agent',
    description: 'Fetches the economic calendar and assesses macro/catalyst risk for the next 48 hours. Use this when the trader asks about news risk, upcoming events, whether it is safe to trade, or when you need to assess if a setup might be invalidated by a scheduled release.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'run_correlation_agent',
    description: 'Fetches DXY, VIX, and ZN (10yr Treasury futures) and assesses inter-market alignment for a given instrument. Use this when assessing whether macro tailwinds or headwinds support or contradict a directional bias.',
    input_schema: {
      type: 'object',
      properties: {
        instrument: {
          type: 'string',
          enum: ['ES', 'NQ', 'GC', 'CL'],
          description: 'The futures instrument to assess correlation for.',
        },
      },
      required: ['instrument'],
    },
  },
  {
    name: 'get_market_snapshot',
    description: 'Gets live prices for ES, NQ, GC, CL, VIX, and ETFs. Use this when you need current price levels, session highs/lows, or want to reference where instruments are trading right now.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_news_feed',
    description: 'Fetches the latest market news headlines from Reuters, CNBC, MarketWatch, and Yahoo Finance. Use this when the trader asks about what is moving the market, recent headlines, or breaking news context.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

module.exports = { VESPER_TOOLS };
// ── Tool executor — runs the actual agent when Vesper requests it ─────────────
async function executeTool(toolName, toolInput, anthropicKey, backendUrl) {
  switch (toolName) {

    case 'run_macro_agent': {
      const result = await runMacroAgent(anthropicKey);
      return JSON.stringify(result, null, 2);
    }

    case 'run_correlation_agent': {
      const instrument = toolInput.instrument || 'ES';
      const result = await runCorrelationAgent(instrument, anthropicKey);
      return JSON.stringify(result, null, 2);
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
      const headlines = (d.data || []).slice(0, 8).map(n =>
        `[${n.impact?.toUpperCase()}] ${n.source} — ${n.headline}`
      );
      return headlines.join('\n');
    }

    default:
      return `Unknown tool: ${toolName}`;
  }
}

module.exports = { VESPER_TOOLS, executeTool };
