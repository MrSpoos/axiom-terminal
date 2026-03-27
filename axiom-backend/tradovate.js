'use strict';
const WebSocket = require('ws');

/**
 * Tradovate Real-Time Market Data Integration
 * Connects to Tradovate's WebSocket API for live futures quotes
 * and populates the shared dxCache used by getLivePrice()
 */

const TRADOVATE_SYMBOL_MAP = {
  ES: 'ES', NQ: 'NQ', GC: 'GC', CL: 'CL'
};

let accessToken = null;
let mdToken = null;
let tokenExpiry = 0;

async function authenticate() {
  const name = process.env.TRADOVATE_USERNAME;
  const pw = process.env.TRADOVATE_PASSWORD;
  const appId = process.env.TRADOVATE_APP_ID || 'axiom-terminal';
  const cid = process.env.TRADOVATE_CID;
  const sec = process.env.TRADOVATE_SECRET;
  const isLive = process.env.TRADOVATE_ENV === 'live';
  const baseUrl = isLive
    ? 'https://live.tradovateapi.com/v1'
    : 'https://demo.tradovateapi.com/v1';

  if (!name || !pw) {
    console.warn('[Tradovate] TRADOVATE_USERNAME / TRADOVATE_PASSWORD not set');
    return false;
  }

  try {
    const body = { name, password: pw, appId, appVersion: '1.0', cid: parseInt(cid) || 0, sec: sec || '' };
    const res = await fetch(baseUrl + '/auth/accessTokenRequest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.accessToken) {
      accessToken = data.accessToken;
      mdToken = data.mdAccessToken || data.accessToken;
      tokenExpiry = Date.now() + 80 * 60 * 1000;
      console.log('[Tradovate] Authenticated OK');
      return true;
    }
    console.error('[Tradovate] Auth failed:', JSON.stringify(data).substring(0, 200));
    return false;
  } catch (err) {
    console.error('[Tradovate] Auth error:', err.message);
    return false;
  }
}

function connect(dxCache) {
  const name = process.env.TRADOVATE_USERNAME;
  if (!name) {
    console.warn('[Tradovate] TRADOVATE_USERNAME not set, skipping');
    return;
  }

  let ws = null;
  let reqId = 1;
  let heartbeatTimer = null;

  async function start() {
    const ok = await authenticate();
    if (!ok) return;

    const isLive = process.env.TRADOVATE_ENV === 'live';
    const mdUrl = isLive
      ? 'wss://md.tradovateapi.com/v1/websocket'
      : 'wss://md-demo.tradovateapi.com/v1/websocket';

    console.log('[Tradovate] Connecting to', mdUrl);
    ws = new WebSocket(mdUrl);

    ws.on('open', () => {
      console.log('[Tradovate] WebSocket open, authorizing...');
      ws.send('authorize\n' + (reqId++) + '\n\n' + mdToken);
    });

    ws.on('message', (raw) => {
      const text = raw.toString();
      if (text === 'o') { console.log('[Tradovate] Socket ready'); return; }
      if (text === 'h') return;
      if (text.startsWith('a')) {
        try {
          const arr = JSON.parse(text.substring(1));
          for (const frame of arr) handleFrame(frame, dxCache);
        } catch (_) {}
      }
    });

    ws.on('close', (code) => {
      console.log('[Tradovate] WS closed (' + code + '), reconnecting in 5 s');
      clearInterval(heartbeatTimer);
      setTimeout(start, 5000);
    });

    ws.on('error', (err) => {
      console.error('[Tradovate] WS error:', err.message);
    });

    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === 1) ws.send('[]');
    }, 2500);

    // Refresh token before 90-min expiry
    setTimeout(async () => {
      if (accessToken) {
        console.log('[Tradovate] Refreshing token...');
        await authenticate();
      }
    }, 75 * 60 * 1000);
  }

  function handleFrame(frame, cache) {
    let data;
    try { data = typeof frame === 'string' ? JSON.parse(frame) : frame; }
    catch (_) { return; }

    // Successful auth
    if (data.s === 200 && !data.d) {
      console.log('[Tradovate] Authorized, subscribing to quotes...');
      subscribeAll();
      return;
    }
    // Quote array
    if (data.d && data.d.quotes) {
      for (const q of data.d.quotes) processQuote(q, cache);
    }
    // Streaming quote update
    if (data.e === 'md' && data.d) processQuote(data.d, cache);
  }

  function processQuote(q, cache) {
    if (!q) return;
    const entries = q.entries || {};
    const trade = entries.Trade || entries.Last || {};
    const bid = entries.Bid || {};
    const offer = entries.Offer || {};
    const price = trade.price || bid.price || offer.price;
    if (!price) return;

    // Tradovate symbols look like ESM6, NQM6 etc. First 2 chars = product
    const product = (q.contractMaturity || q.name || '').substring(0, 2).toUpperCase();
    if (TRADOVATE_SYMBOL_MAP[product]) {
      const key = TRADOVATE_SYMBOL_MAP[product];
      const isNew = !cache[key];
      cache[key] = { price: parseFloat(price), ts: Date.now() };
      if (isNew) console.log('[Tradovate] First quote ' + key + ' = ' + price);
    }
  }

  function subscribeAll() {
    const contracts = (process.env.TRADOVATE_CONTRACTS || '').split(',').filter(Boolean);
    const symbols = contracts.length ? contracts : ['ES', 'NQ', 'GC', 'CL'];
    for (const s of symbols) {
      ws.send('md/subscribeQuote\n' + (reqId++) + '\n\n' + JSON.stringify({ symbol: s.trim() }));
      console.log('[Tradovate] Subscribed: ' + s.trim());
    }
  }

  start();
}

module.exports = { connect };

