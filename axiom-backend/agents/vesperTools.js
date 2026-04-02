// ── Vesper Agent Tools ────────────────────────────────────────────────────────
const fetch = require('node-fetch');
const { runMacroAgent }          = require('./macroAgent');
const { runCorrelationAgent }    = require('./correlationAgent');
const { runSessionAgent }        = require('./sessionAgent');
const { runTrapAgent }           = require('./trapAgent');
const { runDevilsAdvocateAgent } = require('./devilsAdvocateAgent');
const { runBearCaseAgent }       = require('./bearCaseAgent');
const { runArbiterAgent }        = require('./arbiterAgent');

const VESPER_TOOLS = [
  {
    name: 'run_full_analysis',
    description: `Runs the complete 7-agent analysis suite and returns a synthesised verdict.
Use this for ANY broad market question: "assess the market", "what's your read", "should I take this trade", "give me your honest view", "what's the bias", "where are we".
Runs in sequence: Macro → Correlation → Session → Trap (Tier 1), then Devil's Advocate + Bear Case (Tier 2), then Probability Arbiter (Tier 3).
Returns: bull/bear probability split, alert gate (alert/monitor/suppress), the contrarian stress test verdict, an independent bear case, and a one-paragraph synthesis.
This is the definitive assessment tool — use it whenever a comprehensive view is needed.`,
    input_schema: {
      type: 'object',
      properties: {
        instrument: { type: 'string', enum: ['ES', 'NQ', 'GC', 'CL'], description: 'The futures instrument to analyse.' },
      },
      required: ['instrument'],
    },
  },
  {
    name: 'run_macro_agent',
    description: 'Checks the economic calendar for event risk in the next 48 hours. Use for specific questions about news risk, upcoming releases, or whether the calendar is clear.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'run_correlation_agent',
    description: 'Checks DXY, VIX, and ZN (10yr Treasury) inter-market alignment. Use for specific questions about dollar strength, fear index, or bond market direction.',
    input_schema: {
      type: 'object',
      properties: {
        instrument: { type: 'string', enum: ['ES', 'NQ', 'GC', 'CL'] },
      },
      required: ['instrument'],
    },
  },
  {
    name: 'run_session_agent',
    description: 'Classifies day type in progress, IB status, and value area position. Use for specific questions about session character, IB formation, or what kind of day is developing.',
    input_schema: {
      type: 'object',
      properties: {
        instrument: { type: 'string', enum: ['ES', 'NQ', 'GC', 'CL'] },
      },
      required: ['instrument'],
    },
  },
  {
    name: 'run_trap_agent',
    description: 'Identifies stop hunts, liquidity grabs, bull traps, and bear traps. Use for specific questions about whether a move is real or a trap.',
    input_schema: {
      type: 'object',
      properties: {
        instrument: { type: 'string', enum: ['ES', 'NQ', 'GC', 'CL'] },
      },
      required: ['instrument'],
    },
  },
  {
    name: 'get_market_snapshot',
    description: 'Gets live prices for ES, NQ, GC, CL, and VIX. Use for quick price checks.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_news_feed',
    description: 'Fetches the latest market headlines. Use when asked about news or what is moving the market.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'run_gex_agent',
    description: 'Fetches live Gamma Exposure (GEX) levels: gamma flip point, call wall, put wall, HVL, net GEX, and dealer regime (positive/negative gamma). Use when asked about gamma levels, dealer positioning, options-driven support/resistance, or whether the market is in a pinning or amplifying regime. Also use when assessing whether a key level has gamma significance.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

async function executeTool(toolName, toolInput, anthropicKey, backendUrl) {
  switch (toolName) {

    case 'run_full_analysis': {
      const instrument = toolInput.instrument || 'ES';

      // Tier 1 — all four in parallel
      const [macroR, corrR, sessionR, trapR] = await Promise.allSettled([
        runMacroAgent(anthropicKey),
        runCorrelationAgent(instrument, anthropicKey),
        runSessionAgent(instrument, null, anthropicKey),
        runTrapAgent(instrument, null, anthropicKey),
      ]);

      const tier1 = {
        macro:       macroR.status   === 'fulfilled' ? macroR.value   : { error: macroR.reason?.message },
        correlation: corrR.status    === 'fulfilled' ? corrR.value    : { error: corrR.reason?.message },
        session:     sessionR.status === 'fulfilled' ? sessionR.value : { error: sessionR.reason?.message },
        trap:        trapR.status    === 'fulfilled' ? trapR.value    : { error: trapR.reason?.message },
      };

      // Tier 2 — opposition layer in parallel
      const [daR, bcR] = await Promise.allSettled([
        runDevilsAdvocateAgent(instrument, tier1, anthropicKey),
        runBearCaseAgent(instrument, tier1, anthropicKey),
      ]);

      const tier2 = {
        devilsAdvocate: daR.status === 'fulfilled' ? daR.value : { error: daR.reason?.message },
        bearCase:       bcR.status === 'fulfilled' ? bcR.value : { error: bcR.reason?.message },
      };

      // Tier 3 — Arbiter synthesises everything
      const allResults = { ...tier1, ...tier2 };
      let arbiter;
      try {
        arbiter = await runArbiterAgent(instrument, allResults, anthropicKey);
      } catch (err) {
        arbiter = { error: err.message };
      }

      // Return a compact but complete summary for Vesper to synthesise
      // Fetch GEX levels (enhanced first, fallback to Yahoo engine)
      let gexData = null;
      try {
        const gexR = await fetch(`${backendUrl}/api/gex/enhanced`);
        const gexD = await gexR.json();
        if (gexD.success) {
          gexData = { source: gexD._source, gamma_flip: gexD.gamma_flip, call_wall: gexD.call_wall, put_wall: gexD.put_wall, regime: gexD.regime, net_gex: gexD.net_gex };
        } else {
          const fbR = await fetch(`${backendUrl}/api/gex`);
          const fbD = await fbR.json();
          if (fbD.success) {
            const g = fbD.data;
            gexData = { source: 'yahoo_bs', gamma_flip: g.es?.flipPoint || g.flipPoint, call_wall: g.es?.callWall || g.callWall, put_wall: g.es?.putWall || g.putWall, regime: g.es?.regime || g.regime };
          }
        }
      } catch {}

      return JSON.stringify({
        instrument,
        arbiter_verdict: {
          bull_pct:           arbiter?.bull_pct,
          bear_pct:           arbiter?.bear_pct,
          alert_gate:         arbiter?.alert_gate,
          confidence_tier:    arbiter?.confidence_tier,
          dominant_narrative: arbiter?.dominant_narrative,
          synthesis:          arbiter?.synthesis,
          veto_applied:       arbiter?.veto_applied,
          veto_reason:        arbiter?.veto_reason,
          key_factors:        arbiter?.key_factors,
        },
        macro: {
          event_risk_level: tier1.macro?.event_risk_level,
          setup_verdict:    tier1.macro?.setup_verdict,
          next_event:       tier1.macro?.next_event,
          thesis:           tier1.macro?.thesis,
        },
        correlation: {
          alignment:       tier1.correlation?.alignment,
          tailwind_score:  tier1.correlation?.tailwind_score,
          dxy_trend:       tier1.correlation?.readings?.dxy_trend,
          vix_level:       tier1.correlation?.readings?.vix_level,
          bonds_trend:     tier1.correlation?.readings?.bonds_trend,
          thesis:          tier1.correlation?.thesis,
        },
        session: {
          day_type:        tier1.session?.day_type_in_progress,
          value_position:  tier1.session?.value_position,
          ib_formed:       tier1.session?.ib_status?.formed,
          ib_high:         tier1.session?.ib_status?.ib_high,
          ib_low:          tier1.session?.ib_status?.ib_low,
          ib_extension:    tier1.session?.ib_status?.extension,
          thesis:          tier1.session?.thesis,
        },
        trap: {
          trap_risk:    tier1.trap?.trap_risk,
          trap_type:    tier1.trap?.trap_type,
          key_levels:   tier1.trap?.key_levels_at_risk,
          thesis:       tier1.trap?.thesis,
        },
        devils_advocate: {
          verdict:             tier2.devilsAdvocate?.verdict,
          stress_score:        tier2.devilsAdvocate?.stress_score,
          weakest_link:        tier2.devilsAdvocate?.weakest_link,
          failure_scenarios:   tier2.devilsAdvocate?.failure_scenarios?.slice(0, 2),
          invalidation_levels: tier2.devilsAdvocate?.invalidation_levels,
          summary:             tier2.devilsAdvocate?.summary,
        },
        bear_case: {
          quality:          tier2.bearCase?.bear_case_quality,
          primary_driver:   tier2.bearCase?.primary_driver,
          trigger_catalyst: tier2.bearCase?.trigger_catalyst,
          target_levels:    tier2.bearCase?.target_levels,
          summary:          tier2.bearCase?.summary,
        },
        timestamp: new Date().toISOString(),
        gex: gexData,
      }, null, 2);
    }

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
      return (d.data || []).slice(0, 8).map(n =>
        `[${n.impact?.toUpperCase()}] ${n.source} — ${n.headline}`
      ).join('\n');
    }
    case 'run_gex_agent': {
      // Try enhanced (TradingView webhook / FlashAlpha) first, fall back to Yahoo engine
      const enhanced = await fetch(`${backendUrl}/api/gex/enhanced`);
      const eData = await enhanced.json();
      if (eData.success) {
        return JSON.stringify({
          source:      eData._source,
          last_update: eData._ts ? new Date(eData._ts).toISOString() : null,
          gamma_flip:  eData.gamma_flip,
          call_wall:   eData.call_wall,
          put_wall:    eData.put_wall,
          hvl:         eData.hvl || null,
          net_gex:     eData.net_gex,
          regime:      eData.regime,
          nq_gamma_flip: eData.nq_gamma_flip || null,
          nq_call_wall:  eData.nq_call_wall  || null,
          nq_put_wall:   eData.nq_put_wall   || null,
        }, null, 2);
      }
      // Fallback to Yahoo/Black-Scholes engine
      const fallback = await fetch(`${backendUrl}/api/gex`);
      const fData = await fallback.json();
      if (!fData.success) return 'GEX data unavailable';
      const g = fData.data;
      return JSON.stringify({
        source:     'yahoo_bs_engine',
        gamma_flip: g.es?.flipPoint  || g.flipPoint,
        call_wall:  g.es?.callWall   || g.callWall,
        put_wall:   g.es?.putWall    || g.putWall,
        net_gex:    g.es?.netGex     || g.netGex,
        regime:     g.es?.regime     || g.regime,
        nq_gamma_flip: g.nq?.flipPoint || null,
        nq_call_wall:  g.nq?.callWall  || null,
        nq_put_wall:   g.nq?.putWall   || null,
      }, null, 2);
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}

module.exports = { VESPER_TOOLS, executeTool };
