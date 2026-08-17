# BC3 browser wallet

The wallet page itself: three files, no build step, no framework, no CDN.

This is the same wallet code that runs at `argfamining.com/wallet/bc3/`, with the site's branding and navigation stripped out. That is deliberate — a copy carrying our logo would make a convincing phishing page, and you should not be distributing one.

## Files

```
index.html            the page (CSS inline, no external stylesheets)
assets/wallet-bc3.js  the wallet logic
assets/vendor/wallet-core.js   bundled crypto (scure/noble), eval-free
```

## Serve it

Any static web server works. It must be served over **HTTP or HTTPS**, not opened as a `file://` — the page is an ES module and browsers block module loading from the filesystem.

```bash
python3 -m http.server 8080
```

## Point it at a server

The wallet reads balances through a *cashier* (see `../cashier`). Three ways to set it, in priority order:

1. **Settings tab in the wallet** — stored in that browser only. This is what an end user would use.
2. **`<meta name="bc3-cashier" content="https://...">`** in `index.html` — the default you ship.
3. Falls back to `/api/bc3/wallet` on the same origin.

If the cashier is on a different origin than the page, start it with `CORS_ORIGIN` set.

## What it does and doesn't do

Keys are derived and transactions are signed **in the browser**. The cashier only ever receives public addresses and already-signed transactions, so whoever runs the server cannot spend your coins — but they *can* see which addresses you asked about. If that matters to you, run your own.

Standard **BIP39** seed with **BIP44/49/84/86** derivation and Bitcoin's coin type (0). No BIP39 passphrase. That means your seed works in any standards-compliant tool, which is what makes [recovery without any of this](../README.md) possible.

Saved wallets are encrypted with AES-GCM (PBKDF2, 210k iterations) in `localStorage`. The passphrase never leaves the device. Clearing site data deletes the wallet — **the seed phrase is the backup, not the browser**.

## Content Security Policy

The wallet needs no external resources, so serve it with a strict policy. This is what we use:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; object-src 'none';
base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

If you point the wallet at a cashier on another origin, add that origin to `connect-src`. Keep `script-src 'self'` regardless — that directive is what stops an injected script from reading a seed phrase out of the page.

## Licence

MIT.
