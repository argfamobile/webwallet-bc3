# ============================================================================
# BitcoinIII (BC3) — Coin class for ElectrumX.
# ----------------------------------------------------------------------------
# This block is APPENDED to electrumx/lib/coins.py at build time (see Dockerfile)
# instead of maintaining a full fork of the repo. By the end of coins.py the
# following are already in scope: Coin, BitcoinMixin (base classes),
# double_sha256 (from electrumx.lib.hash) and lib_tx.
#
# BC3 is a fork of Bitcoin Core that changes ONLY the block id to SHA3-256t from
# height 30240 onwards. Everything else (txids, merkle, scripthash, address
# params, 80-byte header, SegWit) is standard Bitcoin, so header_hash is the one
# real override. That is why this file is ~40 lines and not a forked repository.
#
# Licensed MIT, same as ElectrumX itself (Copyright (c) 2016-2017 Neil Booth).
# ============================================================================
import hashlib as _hashlib
import struct as _struct


def sha3_256t(data):
    """BC3 post-fork block id = 3x SHA3-256 (FIPS 202) over the 80-byte header.

    Returns the digest in INTERNAL order (not reversed): hash_to_hex_str()
    reverses it downstream for display, exactly like double_sha256() does.
    Validated bit for bit against the node:
        sha3_256t(header80)[::-1].hex() == getblockhash(30240)
    """
    h = _hashlib.sha3_256(data).digest()
    h = _hashlib.sha3_256(h).digest()
    return _hashlib.sha3_256(h).digest()


class BitcoinIII(BitcoinMixin, Coin):
    NAME = "BitcoinIII"
    SHORTNAME = "BC3"
    NET = "mainnet"

    # --- Address params: standard Bitcoin mainnet (verified against the node) ---
    P2PKH_VERBYTE = bytes.fromhex("00")          # '1...'
    P2SH_VERBYTES = (bytes.fromhex("05"),)       # '3...'
    WIF_BYTE = bytes.fromhex("80")
    XPUB_VERBYTES = bytes.fromhex("0488b21e")    # xpub
    XPRV_VERBYTES = bytes.fromhex("0488ade4")    # xprv

    # --- Native SegWit (txids and merkle still use standard double-SHA256) ---
    DESERIALIZER = lib_tx.DeserializerSegWit

    GENESIS_HASH = ('000000000c226a41e70717f6d4fbdcb6'
                    'bfb4fdc40831ccc87fa9cfdd2c57bff6')

    RPC_PORT = 8332
    REORG_LIMIT = 200
    PEERS = []                                   # add your own peers if you run a public server

    # Block-id fork: dSHA256 (h < 30240) -> SHA3-256t (h >= 30240).
    FORK_HEIGHT = 30240
    SHA3_VBIT = 0x00001000                       # nVersion & 0x1000 == fork active

    # req_attrs for lookup_coin_class (without these -> CoinError). Progress heuristics only.
    TX_COUNT = 120000
    TX_COUNT_HEIGHT = 46000
    TX_PER_BLOCK = 2
    ESTIMATE_FEE = 0.00001                       # ~1 sat/vB (BC3 relayfee)
    RELAY_FEE = 0.00001

    @classmethod
    def header_hash(cls, header):
        """BitcoinIII block id.

        Self-contained discriminator on the version bit 0x1000, because
        header_hash only ever receives the 80 header bytes and never the height.
        Validated 1:1 against the fork height: scanning all 30240 pre-fork headers
        produced zero collisions (no pre-fork block sets bit 0x1000). The startup
        guard (preflight.py) re-verifies that bit <=> height >= 30240 and refuses
        to start otherwise, which protects against a future soft fork that would
        clear the bit.

        Returns the digest in INTERNAL order (not reversed); hash_to_hex_str
        reverses it.
        """
        version = _struct.unpack_from('<I', header, 0)[0]
        if version & cls.SHA3_VBIT:
            return sha3_256t(header)             # >= 30240 (post-fork)
        return double_sha256(header)             # genesis + 0..30239 (pre-fork)
