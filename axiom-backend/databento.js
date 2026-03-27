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
