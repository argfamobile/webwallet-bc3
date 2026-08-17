# ElectrumX-BC3 — run your own BC3 Electrum server

This is the piece that makes BC3 wallet infrastructure **replaceable**. Stock ElectrumX cannot index BitcoinIII: it computes every block id with double-SHA256, and BC3 switched to SHA3-256t at height 30240, so the chain simply doesn't validate. Those forty lines in `bitcoiniii.py` are the entire difference.

If you run this, you are no longer dependent on anybody else's server — including ours.

## What's here

| File | What it is |
|---|---|
| `bitcoiniii.py` | The `Coin` class. Appended to `electrumx/lib/coins.py` at build time. |
| `preflight.py` | Startup guard: refuses to launch if the block-id logic doesn't match the node. |
| `Dockerfile` | Pins ElectrumX to v1.16.0 and performs the append. |
| `entrypoint.sh` | Runs the guard, then the server. |

## Build and run

You need a synced **BitcoinIII Core** node with `txindex=1` and RPC enabled.

```bash
docker build -t electrumx-bc3:1.0.0 .
```

```bash
docker run -d --name electrumx-bc3 \
  -e DAEMON_URL="http://USER:PASSWORD@YOUR_NODE_HOST:8332/" \
  -e SERVICES="tcp://0.0.0.0:50001" \
  -e HOST="" \
  -v /path/on/your/host/electrumx-db:/electrumx-db \
  -p 50001:50001 \
  electrumx-bc3:1.0.0
```

Initial indexing of the whole chain takes a few minutes and the resulting database is small — BC3 is a young chain.

### Serving over TLS or WebSocket

ElectrumX 1.16 supports `ssl`, `tcp`, `ws` and `wss`. To serve browsers directly you want `wss`, which needs a certificate:

```
-e SERVICES="tcp://0.0.0.0:50001,wss://0.0.0.0:50004"
-e SSL_CERTFILE=/certs/fullchain.pem
-e SSL_KEYFILE=/certs/privkey.pem
```

## Why there is a startup guard

`preflight.py` re-implements the block-id logic from scratch — deliberately not importing the `Coin` class — and checks it against your node across a sample of heights that includes the 30239/30240 fork boundary. If any hash or the discriminator disagrees, the container exits and refuses to serve.

This is not ceremony. A wrong `header_hash` produces a silently corrupt index, a corrupt index reports wrong balances, and wrong balances lose people money. The guard turns a one-time deploy check into an invariant that holds on every restart.

## How the fork detection works

`header_hash` only ever receives the 80 header bytes — never the height — so it cannot simply compare against 30240. It keys off **bit `0x1000` of `nVersion`**, which post-fork blocks set.

That equivalence was validated by scanning all 30240 pre-fork headers: not one of them sets the bit, so there are zero false positives. The startup guard re-verifies `bit <=> height >= 30240` on every launch, which is what protects you if a future soft fork ever clears it.

## The build-time trap

The Dockerfile deletes the ElectrumX source tree and moves to `WORKDIR /` **before** appending the Coin class. This looks pointless and is not.

If you append while sitting inside `/opt/electrumx`, `import electrumx.lib.coins` resolves to the *source* copy because the working directory is on the Python path — but `electrumx_server` lives in `/usr/local/bin` and imports the *site-packages* copy. The append lands in the wrong file, the build reports success, and the server dies at runtime with `unknown coin BitcoinIII`. Deleting the source first forces the append into site-packages, and the smoke test immediately afterwards fails the build rather than production if anything is wrong.

## Licence

ElectrumX is MIT-licensed, Copyright (c) 2016-2017 Neil Booth. This Coin class and the guard are published under the same licence. Upstream: https://github.com/spesmilo/electrumx
