'use strict';
/**
 * walletApi.js — BC3 web wallet cashier: a thin, stateless Electrum<->REST proxy.
 * ----------------------------------------------------------------------------
 * Serves /api/bc3/wallet/*. Browsers cannot speak raw TCP, so this translates the
 * Electrum protocol into the REST/HTTPS the wallet page consumes. It holds NO state:
 * ElectrumX is the source of truth. The browser signs CLIENT-SIDE, so this process only
 * ever sees public addresses and already-signed raw transactions — NEVER a private key.
 *
 * The money path (broadcast / rawtx / feerate) FALLS BACK to the node's RPC when ElectrumX
 * is unavailable, so a dead indexer cannot stop somebody from spending their own coins.
 */
const express = require('express');
const { electrum, tip } = require('./electrumClient');
const { addressToScriptHash } = require('./scripthash');
const { rpcCall } = require('./rpc');               // fallback al nodo

const ADDR_RE = /^(?:[123][a-km-zA-HJ-NP-Z1-9]{25,39}|bc1[a-z0-9]{8,87})$/;
const HASH_RE = /^[0-9a-f]{64}$/i;
const HEX_RE  = /^(?:[0-9a-fA-F]{2})+$/;
const round8  = (n) => Math.round((n + Number.EPSILON) * 1e8) / 1e8;
// rawtx cap: the node rejects anything over MAX_STANDARD_TX_WEIGHT = 400,000 WU with `tx-size`
// (measured with testmempoolaccept: 399,688 WU passes, 400,344 gives tx-size). A SegWit tx of
// that weight reaches ~218 KB serialised, worst case ~400 KB, so the cap is 400,000 BYTES.
// The previous cap (100 KB) rejected perfectly valid transactions: a miner with >676 P2WPKH
// UTXOs could not spend at all. Above this we let the node answer, which gives a real reason.
const MAX_RAWTX_BYTES = 400_000;
const FEE_FLOOR = 1;                                    // BC3 relayfee = 1 sat/vB (verified)
const FALLBACK_FEE = { fast: 3, normal: 2, slow: 1 };   // aligned with estimatesmartfee ~2 sat/vB

function bad(res, msg, code = 400) { res.status(code).json({ ok: false, error: String(msg) }); }
function confs(height) { const t = tip(); return (height && height > 0 && t) ? (t - height + 1) : 0; }
function shOf(addr) { return addressToScriptHash(addr); }   // throws on an invalid address -> 400

// ── POST /utxos {address} → listunspent ─────────────────────────────────────
async function utxos(req, res) {
  const addr = String((req.body && req.body.address) || '').trim();
  if (!ADDR_RE.test(addr)) return bad(res, 'invalid BC3 address');
  let sh; try { sh = shOf(addr); } catch (e) { return bad(res, e.message); }
  try {
    const list = await electrum('blockchain.scripthash.listunspent', [sh]);
    res.json({
      ok: true, address: addr, tip: tip(),
      utxos: (list || []).map((u) => ({
        txid: u.tx_hash, vout: u.tx_pos, value: u.value, height: u.height, confirmations: confs(u.height),
      })),
    });
  } catch (e) { bad(res, e.message, e.code || 502); }
}

// ── GET|POST /balance → get_balance ─────────────────────────────────────────
async function balance(req, res) {
  const addr = String((req.query && req.query.address) || (req.body && req.body.address) || '').trim();
  if (!ADDR_RE.test(addr)) return bad(res, 'invalid BC3 address');
  let sh; try { sh = shOf(addr); } catch (e) { return bad(res, e.message); }
  try {
    const b = await electrum('blockchain.scripthash.get_balance', [sh]);
    res.json({
      ok: true, address: addr,
      confirmed_sats: b.confirmed, unconfirmed_sats: b.unconfirmed,
      confirmed: round8((b.confirmed || 0) / 1e8), unconfirmed: round8((b.unconfirmed || 0) / 1e8),
    });
  } catch (e) { bad(res, e.message, e.code || 502); }
}

// ── POST /history {address} → get_history ───────────────────────────────────
async function history(req, res) {
  const addr = String((req.body && req.body.address) || '').trim();
  if (!ADDR_RE.test(addr)) return bad(res, 'invalid BC3 address');
  let sh; try { sh = shOf(addr); } catch (e) { return bad(res, e.message); }
  try {
    const h = await electrum('blockchain.scripthash.get_history', [sh]);
    res.json({
      ok: true, address: addr,
      history: (h || []).map((x) => ({ txid: x.tx_hash, height: x.height, confirmations: confs(x.height) })),
    });
  } catch (e) { bad(res, e.message, e.code || 502); }
}

// ── POST /broadcast {rawtx} → transaction.broadcast (fallback nodo) ──────────
async function broadcast(req, res) {
  const hex = String((req.body && (req.body.rawtx || req.body.hex)) || '').trim();
  if (!HEX_RE.test(hex)) return bad(res, 'invalid rawtx hex');
  if (hex.length > MAX_RAWTX_BYTES * 2) {
    return bad(res, `rawtx too large: ${Math.round(hex.length / 2)} bytes (max ${MAX_RAWTX_BYTES})`);
  }
  try {
    const r = await electrum('transaction.broadcast', [hex]);
    if (HASH_RE.test(String(r))) return res.json({ ok: true, txid: String(r) });
    throw new Error(String(r));                         // ElectrumX returns the reject reason as a string
  } catch (e) {
    // Broadcast is the user's money path, so fall back to the node directly.
    try {
      const txid = await rpcCall('sendrawtransaction', [hex]);
      return res.json({ ok: true, txid, via: 'node' });
    } catch (e2) {
      const msg = String(e2.message || e.message);
      if (/already in (block ?chain|mempool)|txn-already/i.test(msg)) return res.json({ ok: true, duplicate: true });
      bad(res, msg);                                    // human-readable mempool reject reason
    }
  }
}

// ── GET /feerate → estimatefee(2,6) + piso relayfee + fallback fijo ─────────
async function feerate(_req, res) {
  const toSatVb = (btcPerKvb) => (btcPerKvb > 0 ? Math.max(FEE_FLOOR, Math.round(btcPerKvb * 1e8 / 1000)) : null);
  try {
    const [f2, f6] = await Promise.all([
      electrum('blockchain.estimatefee', [2]).catch(() => -1),
      electrum('blockchain.estimatefee', [6]).catch(() => -1),
    ]);
    const fast = toSatVb(f2), normal = toSatVb(f6);
    if (fast == null && normal == null) {
      return res.json({ ok: true, ...FALLBACK_FEE, floor_sat_vb: FEE_FLOOR, source: 'fallback' });
    }
    res.json({
      ok: true,
      fast_sat_vb: fast || normal, normal_sat_vb: normal || fast, slow_sat_vb: FEE_FLOOR,
      floor_sat_vb: FEE_FLOOR, source: 'electrumx',
    });
  } catch { res.json({ ok: true, ...FALLBACK_FEE, floor_sat_vb: FEE_FLOOR, source: 'fallback' }); }
}

// ── GET /rawtx/:txid → transaction.get (fallback nodo) ──────────────────────
async function rawtx(req, res) {
  const txid = String(req.params.txid || '').trim().toLowerCase();
  if (!HASH_RE.test(txid)) return bad(res, 'invalid txid');
  const verbose = req.query.verbose === '1';
  try {
    const data = await electrum('blockchain.transaction.get', verbose ? [txid, true] : [txid]);
    res.json(verbose ? { ok: true, txid, tx: data } : { ok: true, txid, hex: data });
  } catch (e) {
    try {
      const data = await rpcCall('getrawtransaction', verbose ? [txid, true] : [txid]);
      res.json(verbose ? { ok: true, txid, tx: data, via: 'node' } : { ok: true, txid, hex: data, via: 'node' });
    } catch (e2) { bad(res, e2.message || e.message, 404); }
  }
}

function walletRouter() {
  const r = express.Router();
  r.use(express.json({ limit: '1mb' }));                // covers MAX_RAWTX_BYTES (400 KB -> 800K chars) + overhead
  r.post('/utxos', utxos);
  r.get('/balance', balance);
  r.post('/balance', balance);
  r.post('/history', history);
  r.post('/broadcast', broadcast);
  r.get('/feerate', feerate);
  r.get('/rawtx/:txid', rawtx);
  return r;
}

function mountWalletRoutes(app) { app.use('/api/bc3/wallet', walletRouter()); }

module.exports = { mountWalletRoutes };
