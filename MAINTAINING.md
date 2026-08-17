# Maintaining this repository

Notes for whoever updates this repo. Users don't need to read this — the guide is `README.md`.

## The wallet lives in two places

`wallet/` here is a **copy** of the wallet running at `argfamining.com/wallet/bc3/`. They are separate trees and nothing warns you when they drift apart. This has already happened once: the copy here sat unchanged while production got several fixes, and for a while this repo was handing out commands that had been found to damage a funded wallet.

## If you change the wallet, do all four steps

They depend on each other in this order.

**1. Copy the wallet from production**

```bash
cp frontend/assets/wallet-bc3.js         <repo>/wallet/assets/
cp frontend/assets/vendor/wallet-core.js <repo>/wallet/assets/vendor/
```

**2. Regenerate the standalone page**

`wallet/index.html` is built by extracting the five `<section class="screen">` blocks and the `<style>` from `frontend/wallet_bc3.html`, dropping the site chrome, and adding the base CSS variables plus the Lock button. It carries no ArgfaMining branding **on purpose**: a copy with the logo would be a ready-made phishing page.

**3. Rebuild `BC3-recovery.html`**

It inlines the same wallet bundle into a single self-contained file. The trick is that the bundle is an ES module ending in `export{...}`: replace that with `var WC={...}` and put everything in a plain `<script>`. No `type="module"`, no `fetch`, no external resources — that is what lets it run from a `file://` URL with nothing installed.

> The `export{...}` is **not** at the end of the bundle: a licence comment follows it. Match it anywhere, and keep what comes after.

**4. Republish the hash — do not skip this**

```bash
sha256sum BC3-recovery.html
```

Update it in **both** `SHA256SUMS` and the Step 2 block of `README.md`.

Forgetting this is worse than it sounds. Somebody who follows the guide will compute a hash that doesn't match what we published and will reasonably conclude their download was tampered with. The check we added to protect them turns into a false alarm that scares people away from a file that was fine.

## Verifying it worked

Serve `wallet/` and confirm it creates a wallet and the export button returns three commands with `"active": false`. Open `BC3-recovery.html` by double-clicking it — not through a server — and check that the four addresses it prints match the ones the wallet shows.

## Two things that must not change quietly

**`"active": false` in the import.** In Core, `active` means "new addresses of this type come from this descriptor", and there is one slot per address type, so importing as active *evicts* whatever holds that slot. Setting it to `true` would make these commands destructive when pasted into the wrong wallet — which is exactly how this was discovered.

**Positional arguments in `createwallet`.** The Core console parses every argument as JSON, so `blank=true` fails there with `Error parsing JSON`. Named arguments only work with `bitcoinIII-cli -named`, which is a different code path. Verifying a command in the CLI does not verify it in the console users actually use.
