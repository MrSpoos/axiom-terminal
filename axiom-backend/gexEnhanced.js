// ── GEX Enhancement Module ────────────────────────────────────────────────────
// Three-layer GEX data system:
//   1. TradingView Webhook  — intraday pushes from TV alerts (free, most current)
//   2. FlashAlpha API       — scheduled pulls + 15min RTH auto-refresh
//   3. Yahoo/Black-Scholes  — existing engine as final fallback
//
// Mount in server.js: require('./gexEnhanced')(app, ANTHROPIC_KEY);

const fetch = require('node-fetch');

// ── Shared GEX store ──────────────────────────────────────────────────────────
// Holds the best available GEX data, keyed by source priority
const gexStore = {
  webhook:     null,  // from TradingView alert pushes
  flashalpha:  null,  // from FlashAlpha API
  ts:          0,
  source:      'none',
};

function getBestGex() {
  // Prefer webhook (most live), then FlashAlpha, expose source for UI
  if (gexStore.webhook && (Date.now() - gexStore.webhook.ts) < 2 * 60 * 60 * 1000) {
    return { ...gexStore.webhook.data, _source: 'tradingview', _ts: gexStore.webhook.ts };
  }
  if (gexStore.flashalpha) {
    return { ...gexStore.flashalpha.data, _source: 'flashalpha', _ts: gexStore.flashalpha.ts };
  }
  return null; // caller falls back to Yahoo engine
}

// Returns the last known FlashAlpha data regardless of age (for stale fallback)
function getLastFlashAlpha() {
  return gexStore.flashalpha || null;
}

module.exports = function registerGexEnhanced(app, ANTHROPIC_KEY) {

  // ── POST /api/gex-webhook ─────────────────────────────────────────────────
  // Receives TradingView alert webhooks with GEX key levels.
  app.post('/api/gex-webhook', async (req, res) => {
    const secret = process.env.GEX_WEBHOOK_SECRET;
    const body   = req.body;

    if (secret && body.secret !== secret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const hasGexData = body.gamma_flip || body.call_wall || body.put_wall;

    if (hasGexData) {
      const data = {
        symbol:      body.symbol || 'ES',
        gamma_flip:  parseFloat(body.gamma_flip)  || null,
        call_wall:   parseFloat(body.call_wall)   || null,
        put_wall:    parseFloat(body.put_wall)     || null,
        hvl:         parseFloat(body.hvl)          || null,
        net_gex:     parseFloat(body.net_gex)      || null,
        regime:      body.regime || null,
        raw:         body,
      };
      gexStore.webhook = { data, ts: Date.now() };
      console.log(`GEX webhook (full): flip=${data.gamma_flip} call=${data.call_wall} put=${data.put_wall}`);
      res.json({ success: true, mode: 'full', received: data });
    } else {
      console.log(`GEX webhook (trigger): firing FlashAlpha pull...`);
      res.json({ success: true, mode: 'trigger', message: 'FlashAlpha pull triggered' });
      fetchFlashAlpha().catch(err => console.warn('Triggered FlashAlpha pull failed:', err.message));
    }
  });

  // ── GET /api/gex-webhook/status ───────────────────────────────────────────
  app.get('/api/gex-webhook/status', (req, res) => {
    const best = getBestGex();
    res.json({
      success: true,
      has_data: !!best,
      source: best?._source || 'none',
      last_update: best?._ts ? new Date(best._ts).toISOString() : null,
      data: best,
    });
  });

  // ── FlashAlpha fetch with SPX/NDX → SPY/QQQ fallback ─────────────────────
  // Free tier may not support SPX/NDX — automatically retry with SPY/QQQ

  async function fetchFlashAlphaForTicker(apiKey, sym, expiry) {
    const r = await fetch(`https://lab.flashalpha.com/v1/exposure/gex/${sym}?expiration=${expiry}`, {
      headers: { 'X-Api-Key': apiKey },
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json();
    if (d.error || d.message) return null; // API error or unsupported ticker
    if (!d.gamma_flip && !d.call_wall && !d.put_wall) return null; // empty
    return d;
  }

  async function fetchFlashAlpha() {
    const apiKey = process.env.FLASHALPHA_API_KEY;
    if (!apiKey) return;

    const expiry = getNearestExpiry();
    try {
      // ── FIX 1: SPX/NDX first, fallback to SPY/QQQ ──
      let spxData = null, ndxData = null;
      let spxTicker = null, ndxTicker = null;
      let spxScale = 1, ndxScale = 1;

      // Try SPX first
      spxData = await fetchFlashAlphaForTicker(apiKey, 'SPX', expiry);
      if (spxData) {
        spxTicker = 'SPX';
        spxScale = 1; // SPX ≈ ES directly
        console.log('FlashAlpha: SPX succeeded');
      } else {
        // Fallback to SPY
        spxData = await fetchFlashAlphaForTicker(apiKey, 'SPY', expiry);
        if (spxData) {
          spxTicker = 'SPY';
          spxScale = 10; // SPY × 10 ≈ ES
          console.log('FlashAlpha: SPX failed, SPY fallback succeeded');
        } else {
          console.warn('FlashAlpha: both SPX and SPY returned null');
        }
      }

      // Try NDX first
      ndxData = await fetchFlashAlphaForTicker(apiKey, 'NDX', expiry);
      if (ndxData) {
        ndxTicker = 'NDX';
        ndxScale = 1; // NDX ≈ NQ directly
        console.log('FlashAlpha: NDX succeeded');
      } else {
        // Fallback to QQQ
        ndxData = await fetchFlashAlphaForTicker(apiKey, 'QQQ', expiry);
        if (ndxData) {
          ndxTicker = 'QQQ';
          ndxScale = 40; // QQQ × 40 ≈ NQ
          console.log('FlashAlpha: NDX failed, QQQ fallback succeeded');
        } else {
          console.warn('FlashAlpha: both NDX and QQQ returned null');
        }
      }

      if (!spxData && !ndxData) {
        console.warn('FlashAlpha: no usable data from any ticker');
        return;
      }

      const scale = (val, mult) => val != null ? +(val * mult).toFixed(2) : null;

      const data = {
        gamma_flip:    scale(spxData?.gamma_flip, spxScale),
        call_wall:     scale(spxData?.call_wall, spxScale),
        put_wall:      scale(spxData?.put_wall, spxScale),
        net_gex:       spxData?.net_gex || null,
        regime:        spxData?.net_gex > 0 ? 'positive' : spxData?.net_gex < 0 ? 'negative' : null,
        nq_gamma_flip: scale(ndxData?.gamma_flip, ndxScale),
        nq_call_wall:  scale(ndxData?.call_wall, ndxScale),
        nq_put_wall:   scale(ndxData?.put_wall, ndxScale),
        expiry,
        es_ticker: spxTicker,
        nq_ticker: ndxTicker,
        raw_spx: spxData,
        raw_ndx: ndxData,
      };

      gexStore.flashalpha = { data, ts: Date.now() };
      console.log(`FlashAlpha GEX [${spxTicker || '?'}/${ndxTicker || '?'}]: ES flip=${data.gamma_flip} call=${data.call_wall} put=${data.put_wall} regime=${data.regime}`);
    } catch (err) {
      console.warn('FlashAlpha fetch failed:', err.message);
    }
  }

  function getNearestExpiry() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = now.getDay();
    const daysToFriday = day <= 5 ? 5 - day : 6;
    const friday = new Date(now);
    friday.setDate(now.getDate() + daysToFriday);
    return friday.toISOString().split('T')[0];
  }

  // ── FIX 4: RTH auto-refresh (15-minute interval during market hours) ──────
  function startRthAutoRefresh() {
    if (!process.env.FLASHALPHA_API_KEY) return;

    const RTH_REFRESH_MS = 15 * 60 * 1000; // 15 minutes

    setInterval(() => {
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const h = nowET.getHours();
      const m = nowET.getMinutes();
      const day = nowET.getDay();
      const minutesET = h * 60 + m;

      // RTH: 09:30–16:00 ET (570–960 minutes), weekdays only
      const isRTH = day >= 1 && day <= 5 && minutesET >= 570 && minutesET <= 960;
      if (!isRTH) return;

      // Check if last FlashAlpha update is stale (>15 min)
      const lastTs = gexStore.flashalpha?.ts || 0;
      const age = Date.now() - lastTs;
      if (age > RTH_REFRESH_MS) {
        console.log(`RTH auto-refresh: last GEX update ${Math.round(age / 60000)}min ago, refreshing...`);
        fetchFlashAlpha().catch(err => console.warn('RTH auto-refresh failed:', err.message));
      }
    }, 60 * 1000); // check every minute

    console.log('   RTH auto-refresh: 15min interval during 09:30–16:00 ET');
  }

  function scheduleFlashAlpha() {
    if (!process.env.FLASHALPHA_API_KEY) {
      console.log('⏭  FlashAlpha: FLASHALPHA_API_KEY not set — skipping schedule');
      return;
    }
    const pullTimesET = [
      { h: 9,  m: 30 },
      { h: 10, m: 30 },
      { h: 12, m: 0  },
      { h: 14, m: 30 },
      { h: 15, m: 45 },
    ];

    function scheduleNextPull() {
      const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const nowMins = nowET.getHours() * 60 + nowET.getMinutes();
      const day = nowET.getDay();
      if (day === 0 || day === 6) {
        setTimeout(scheduleNextPull, 60 * 60 * 1000);
        return;
      }
      const next = pullTimesET.find(t => t.h * 60 + t.m > nowMins);
      let msUntilNext;
      if (next) {
        const targetET = new Date(nowET);
        targetET.setHours(next.h, next.m, 0, 0);
        msUntilNext = targetET - nowET;
      } else {
        const tomorrow = new Date(nowET);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 30, 0, 0);
        while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) {
          tomorrow.setDate(tomorrow.getDate() + 1);
        }
        msUntilNext = tomorrow - nowET;
      }
      console.log(`FlashAlpha: next pull in ${Math.round(msUntilNext / 60000)} min`);
      setTimeout(async () => {
        await fetchFlashAlpha();
        scheduleNextPull();
      }, msUntilNext);
    }

    // Pull immediately on startup if within trading hours
    const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const h = nowET.getHours(), day = nowET.getDay();
    if (day >= 1 && day <= 5 && h >= 9 && h < 16) {
      fetchFlashAlpha();
    }
    scheduleNextPull();
  }

  scheduleFlashAlpha();
  startRthAutoRefresh();

  // ── GET /api/gex/enhanced ─────────────────────────────────────────────────
  app.get('/api/gex/enhanced', (req, res) => {
    const best = getBestGex();
    if (!best) {
      return res.json({
        success: false,
        source: 'none',
        message: 'No enhanced GEX data yet. Set up TradingView webhook or add FLASHALPHA_API_KEY.',
      });
    }
    res.json({ success: true, ...best });
  });

  // ── FIX 3: GET /api/gex — updated response format ────────────────────────
  // Returns structured response with data_age, source, stale flag.
  // Never returns null — always returns best available.
  app.get('/api/gex', async (req, res) => {
    try {
      // Check enhanced sources first (FlashAlpha / TradingView)
      const enhanced = getBestGex();
      if (enhanced) {
        const ageMs = Date.now() - enhanced._ts;
        const ageMinutes = Math.round(ageMs / 60000);
        const stale = ageMs > 4 * 60 * 60 * 1000; // >4 hours = stale

        const esData = {
          gamma_flip: enhanced.gamma_flip,
          call_wall:  enhanced.call_wall,
          put_wall:   enhanced.put_wall,
          net_gex:    enhanced.net_gex,
          regime:     enhanced.regime,
          expiry:     enhanced.expiry,
          ticker:     enhanced.es_ticker || null,
        };
        const nqData = {
          gamma_flip: enhanced.nq_gamma_flip,
          call_wall:  enhanced.nq_call_wall,
          put_wall:   enhanced.nq_put_wall,
          ticker:     enhanced.nq_ticker || null,
        };

        const response = {
          success: true,
          data: { ES: esData, NQ: nqData },
          source: enhanced._source,
          stale,
          last_market_day: getLastMarketDay(),
        };
        if (stale) {
          response.data_age_hours = Math.round(ageMs / 3600000 * 10) / 10;
        } else {
          response.data_age_minutes = ageMinutes;
        }
        return res.json(response);
      }

      // Fall back to Yahoo Black-Scholes engine — FIX 2: use SPY/QQQ
      const { calcGexForSymbol, buildGexResponse, dxCache } = getYahooGexEngine();

      const liveES = dxCache?.ES?.price || null;
      const liveNQ = dxCache?.NQ?.price || null;

      const [esRaw, nqRaw] = await Promise.allSettled([
        calcGexForSymbol('SPY', liveES),   // FIX 2: SPY (not SPX) for Yahoo
        calcGexForSymbol('QQQ', liveNQ),   // FIX 2: QQQ (not NDX) for Yahoo
      ]);

      const result = {};
      if (esRaw.status === 'fulfilled') {
        result.ES = buildGexResponse(esRaw.value, 10, liveES); // SPY × 10 ≈ ES
      } else {
        console.error('ES GEX Yahoo error:', esRaw.reason?.message);
        result.ES = null;
      }
      if (nqRaw.status === 'fulfilled') {
        result.NQ = buildGexResponse(nqRaw.value, 40, liveNQ); // QQQ × 40 ≈ NQ
      } else {
        console.error('NQ GEX Yahoo error:', nqRaw.reason?.message);
        result.NQ = null;
      }

      // If Yahoo also failed, return last cached FlashAlpha as stale
      if (!result.ES && !result.NQ) {
        const lastFA = getLastFlashAlpha();
        if (lastFA) {
          const ageMs = Date.now() - lastFA.ts;
          return res.json({
            success: true,
            data: {
              ES: {
                gamma_flip: lastFA.data.gamma_flip,
                call_wall:  lastFA.data.call_wall,
                put_wall:   lastFA.data.put_wall,
                net_gex:    lastFA.data.net_gex,
                regime:     lastFA.data.regime,
              },
              NQ: {
                gamma_flip: lastFA.data.nq_gamma_flip,
                call_wall:  lastFA.data.nq_call_wall,
                put_wall:   lastFA.data.nq_put_wall,
              },
            },
            source: 'flashalpha_cached',
            stale: true,
            data_age_hours: Math.round(ageMs / 3600000 * 10) / 10,
            last_market_day: getLastMarketDay(),
          });
        }
        // Truly nothing available
        return res.json({
          success: false,
          data: { ES: null, NQ: null },
          source: 'none',
          stale: true,
          last_market_day: getLastMarketDay(),
        });
      }

      return res.json({
        success: true,
        data: result,
        source: 'yahoo_bs',
        stale: false,
        data_age_minutes: 0,
        last_market_day: getLastMarketDay(),
      });
    } catch (err) {
      console.error('GEX endpoint error:', err);
      // Even on error, try to return stale data
      const lastFA = getLastFlashAlpha();
      if (lastFA) {
        const ageMs = Date.now() - lastFA.ts;
        return res.json({
          success: true,
          data: {
            ES: { gamma_flip: lastFA.data.gamma_flip, call_wall: lastFA.data.call_wall, put_wall: lastFA.data.put_wall, regime: lastFA.data.regime },
            NQ: { gamma_flip: lastFA.data.nq_gamma_flip, call_wall: lastFA.data.nq_call_wall, put_wall: lastFA.data.nq_put_wall },
          },
          source: 'flashalpha_cached',
          stale: true,
          data_age_hours: Math.round(ageMs / 3600000 * 10) / 10,
          last_market_day: getLastMarketDay(),
          error: err.message,
        });
      }
      res.status(500).json({ success: false, error: err.message, data: { ES: null, NQ: null }, source: 'none', stale: true });
    }
  });

  // ── POST /api/gex/force-refresh ───────────────────────────────────────────
  app.post('/api/gex/force-refresh', async (req, res) => {
    if (!process.env.FLASHALPHA_API_KEY) {
      return res.status(400).json({ error: 'FLASHALPHA_API_KEY not configured' });
    }
    await fetchFlashAlpha();
    const best = getBestGex();
    res.json({ success: true, data: best, source: best?._source || 'none' });
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function getLastMarketDay() {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = now.getDay();
    const h = now.getHours();
    // If weekend or before market open, use previous business day
    let d = new Date(now);
    if (day === 0) d.setDate(d.getDate() - 2);       // Sunday → Friday
    else if (day === 6) d.setDate(d.getDate() - 1);   // Saturday → Friday
    else if (h < 9) d.setDate(d.getDate() - (day === 1 ? 3 : 1)); // Before open → prev day
    return d.toISOString().split('T')[0];
  }

  // Reference to Yahoo GEX engine functions from server.js
  // These are defined in server.js scope — we access them via app.locals
  function getYahooGexEngine() {
    return {
      calcGexForSymbol: app.locals.calcGexForSymbol || (async () => { throw new Error('Yahoo GEX engine not available'); }),
      buildGexResponse: app.locals.buildGexResponse || (() => null),
      dxCache: app.locals.dxCache || {},
    };
  }

  console.log('✅ GEX Enhanced: POST /api/gex-webhook | GET /api/gex | GET /api/gex/enhanced | POST /api/gex/force-refresh');
  console.log(`   TradingView webhook: ready ${process.env.GEX_WEBHOOK_SECRET ? '(secret protected)' : '(no secret set)'}`);
  console.log(`   FlashAlpha: ${process.env.FLASHALPHA_API_KEY ? 'enabled' : 'add FLASHALPHA_API_KEY to enable'}`);
};
