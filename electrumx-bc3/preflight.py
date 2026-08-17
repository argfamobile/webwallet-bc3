#!/usr/bin/env python3
# ============================================================================
# preflight.py — STARTUP GUARD for ElectrumX-BC3.
# ----------------------------------------------------------------------------
# Runs BEFORE electrumx_server (see entrypoint.sh). It verifies against the node,
# INDEPENDENTLY of the Coin class (it reimplements header_hash from scratch), that:
#   * the genesis block (h0) reproduces GENESIS_HASH via double-SHA256,
#   * the 0x1000 version-bit discriminator is equivalent to (height >= FORK_HEIGHT)
#     across a sample that includes the 30239/30240 boundary,
#   * header_hash (double-SHA256 or SHA3-256t depending on the bit) reproduces the
#     node's getblockhash.
#
# If anything fails it exits non-zero and the container does NOT start serving.
# That matters: a wrong header_hash means a corrupt index, a corrupt index means
# wrong balances, and wrong balances mean somebody loses money. This turns a
# one-off deploy test into a runtime invariant.
# ============================================================================
import os
import sys
import json
import base64
import struct
import hashlib
import urllib.request
from urllib.parse import urlsplit

DAEMON_URL = os.environ.get('DAEMON_URL', '')
GENESIS = '000000000c226a41e70717f6d4fbdcb6bfb4fdc40831ccc87fa9cfdd2c57bff6'
FORK_HEIGHT = 30240
SHA3_VBIT = 0x00001000

# urllib.request does NOT use the user:pass@ credentials embedded in a URL (it
# treats them as part of the host, which fails with "label too long"). Parse with
# urlsplit and send an explicit Authorization: Basic header instead.
_u = urlsplit(DAEMON_URL) if DAEMON_URL else None
RPC_URL = ('http://%s:%s/' % (_u.hostname, _u.port)) if _u else ''
RPC_AUTH = ('Basic ' + base64.b64encode(('%s:%s' % (_u.username, _u.password)).encode()).decode()) if _u else ''


def rpc(method, params=None):
    body = json.dumps({'jsonrpc': '1.0', 'id': 'preflight',
                       'method': method, 'params': params or []}).encode()
    req = urllib.request.Request(RPC_URL, data=body,
                                 headers={'Content-Type': 'application/json', 'Authorization': RPC_AUTH})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    if d.get('error'):
        raise RuntimeError(d['error'])
    return d['result']


def dsha(b):
    return hashlib.sha256(hashlib.sha256(b).digest()).digest()


def sha3t(b):
    h = hashlib.sha3_256(b).digest()
    h = hashlib.sha3_256(h).digest()
    return hashlib.sha3_256(h).digest()


def header_hash(hdr):
    version = struct.unpack_from('<I', hdr, 0)[0]
    return sha3t(hdr) if (version & SHA3_VBIT) else dsha(hdr)


def check(height):
    bh = rpc('getblockhash', [height])
    hdr = bytes.fromhex(rpc('getblockheader', [bh, False]))
    version = struct.unpack_from('<I', hdr, 0)[0]
    bit = bool(version & SHA3_VBIT)
    computed = header_hash(hdr)[::-1].hex()
    ok_hash = (computed == bh)
    ok_disc = (bit == (height >= FORK_HEIGHT))
    return bh, version, bit, ok_hash, ok_disc


def main():
    if not DAEMON_URL:
        print('[preflight] DAEMON_URL is not set', file=sys.stderr)
        sys.exit(2)
    tip = rpc('getblockcount')
    heights = [0, 1, 1000, 30000, FORK_HEIGHT - 1, FORK_HEIGHT, FORK_HEIGHT + 1, 35000, tip]
    heights = sorted(set(h for h in heights if 0 <= h <= tip))
    failures = []
    for h in heights:
        bh, version, bit, ok_hash, ok_disc = check(h)
        algo = 'sha3' if (version & SHA3_VBIT) else 'dsha'
        status = 'OK' if (ok_hash and ok_disc) else 'FAIL'
        print('[preflight] h=%6d ver=%#010x bit=%d algo=%s hash=%s disc=%s -> %s'
              % (h, version, int(bit), algo,
                 'ok' if ok_hash else 'BAD', 'ok' if ok_disc else 'BAD', status))
        if not (ok_hash and ok_disc):
            failures.append(h)
    g = rpc('getblockhash', [0])
    if g != GENESIS:
        print('[preflight] genesis mismatch: node=%s expected=%s' % (g, GENESIS), file=sys.stderr)
        failures.append(0)
    if failures:
        print('[preflight] FAILED at heights %s — refusing to start ElectrumX' % failures,
              file=sys.stderr)
        sys.exit(1)
    print('[preflight] PASS — header_hash discriminator validated genesis..tip(%d); starting ElectrumX' % tip)


if __name__ == '__main__':
    main()
