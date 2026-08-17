'use strict';
/**
 * scripthash.js — BC3 address -> Electrum scripthash. Zero-dependency (native `crypto` only).
 * ----------------------------------------------------------------------------
 * An Electrum scripthash is sha256(scriptPubKey), byte-REVERSED, as 64 hex chars.
 * BC3 uses exactly Bitcoin mainnet address params (verified against the node): P2PKH 0x00
 * ('1...'), P2SH 0x05 ('3...'), bech32 HRP 'bc'. The SHA3-256t fork changed ONLY the block
 * id; scripthashes, txids and address encoding all remain standard Bitcoin.
 *
 * Supports P2PKH and P2SH (base58check), P2WPKH/P2WSH (bech32 v0) and Taproot v1 (bech32m).
 * Deliberately self-contained rather than pulling in bitcoinjs-lib: this only derives
 * scripts, it never signs anything.
 */
const crypto = require('crypto');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest();
const sha256d = (buf) => sha256(sha256(buf));

// ── base58check ─────────────────────────────────────────────────────────────
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(s) {
  let num = 0n;
  for (const ch of s) {
    const idx = B58.indexOf(ch);
    if (idx < 0) throw new Error('invalid base58 char');
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let bytes = num === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
  let leading = 0;                              // each leading '1' is a 0x00 byte
  for (const ch of s) { if (ch === '1') leading++; else break; }
  return Buffer.concat([Buffer.alloc(leading, 0), bytes]);
}
function b58checkDecode(s) {
  const full = b58decode(s);
  if (full.length < 5) throw new Error('base58 too short');
  const payload = full.subarray(0, -4), checksum = full.subarray(-4);
  if (!sha256d(payload).subarray(0, 4).equals(checksum)) throw new Error('bad base58 checksum');
  return payload;                              // version byte + hash
}

// ── bech32 / bech32m (BIP173 / BIP350) ──────────────────────────────────────
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i];
  }
  return chk >>> 0;
}
function hrpExpand(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}
function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0; const out = []; const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || (value >> from) !== 0) throw new Error('bech32 convertbits range');
    acc = (acc << from) | value; bits += from;
    while (bits >= to) { bits -= to; out.push((acc >>> bits) & maxv); }
  }
  if (pad) { if (bits) out.push((acc << (to - bits)) & maxv); }
  else if (bits >= from || ((acc << (to - bits)) & maxv)) throw new Error('bech32 convertbits leftover');
  return out;
}
function segwitScriptPubKey(addr) {
  const lower = addr.toLowerCase();
  const pos = lower.lastIndexOf('1');
  if (pos < 1) throw new Error('invalid bech32');
  const hrp = lower.slice(0, pos);
  if (hrp !== 'bc') throw new Error('not a BC3 bech32 address (hrp ' + hrp + ')');
  const data = [];
  for (const ch of lower.slice(pos + 1)) {
    const d = CHARSET.indexOf(ch);
    if (d < 0) throw new Error('invalid bech32 char');
    data.push(d);
  }
  if (data.length < 6) throw new Error('bech32 too short');
  const pm = polymod(hrpExpand(hrp).concat(data));
  const spec = pm === 1 ? 'bech32' : (pm === 0x2bc830a3 ? 'bech32m' : null);
  if (!spec) throw new Error('bad bech32 checksum');
  const payload = data.slice(0, -6);
  const witver = payload[0];
  if (witver < 0 || witver > 16) throw new Error('bad witness version');
  const program = Buffer.from(convertBits(payload.slice(1), 5, 8, false));
  if (witver === 0) {
    if (spec !== 'bech32') throw new Error('v0 requires bech32');
    if (program.length !== 20 && program.length !== 32) throw new Error('bad v0 program length');
  } else if (spec !== 'bech32m') throw new Error('v1+ requires bech32m');
  if (program.length < 2 || program.length > 40) throw new Error('bad program length');
  const op = witver === 0 ? 0x00 : 0x50 + witver;     // OP_0 / OP_1..OP_16
  return Buffer.concat([Buffer.from([op, program.length]), program]);
}

// ── scriptPubKey + scripthash ───────────────────────────────────────────────
function addressToScriptPubKey(addr) {
  addr = String(addr || '').trim();
  if (/^(bc1)/i.test(addr)) return segwitScriptPubKey(addr);
  const payload = b58checkDecode(addr);
  const ver = payload[0], h160 = payload.subarray(1);
  if (h160.length !== 20) throw new Error('bad hash160 length');
  if (ver === 0x00) return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), h160, Buffer.from([0x88, 0xac])]);
  if (ver === 0x05) return Buffer.concat([Buffer.from([0xa9, 0x14]), h160, Buffer.from([0x87])]);
  throw new Error('unsupported address version 0x' + ver.toString(16));
}

function addressToScriptHash(addr) {
  const spk = addressToScriptPubKey(addr);
  return Buffer.from(sha256(spk)).reverse().toString('hex');     // Electrum scripthash (LE)
}

module.exports = { addressToScriptHash, addressToScriptPubKey };
