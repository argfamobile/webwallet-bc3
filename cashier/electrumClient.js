'use strict';
/**
 * electrumClient.js — JSON-RPC client to ElectrumX-BC3 over TCP (pool + reconnect).
 * ----------------------------------------------------------------------------
 * The Electrum protocol is newline-delimited JSON-RPC (not HTTP, no length prefix): one
 * JSON object per line. Replies are matched by `id`; notifications (which carry no id,
 * e.g. blockchain.headers.subscribe) are routed separately and cache the chain tip, so
 * confirmations need no extra round trip per request.
 *
 * A pool of 2 long-lived connections (the wallet is read-mostly; one multiplexed socket is
 * enough, two give headroom). No local state: ElectrumX is the source of truth. If no socket
 * is ready it rejects with code 503 and the cashier falls back to the node.
 */
const net = require('net');

const HOST = process.env.BC3_ELECTRUMX_HOST || '127.0.0.1';
const PORT = parseInt(process.env.BC3_ELECTRUMX_PORT || '50001', 10);
const REQ_TIMEOUT = 10_000;
const POOL_SIZE = 2;
const MAX_BUF = 8 * 1024 * 1024;          // anti framing-bomb guard (a max-size standard rawtx of ~400 KB fits comfortably)

class ElectrumConn {
  constructor() {
    this.sock = null; this.buf = ''; this.id = 0; this.pending = new Map();
    this.ready = false; this.tip = null; this.backoff = 250;
    this.connect();
  }
  connect() {
    this.sock = net.connect({ host: HOST, port: PORT });
    this.sock.setKeepAlive(true, 30_000);
    this.sock.setNoDelay(true);
    this.sock.on('connect', async () => {
      this.buf = '';
      try {
        await this._raw('server.version', ['argfa-bc3-wallet/1.0', '1.4']);
        const h = await this._raw('blockchain.headers.subscribe', []);
        this.tip = (h && typeof h.height === 'number') ? h.height : null;
        this.ready = true; this.backoff = 250;
      } catch { try { this.sock.destroy(); } catch {} }   // 'close' agenda reconnect
    });
    this.sock.on('data', (c) => this._onData(c));
    this.sock.on('error', () => {});                       // cleanup happens in 'close'
    this.sock.on('close', () => this._onClose());
  }
  _onData(chunk) {
    this.buf += chunk;
    if (this.buf.length > MAX_BUF) { try { this.sock.destroy(); } catch {} return; }
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl); this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.id != null && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.timer);
        if (m.error) p.reject(new Error(m.error.message || JSON.stringify(m.error)));
        else p.resolve(m.result);
      } else if (m.method === 'blockchain.headers.subscribe' && Array.isArray(m.params) && m.params[0]) {
        if (typeof m.params[0].height === 'number') this.tip = m.params[0].height;   // notification -> tip
      }
    }
  }
  _onClose() {
    this.ready = false;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('electrumx socket closed')); }
    this.pending.clear();
    setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30_000);
  }
  _raw(method, params) {                  // sends even when not ready (needed for the handshake)
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('electrumx timeout')); }, REQ_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      try { this.sock.write(JSON.stringify({ id, method, params }) + '\n'); }
      catch (e) { this.pending.delete(id); clearTimeout(timer); reject(e); }
    });
  }
  call(method, params) {
    if (!this.ready) return Promise.reject(Object.assign(new Error('electrumx unavailable'), { code: 503 }));
    return this._raw(method, params);
  }
}

const POOL = Array.from({ length: POOL_SIZE }, () => new ElectrumConn());
let rr = 0;

// electrum(method, params) — round-robin across ready sockets. 503 if none are.
function electrum(method, params = []) {
  const ready = POOL.filter((c) => c.ready);
  if (!ready.length) return Promise.reject(Object.assign(new Error('electrumx unavailable'), { code: 503 }));
  const c = ready[rr++ % ready.length];
  return c.call(method, params);
}
function tip() { const c = POOL.find((x) => x.ready); return c ? c.tip : null; }

module.exports = { electrum, tip };
