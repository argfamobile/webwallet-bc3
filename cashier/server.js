'use strict';
/**
 * server.js — standalone BC3 wallet cashier.
 * ----------------------------------------------------------------------------
 * Serves the REST endpoints the browser wallet needs, translating them to the
 * Electrum protocol. Run this next to an ElectrumX-BC3 server and point the
 * wallet page at it.
 *
 * It never sees a private key. The browser derives keys and signs locally; this
 * process only handles public addresses and already-signed transactions. That is
 * a property of the design, not a promise: read walletApi.js and check.
 *
 * Environment:
 *   PORT                  HTTP port to listen on          (default 3010)
 *   BC3_ELECTRUMX_HOST    ElectrumX host                  (default 127.0.0.1)
 *   BC3_ELECTRUMX_PORT    ElectrumX TCP port              (default 50001)
 *   BC3_RPC_HOST/PORT/USER/PASS   node RPC, for the fallback path (optional)
 *   CORS_ORIGIN           allowed origin, or * to allow any (default: same-origin only)
 */
const express = require('express');
const { mountWalletRoutes } = require('./walletApi');

const app = express();
const PORT = parseInt(process.env.PORT || '3010', 10);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '';

// Serving the wallet page from a different origin (or from a local file) needs CORS.
// Left off by default: turn it on deliberately, knowing what you are opening up.
if (CORS_ORIGIN) {
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
}

app.get('/health', (_req, res) => res.json({ ok: true, service: 'bc3-wallet-cashier' }));

mountWalletRoutes(app);

// Express answers a body over the limit with an HTML error page, which the wallet
// would report as "bad json" and send somebody hunting the wrong bug. Answer JSON.
app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'request body too large' });
  }
  res.status(500).json({ ok: false, error: String((err && err.message) || 'internal error') });
});

app.listen(PORT, () => {
  console.log(`[bc3-cashier] listening on :${PORT}`);
  console.log(`[bc3-cashier] electrumx ${process.env.BC3_ELECTRUMX_HOST || '127.0.0.1'}:${process.env.BC3_ELECTRUMX_PORT || '50001'}`);
  console.log(`[bc3-cashier] node RPC fallback ${process.env.BC3_RPC_HOST ? 'enabled' : 'disabled (set BC3_RPC_HOST to enable)'}`);
});
