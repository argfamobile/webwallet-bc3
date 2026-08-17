# ============================================================================
# ElectrumX-BC3 — Electrum server for BitcoinIII (BC3).
# ----------------------------------------------------------------------------
# Based on spesmilo/electrumx pinned to the CLASSIC ALTCOIN LINE (v1.16.0): the
# last release with the full altcoin set plus DeserializerSegWit, and without the
# daemon-version gate (Core >= 28 / txospenderindex) that HEAD >= 1.18 added and
# which would refuse to talk to a BitcoinIII node.
#
# The only substantive change is the BitcoinIII Coin class (bitcoiniii.py), which
# is APPENDED to electrumx/lib/coins.py at build time. Appending instead of
# forking the repo keeps the maintenance debt at ~40 lines; everything else stays
# upstream. BC3 changed ONLY the block id to SHA3-256t at fork height 30240.
# ============================================================================
FROM python:3.11-slim-bookworm

# v1.16.0 (classic altcoin line). Pinned by commit for reproducible builds.
ARG ELECTRUMX_REF=a6cb22aa3717d515e6853c5603b21d828d619d4e

RUN apt-get update && apt-get install -y --no-install-recommends \
        git gcc g++ make libleveldb-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone https://github.com/spesmilo/electrumx.git electrumx \
    && cd electrumx && git checkout ${ELECTRUMX_REF}

WORKDIR /opt/electrumx
RUN pip install --no-cache-dir .

# CRITICAL: leave the source tree and delete it BEFORE appending. If you append
# while WORKDIR=/opt/electrumx, `import electrumx.lib.coins` resolves to the
# SOURCE copy (CWD is on the path), but electrumx_server (in /usr/local/bin)
# imports the SITE-PACKAGES copy, which would then lack the class and fail at
# runtime with "unknown coin BitcoinIII". With WORKDIR=/ and the source removed,
# the append lands in site-packages, which is the copy the server actually uses.
WORKDIR /
RUN rm -rf /opt/electrumx

# Append the BitcoinIII Coin class to the site-packages coins.py, then smoke-test
# the import: if the append breaks coins.py (or BitcoinMixin / Coin / lib_tx /
# double_sha256 are missing), the BUILD fails here with a clear error instead of
# the container failing later in production.
COPY bitcoiniii.py /opt/bitcoiniii.py
RUN COINS_PY=$(python3 -c "import electrumx.lib.coins as c; print(c.__file__)") \
    && echo "[build] appending BitcoinIII to $COINS_PY" \
    && printf '\n\n' >> "$COINS_PY" \
    && cat /opt/bitcoiniii.py >> "$COINS_PY" \
    && python3 -c "from electrumx.lib.coins import Coin, BitcoinIII; \
assert Coin.lookup_coin_class('BitcoinIII','mainnet') is BitcoinIII; \
print('BitcoinIII OK genesis=', BitcoinIII.GENESIS_HASH, 'fork=', BitcoinIII.FORK_HEIGHT)"

COPY preflight.py /opt/preflight.py
COPY entrypoint.sh /opt/entrypoint.sh
RUN chmod +x /opt/entrypoint.sh

# ALLOW_ROOT: the container runs as root and the index goes to a bind mount. If
# you expose this server publicly, run it as a non-root user with a UID matching
# the bind mount instead.
ENV COIN=BitcoinIII \
    NET=mainnet \
    DB_DIRECTORY=/electrumx-db \
    DB_ENGINE=leveldb \
    ALLOW_ROOT=1

ENTRYPOINT ["/opt/entrypoint.sh"]
