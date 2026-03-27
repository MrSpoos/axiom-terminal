'use strict';
const fetch = require('node-fetch');

/**
 * Databento Real-Time Futures Price Polling
 * Uses Databento HTTP API to poll latest prices for ES, NQ, GC, CL
 * and populate the shared dxCache used by getLivePrice()
 */

const POLL_INTERVAL = 10000;
const API_BASE = 'https://hist.databento.com/v0';
const DATASET = 'GLBX.MDP3';

const SYMBOL_MAP = {
  ES: 'ES', NQ: 'NQ', GC: 'GC', CL: 'CL'
};

let pollTimer = null;
let pollCount = 0;

async function fetchLatestPrices(dxCache) {
  const apiKey = process.env.DATABENTO_API_KEY;
  if (!apiKey) return;

  pollCount++;
  const symbols = 'ES.FUT,NQ.FUT,GC.FUT,CL.FUT';
  const now = new Date();
  const fiveMinAgo = new Date(now.getTime() - 5 * 60000);

  const params = new URLSearchParams({
    dataset: DATASET,
    symbols: symbols,
    schema: 'ohlcv-1m',
    start: fiveMinAgo.toISOString(),
    stype_in: 'continuous',
    encoding: 'json'
  });

  try {
    const url = API_BASE + '/timeseries.get_range?' + params.toString();
    if (pollCount <= 3) console.log('[Databento] Polling: ' + url.substring(0, 120) + '...');

    const res = await fetch(url, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(apiKey + ':').toString('base64'),
        'Accept': 'application/json'
      },
      timeout: 8000
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[Databento] HTTP ' + res.status + ': ' + errText.substring(0, 300));
      return;
    }

    const text = await res.text();
    if (pollCount <= 3) console.log('[Databento] Response length: ' + text.length + ' chars');

    const records = text.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch(_) { return null; }
    }).filter(Boolean);

    if (pollCount <= 3) console.log('[Databento] Parsed ' + records.length + ' records');
    if (records.length > 0 && pollCount <= 3) {
      console.log('[Databento] Sample record keys: ' + Object.keys(records[0]).join(', '));
      console.log('[Databento] Sample: ' + JSON.stringify(records[0]).substring(0, 300));
    }

    for (const rec of records) {
      const sym = rec.symbol || '';
      let cacheKey = null;

      // Try exact match first
      for (const [dbSym, ourKey] of Object.entries(SYMBOL_MAP)) {
        if (sym === dbSym || sym.startsWith(dbSym)) {
          cacheKey = ourKey;
          break;
        }
      }
      // Try prefix match (ESM6 -> ES)
      if (!cacheKey) {
        const prefix = sym.substring(0, 2).toUpperCase();
        if (SYMBOL_MAP[prefix]) cacheKey = prefix;
      }

      if (cacheKey && rec.close) {
        // Databento uses fixed-point prices (9 decimal places for most)
        const rawClose = rec.close;
        const price = rawClose > 1e6 ? rawClose / 1e9 : rawClose;
        const isNew = !dxCache[cacheKey];
        dxCache[cacheKey] = { price, ts: Date.now() };
        if (isNew) console.log('[Databento] ' + cacheKey + ' = ' + price + ' (raw: ' + rawClose + ')');
      }
    }

  } catch (err) {
    console.error('[Databento] Poll error:', err.message);
  }
}

function connect(dxCache) {
  const apiKey = process.env.DATABENTO_API_KEY;
  if (!apiKey) {
    console.warn('[Databento] DATABENTO_API_KEY not set, skipping');
    return;
  }

  console.log('[Databento] Starting price polling every ' + (POLL_INTERVAL / 1000) + 's');
  console.log('[Databento] API key: ' + apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4));

  fetchLatestPrices(dxCache);
  pollTimer = setInterval(() => fetchLatestPrices(dxCache), POLL_INTERVAL);
}

module.exports = { connect };
'use strict';
const fetch = require('node-fetch');

/**
 * Databento Real-Time Futures Price Polling
 * Uses Databento HTTP API to poll latest prices for ES, NQ, GC, CL
 * and populate the shared dxCache used by getLivePrice()
 *
 * Requires: DATABENTO_API_KEY env var
 */

const POLL_INTERVAL = 10000; // Poll every 10 seconds
const API_BASE = 'https://hist.databento.com/v0';
const DATASET = 'GLBX.MDP3'; // CME Group

// Map Databento symbols to our cache keys
const SYMBOL_MAP = {
  'ES.FUT': 'ES',
  'NQ.FUT': 'NQ',
  'GC.FUT': 'GC',
  'CL.FUT': 'CL'
};

let pollTimer = null;
let lastPollOk = false;

async function fetchLatestPrices(dxCache) {
  const apiKey = process.env.DATABENTO_API_KEY;
  if (!apiKey) return;

  const symbols = Object.keys(SYMBOL_MAP).join(',');
  // Get the last 1 minute of trade data
  const now = new Date();
  const oneMinAgo = new Date(now.getTime() - 60000);

  const params = new URLSearchParams({
    dataset: DATASET,
    symbols: symbols,
    schema: 'ohlcv-1m',
    start: oneMinAgo.toISOString(),
    end: now.toISOString(),
    stype_in: 'continuous',
    encoding: 'json',
    limit: '4'
  });

  try {
    const url = API_BASE + '/timeseries.get_range?' + params.toString();
    const res = await fetch(url, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(apiKey + ':').toString('base64'),
        'Accept': 'application/json'
      },
      timeout: 8000
    });

    if (!res.ok) {
      const text = await res.text();
      if (!lastPollOk) return; // Don't spam logs
      console.error('[Databento] HTTP ' + res.status + ': ' + text.substring(0, 200));
      lastPollOk = false;
      return;
    }

    const text = await res.text();
    // Databento returns newline-delimited JSON
    const records = text.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch(_) { return null; }
    }).filter(Boolean);

    for (const rec of records) {
      // OHLCV record has: symbol, open, high, low, close, volume
      const sym = rec.symbol || '';
      // Try matching by the continuous symbol or by raw symbol prefix
      let cacheKey = SYMBOL_MAP[sym];
      if (!cacheKey) {
        // Try matching by first 2 chars (e.g. ESM5 -> ES)
        const prefix = sym.substring(0, 2);
        cacheKey = Object.values(SYMBOL_MAP).find(v => v === prefix);
      }

      if (cacheKey && rec.close) {
        const price = rec.close / 1e9; // Databento uses fixed-point (9 decimal places)
        const isNew = !dxCache[cacheKey];
        dxCache[cacheKey] = { price, ts: Date.now() };
        if (isNew || !lastPollOk) {
          console.log('[Databento] ' + cacheKey + ' = ' + price);
        }
      }
    }

    if (!lastPollOk && records.length > 0) {
      console.log('[Databento] Polling active, got ' + records.length + ' records');
    }
    lastPollOk = true;

  } catch (err) {
    if (lastPollOk) {
      console.error('[Databento] Poll error:', err.message);
      lastPollOk = false;
    }
  }
}

function connect(dxCache) {
  const apiKey = process.env.DATABENTO_API_KEY;
  if (!apiKey) {
    console.warn('[Databento] DATABENTO_API_KEY not set, skipping');
    return;
  }

  console.log('[Databento] Starting price polling every ' + (POLL_INTERVAL / 1000) + 's');

  // Initial fetch
  fetchLatestPrices(dxCache);

  // Poll on interval
  pollTimer = setInterval(() => fetchLatestPrices(dxCache), POLL_INTERVAL);
}

module.exports = { connect };
