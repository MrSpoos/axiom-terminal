const WS_URL = "wss://rtc.topstepx.com/hubs/market";

export const CONTRACT_IDS = {
  ES: "CON.F.US.EP.M25",
  NQ: "CON.F.US.ENQ.M25",
  GC: "CON.F.US.GC.M25",
  CL: "CON.F.US.CL.M25",
};

class ProjectXService {
  constructor() {
    this.ws = null;
    this.token = null;
    this._quoteCallbacks = [];
    this._statusCallbacks = [];
    this._subscribed = new Set();
    this._reconnectTimer = null;
    this._intentionalClose = false;
  }

  connect(jwtToken) {
    this.token = jwtToken;
    this._intentionalClose = false;
    this._open();
  }

  _open() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
    }
    const url = `${WS_URL}?access_token=${encodeURIComponent(this.token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this._emit("connected");
      // Re-subscribe to all previously subscribed contracts
      for (const contractId of this._subscribed) {
        this._sendSubscribe(contractId);
      }
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        this._handleMessage(msg);
      } catch {
        // ignore unparseable frames
      }
    };

    this.ws.onerror = () => {
      this._emit("error");
    };

    this.ws.onclose = () => {
      if (this._intentionalClose) return;
      this._emit("disconnected");
      // Auto-reconnect after 3 seconds
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(() => {
        if (!this._intentionalClose && this.token) this._open();
      }, 3000);
    };
  }

  _handleMessage(msg) {
    // TopstepX / SignalR messages may arrive as:
    //   { type: "quote", data: { contractId, bid, ask, last, timestamp } }
    //   or SignalR envelope: { type: 1, target: "Quote", arguments: [...] }
    if (msg.type === 1 && msg.target) {
      // SignalR hub invocation
      const target = msg.target.toLowerCase();
      if (target === "quote" || target === "quoteupdated") {
        const args = msg.arguments || [];
        const q = args[0] || {};
        this._fireQuote(q);
      }
      return;
    }
    if (msg.topic) {
      // Alternative flat format
      const q = msg.data || msg;
      this._fireQuote(q);
    }
  }

  _fireQuote(q) {
    const price = q.last ?? q.lastPrice ?? q.price ?? q.tradePrice;
    const bid   = q.bid  ?? q.bidPrice;
    const ask   = q.ask  ?? q.askPrice;
    const contractId = q.contractId ?? q.contract_id ?? q.symbol;
    if (price == null && bid == null) return;
    const quote = {
      contractId,
      price: price ?? ((bid + ask) / 2),
      bid,
      ask,
      timestamp: q.timestamp ?? q.ts ?? Date.now(),
    };
    for (const cb of this._quoteCallbacks) {
      try { cb(quote); } catch {}
    }
  }

  _sendSubscribe(contractId) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    // Try both plain JSON op format and SignalR handshake format
    this.ws.send(JSON.stringify({
      op: "subscribe",
      args: [`quote.${contractId}`],
    }));
  }

  subscribeQuote(contractId) {
    this._subscribed.add(contractId);
    this._sendSubscribe(contractId);
  }

  unsubscribeQuote(contractId) {
    this._subscribed.delete(contractId);
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      op: "unsubscribe",
      args: [`quote.${contractId}`],
    }));
  }

  onQuote(callback) {
    this._quoteCallbacks.push(callback);
    return () => {
      this._quoteCallbacks = this._quoteCallbacks.filter(cb => cb !== callback);
    };
  }

  onStatus(callback) {
    this._statusCallbacks.push(callback);
    return () => {
      this._statusCallbacks = this._statusCallbacks.filter(cb => cb !== callback);
    };
  }

  _emit(status) {
    for (const cb of this._statusCallbacks) {
      try { cb(status); } catch {}
    }
  }

  get status() {
    if (!this.ws) return "disconnected";
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING: return "connecting";
      case WebSocket.OPEN:       return "connected";
      default:                   return "disconnected";
    }
  }

  disconnect() {
    this._intentionalClose = true;
    clearTimeout(this._reconnectTimer);
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._emit("disconnected");
  }
}

// Singleton
export const projectXService = new ProjectXService();

// React hook
import { useState, useEffect, useCallback } from "react";

const API_BASE = process.env.REACT_APP_BACKEND_URL || "http://localhost:3001";
const JWT_KEY  = "projectx_jwt";
const EXP_KEY  = "projectx_jwt_exp";

export function useProjectX() {
  const [connected, setConnected] = useState(false);
  const [livePrices, setLivePrices] = useState({}); // contractId → price
  const [dataSource, setDataSource] = useState("delayed"); // "live" | "delayed"

  // Connect with a stored JWT on mount
  useEffect(() => {
    const jwt = localStorage.getItem(JWT_KEY);
    const exp = parseInt(localStorage.getItem(EXP_KEY) || "0", 10);
    if (jwt && Date.now() < exp) {
      _connect(jwt);
    }

    const unsubStatus = projectXService.onStatus((s) => {
      const isConnected = s === "connected";
      setConnected(isConnected);
      setDataSource(isConnected ? "live" : "delayed");
    });

    const unsubQuote = projectXService.onQuote((q) => {
      if (q.contractId && q.price != null) {
        setLivePrices(prev => ({ ...prev, [q.contractId]: q.price }));
      }
    });

    return () => {
      unsubStatus();
      unsubQuote();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // JWT auto-refresh every 23 hours
  useEffect(() => {
    const REFRESH_MS = 23 * 60 * 60 * 1000;
    const timer = setInterval(async () => {
      const jwt = localStorage.getItem(JWT_KEY);
      if (!jwt) return;
      try {
        const r = await fetch(`${API_BASE}/api/projectx/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: jwt }),
        });
        if (r.ok) {
          const d = await r.json();
          localStorage.setItem(JWT_KEY, d.token);
          localStorage.setItem(EXP_KEY, String(d.expiresAt));
          projectXService.token = d.token;
        }
      } catch {}
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const login = useCallback(async (username, apiKey) => {
    const r = await fetch(`${API_BASE}/api/projectx/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, apiKey }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Login failed");
    localStorage.setItem(JWT_KEY, d.token);
    localStorage.setItem(EXP_KEY, String(d.expiresAt));
    _connect(d.token);
    return d.token;
  }, []);

  const logout = useCallback(() => {
    projectXService.disconnect();
    localStorage.removeItem(JWT_KEY);
    localStorage.removeItem(EXP_KEY);
    setConnected(false);
    setDataSource("delayed");
    setLivePrices({});
  }, []);

  const reconnect = useCallback(() => {
    const jwt = localStorage.getItem(JWT_KEY);
    const exp = parseInt(localStorage.getItem(EXP_KEY) || "0", 10);
    if (jwt && Date.now() < exp) _connect(jwt);
  }, []);

  return { connected, livePrices, dataSource, login, logout, reconnect };
}

function _connect(jwt) {
  projectXService.connect(jwt);
  // Subscribe ES and NQ by default
  setTimeout(() => {
    projectXService.subscribeQuote(CONTRACT_IDS.ES);
    projectXService.subscribeQuote(CONTRACT_IDS.NQ);
    projectXService.subscribeQuote(CONTRACT_IDS.GC);
    projectXService.subscribeQuote(CONTRACT_IDS.CL);
  }, 500);
}
