'use strict';
/**
 * rpc.js — minimal JSON-RPC client for a BitcoinIII Core node.
 * ----------------------------------------------------------------------------
 * Only used for the money path's fallback: if ElectrumX is down, broadcast, rawtx
 * and feerate go straight to the node so that nobody is prevented from spending
 * their own coins by our indexer being unavailable.
 *
 * Uses Node's native `http` on purpose — this whole cashier has exactly one
 * dependency (express), which keeps it small enough to actually audit.
 */
const http = require('http');

const HOST = process.env.BC3_RPC_HOST || '127.0.0.1';
const PORT = parseInt(process.env.BC3_RPC_PORT || '8332', 10);
const USER = process.env.BC3_RPC_USER || '';
const PASS = process.env.BC3_RPC_PASS || '';

/**
 * The node answers JSON-RPC errors with HTTP 500 and the real reason inside
 * `error.message` ("tx-size", "min relay fee not met", ...). Generic HTTP clients
 * replace that with "status code 500", which is how a mempool rejection reaches a
 * user as an opaque error instead of the reason their transaction didn't make it.
 * This surfaces the JSON-RPC message instead.
 */
function rpcCall(method, params = [], retries = 2) {
  const body = JSON.stringify({ jsonrpc: '1.0', id: method, method, params });
  const auth = Buffer.from(`${USER}:${PASS}`).toString('base64');

  const attempt = () => new Promise((resolve, reject) => {
    const req = http.request({
      hostname: HOST, port: PORT, method: 'POST', path: '/', agent: false,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30_000,
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(d); } catch { return reject(new Error(`bad JSON from node (HTTP ${res.statusCode})`)); }
        if (parsed.error) {
          const e = new Error(parsed.error.message || JSON.stringify(parsed.error));
          e.code = parsed.error.code;
          return reject(e);
        }
        resolve(parsed.result);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('RPC timeout')); });
    req.write(body);
    req.end();
  });

  return (async () => {
    for (let i = 0; ; i++) {
      try {
        return await attempt();
      } catch (e) {
        const retriable = /socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|RPC timeout/i.test(e.message || '');
        if (i >= retries || !retriable) throw e;
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
    }
  })();
}

module.exports = { rpcCall };
