# BC3 wallet cashier

A thin, stateless bridge between the browser wallet and an ElectrumX-BC3 server.

## Why this exists at all

Browsers cannot open raw TCP sockets, and the Electrum protocol is raw TCP. So something has to sit in the middle and translate. That something is this, and it is deliberately as small and as boring as possible: about 400 lines, one dependency, no database, no state.

**It never sees a private key.** The wallet page derives keys and signs transactions in the browser; this process only ever handles public addresses and transactions that are already signed. That isn't a promise you have to take on faith — `walletApi.js` is short enough to read in one sitting, and you can check.

## Run it

```bash
npm install
BC3_ELECTRUMX_HOST=127.0.0.1 \
BC3_ELECTRUMX_PORT=50001 \
PORT=3010 \
npm start
```

Then point the wallet page at `http://your-host:3010`.

### Environment

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3010` | HTTP port |
| `BC3_ELECTRUMX_HOST` | `127.0.0.1` | ElectrumX host |
| `BC3_ELECTRUMX_PORT` | `50001` | ElectrumX TCP port |
| `BC3_RPC_HOST` | *(unset)* | Node RPC host. Setting it enables the fallback path. |
| `BC3_RPC_PORT` | `8332` | Node RPC port |
| `BC3_RPC_USER` / `BC3_RPC_PASS` | | Node RPC credentials |
| `CORS_ORIGIN` | *(off)* | Origin allowed to call this. Needed if the wallet page is served elsewhere. |

## Endpoints

All under `/api/bc3/wallet`:

| | |
|---|---|
| `POST /utxos` | `{address}` → spendable outputs |
| `GET\|POST /balance` | `{address}` → confirmed and unconfirmed |
| `POST /history` | `{address}` → transaction history |
| `POST /broadcast` | `{rawtx}` → txid |
| `GET /feerate` | fee estimates in sat/vB |
| `GET /rawtx/:txid` | raw transaction, needed to spend legacy inputs |

## The node fallback

If you set `BC3_RPC_*`, then `broadcast`, `rawtx` and `feerate` fall back to the node's RPC when ElectrumX is unreachable.

This matters more than it looks. Those three endpoints are the money path: an indexer that is down should never be the reason somebody cannot spend their own coins. Balance and history degrade to an error, which is annoying; broadcast degrading to an error is somebody stuck holding coins they can't move.

## Things worth knowing before you deploy this

**Transaction size.** Miners accumulate one UTXO per payout, so their transactions are enormous by design — a wallet with 900 coins produces a ~260 KB transaction. The cap here is 400,000 bytes, which covers any standard transaction the network will accept (`MAX_STANDARD_TX_WEIGHT` is 400,000 weight units, measured against the node, and a SegWit transaction of that weight is ~218 KB serialised). If you put a proxy in front of this, make sure its body limit is at least 1 MB, or you will reject valid transactions and the error will blame the wrong thing.

**Mempool rejection reasons.** `rpc.js` extracts the JSON-RPC `error.message` rather than letting the HTTP 500 through. Without that, a user whose transaction is rejected for `min relay fee not met` is told "status code 500", which tells them nothing and sends them to you for support.

**No rate limiting.** There is none here. If you expose this publicly, put it behind something that has it.

## Licence

MIT.
