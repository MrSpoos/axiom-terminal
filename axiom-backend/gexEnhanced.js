// ── GEX Enhancement Module ────────────────────────────────────────────────────
// Three-layer GEX data system:
//   1. TradingView Webhook  — intraday pushes from TV alerts (free, most current)
//   2. FlashAlpha API       — scheduled pulls 5x/day (free tier, pre-calculated)
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
  if (gexStore.flashalpha && (Date.now() - gexStore.flashalpha.ts) < 4 * 60 * 60 * 1000) {
    return { ...gexStore.flashalpha.data, _source: 'flashalpha', _ts: gexStore.flashalpha.ts };
  }
  return null; // caller falls back to Yahoo engine
}

module.exports = function registerGexEnhanced(app, ANTHROPIC_KEY) {

  // ── POST /api/gex-webhook ─────────────────────────────────────────────────
  // Receives TradingView alert webhooks with GEX key levels.
  // TradingView alert message format (JSON):
  // {
  //   "secret": "YOUR_WEBHOOK_SECRET",
  //   "symbol": "ES",
  //   "gamma_flip": 5500,
  //   "call_wall": 5600,
  //   "put_wall": 5400,
  //   "hvl": 5520,
  //   "net_gex": 2500000000,
  //   "regime": "positive"
  // }
  app.post('/api/gex-webhook', async (req, res) => {
    const secret = process.env.GEX_WEBHOOK_SECRET;
    const body   = req.body;

    // Validate secret if set
    if (secret && body.secret !== secret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    const hasGexData = body.gamma_flip || body.call_wall || body.put_wall;

    if (hasGexData) {
      // Full GEX payload from TradingView indicator (TanukiTrade PRO etc.)
      const data = {
        symbol:      body.symbol || 'ES',
        gamma_flip:  parseFloat(body.gamma_flip)  || null,
        call_wall:   parseFloat(body.call_wall)   || null,
        put_wall:    parseFloat(body.put_wall)    || null,
        hvl:         parseFloat(body.hvl)         || null,
        net_gex:     parseFloat(body.net_gex)     || null,
        regime:      body.regime || null,
        raw:         body,
      };
      gexStore.webhook = { data, ts: Date.now() };
      console.log(`GEX webhook (full): flip=${data.gamma_flip} call=${data.call_wall} put=${data.put_wall}`);
      res.json({ success: true, mode: 'full', received: data });
    } else {
      // Heartbeat trigger from TradingView — fire FlashAlpha pull immediately
      console.log(`GEX webhook (trigger): firing FlashAlpha pull...`);
      res.json({ success: true, mode: 'trigger', message: 'FlashAlpha pull triggered' });
      // Pull asynchronously so we don't block the response
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

  // ── FlashAlpha scheduled pulls (5x/day on trading days) ───────────────────
  // Free tier: 5 requests/day, single-expiry GEX + gamma_flip
  // Times: 9:30, 10:30, 12:00, 14:30, 15:45 ET

  async function fetchFlashAlpha() {
    const apiKey = process.env.FLASHALPHA_API_KEY;
    if (!apiKey) return;

    // Use nearest Friday expiry as the target
    const expiry = getNearestExpiry();
    try {
      const [spyRes, qqqRes] = await Promise.allSettled([
        fetch(`https://lab.flashalpha.com/v1/exposure/gex/SPY?expiration=${expiry}`, {
          headers: { 'X-Api-Key': apiKey },
          timeout: 10000,
        }).then(r => r.json()),
        fetch(`https://lab.flashalpha.com/v1/exposure/gex/QQQ?expiration=${expiry}`, {
          headers: { 'X-Api-Key': apiKey },
          timeout: 10000,
        }).then(r => r.json()),
      ]);

      const spy = spyRes.status === 'fulfilled' ? spyRes.value : null;
      const qqq = qqqRes.status === 'fulfilled' ? qqqRes.value : null;

      if (!spy && !qqq) return;

      // Scale SPY gamma flip → ES, QQQ gamma flip → NQ
      // SPY ≈ SPX/10, ES ≈ SPX  → ES ≈ SPY × 10
      // QQQ ≈ NDX/40 → NQ ≈ QQQ × 40
      const data = {
        // ES levels (scaled from SPY)
        gamma_flip: spy?.gamma_flip ? +(spy.gamma_flip * 10).toFixed(2) : null,
        call_wall:  spy?.call_wall  ? +(spy.call_wall  * 10).toFixed(2) : null,
        put_wall:   spy?.put_wall   ? +(spy.put_wall   * 10).toFixed(2) : null,
        net_gex:    spy?.net_gex    || null,
        regime:     spy?.net_gex > 0 ? 'positive' : 'negative',
        // NQ levels (scaled from QQQ)
        nq_gamma_flip: qqq?.gamma_flip ? +(qqq.gamma_flip * 40).toFixed(2) : null,
        nq_call_wall:  qqq?.call_wall  ? +(qqq.call_wall  * 40).toFixed(2) : null,
        nq_put_wall:   qqq?.put_wall   ? +(qqq.put_wall   * 40).toFixed(2) : null,
        expiry,
        raw_spy: spy,
        raw_qqq: qqq,
      };

      gexStore.flashalpha = { data, ts: Date.now() };
      console.log(`FlashAlpha GEX: ES flip=${data.gamma_flip} call=${data.call_wall} put=${data.put_wall} regime=${data.regime}`);
    } catch (err) {
      console.warn('FlashAlpha fetch failed:', err.message);
    }
  }

  function getNearestExpiry() {
    // Get nearest Friday (or today if Friday) in YYYY-MM-DD
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const day = now.getDay(); // 0=Sun, 5=Fri
    const daysToFriday = day <= 5 ? 5 - day : 6;
    const friday = new Date(now);
    friday.setDate(now.getDate() + daysToFriday);
    return friday.toISOString().split('T')[0];
  }

  function scheduleFlashAlpha() {
    if (!process.env.FLASHALPHA_API_KEY) {
      console.log('⏭  FlashAlpha: FLASHALPHA_API_KEY not set — skipping schedule');
      return;
    }
    // Pull times in ET (24h): 9:30, 10:30, 12:00, 14:30, 15:45
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
      // Skip weekends
      if (day === 0 || day === 6) {
        setTimeout(scheduleNextPull, 60 * 60 * 1000); // check again in 1hr
        return;
      }
      // Find next pull time today
      const next = pullTimesET.find(t => t.h * 60 + t.m > nowMins);
      let msUntilNext;
      if (next) {
        const targetET = new Date(nowET);
        targetET.setHours(next.h, next.m, 0, 0);
        msUntilNext = targetET - nowET;
      } else {
        // All pulls done for today — schedule for 9:30 tomorrow
        const tomorrow = new Date(nowET);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 30, 0, 0);
        // Skip to Monday if weekend
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

  // ── GET /api/gex/enhanced ─────────────────────────────────────────────────
  // Returns best available GEX data with source tag.
  // Frontend and Vesper both call this.
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

  // ── POST /api/gex/force-refresh ───────────────────────────────────────────
  // Manual trigger for FlashAlpha pull (for testing or manual refresh)
  app.post('/api/gex/force-refresh', async (req, res) => {
    if (!process.env.FLASHALPHA_API_KEY) {
      return res.status(400).json({ error: 'FLASHALPHA_API_KEY not configured' });
    }
    await fetchFlashAlpha();
    const best = getBestGex();
    res.json({ success: true, data: best, source: best?._source || 'none' });
  });

  console.log('✅ GEX Enhanced: POST /api/gex-webhook | GET /api/gex/enhanced | POST /api/gex/force-refresh');
  console.log(`   TradingView webhook: ready ${process.env.GEX_WEBHOOK_SECRET ? '(secret protected)' : '(no secret set)'}`);
  console.log(`   FlashAlpha: ${process.env.FLASHALPHA_API_KEY ? 'enabled' : 'add FLASHALPHA_API_KEY to enable'}`);
};
