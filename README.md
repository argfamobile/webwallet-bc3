# Recover your BC3 web wallet without ArgfaMining

**If `argfamining.com` is gone, your coins are not.** This guide takes you from your 12 (or 24) recovery words to spendable BitcoinIII, using only software you download yourself. Nothing here needs our servers, our website, or our permission.

You do not need to trust us to follow it. Every step is a command you can read, run and verify.

---

## The short version

Your wallet is a standard **BIP39 seed phrase** with standard derivation paths. That is not a marketing claim — it means any tool that implements those standards produces the exact same keys, forever. To get your coins back you need two things:

1. **BitcoinIII Core**, the network's own wallet software.
2. **`BC3-recovery.html`** from this repository — one file that turns your words into the exact commands Core needs.

Then you paste three commands and Core does the rest.

Total time: **about 15 minutes**, most of it downloading. The whole BC3 blockchain is only **291 MB** and syncs from scratch in **under two minutes** — this is not Bitcoin, you are not waiting a day.

---

## Before you start

- Your **seed phrase**: 12 or 24 words, in order. This is the only thing that cannot be replaced. If you don't have it, nothing below will help, and nobody — including us — can recover it for you.
- **No passphrase needed.** The BC3 web wallet never used a BIP39 passphrase (sometimes called a "25th word"). If some tool asks you for one, leave it empty.
- A computer with **~1 GB free disk**.

> **Read this before you type your seed anywhere.** A recovery guide is exactly what a thief would fake. Anything that asks for your seed phrase should be a file you downloaded yourself, verified, and opened **with your internet disconnected**. If a website asks you to type your seed to "check your balance", it is stealing from you. There are no exceptions to this, including pages that look like ours.

---

## Step 1 — Install BitcoinIII Core

Download it from the project's own releases page:

**https://github.com/argfamobile/BC3/releases**

Take the package for your system (`bitcoinIII-qt` is the one with a window; `bitcoinIIid` is the command-line one). Install and start it, then let it sync. You'll know it's done when the progress bar disappears and it says it's up to date.

On a normal connection this takes **1–2 minutes**. If it's taking much longer, it is downloading, not stuck.

---

## Step 2 — Get your three commands

Download **[`BC3-recovery.html`](BC3-recovery.html)** from this repository — one file, nothing to install.

1. **Disconnect from the internet.** The file has no network code at all, so it works the same either way, but disconnecting means you don't have to take our word for it.
2. Open the file (double-click it).
3. Type your seed phrase and press the button.

It shows you **your four addresses first**. Check that you recognise at least one — if none of them look familiar, the seed phrase is wrong and you should stop there rather than carry on.

Below that are three commands, each with a copy button. That's everything you need.

<details>
<summary>Prefer not to trust our file? Do it by hand instead</summary>

You can build the same commands with [iancoleman/bip39](https://github.com/iancoleman/bip39/releases) (`bip39-standalone.html`), a widely reviewed tool that isn't ours. Offline, paste your seed, and copy the **BIP32 Root Key** — it starts with `xprv`. Not `zprv` or `yprv`; those are a different encoding and Core rejects them.

Then build the eight descriptors, substituting your key for `XPRV`:

```
pkh(XPRV/44h/0h/0h/0/*)        pkh(XPRV/44h/0h/0h/1/*)
sh(wpkh(XPRV/49h/0h/0h/0/*))   sh(wpkh(XPRV/49h/0h/0h/1/*))
wpkh(XPRV/84h/0h/0h/0/*)       wpkh(XPRV/84h/0h/0h/1/*)
tr(XPRV/86h/0h/0h/0/*)         tr(XPRV/86h/0h/0h/1/*)
```

Each one needs a checksum. Run `getdescriptorinfo "<the descriptor>"` in Core and take **only the `checksum` field**, appending it as `#checksum`.

> **Do not copy the `descriptor` field from that reply.** Core answers with your descriptor rewritten so the private key becomes a public one. Import that and you get a wallet that watches your coins but can never spend them — and the error won't say so.

Then import each one as in Step 3, with `"timestamp":0`, `"active":false`, `"range":[0,100]`, and `"internal":true` for the ones ending in `/1/*`.

</details>

## Step 3 — Paste them into Core

Open **Window → Console** in Core.

**Command 1** creates an empty wallet to recover into.

**Then switch wallets.** Core does *not* do this for you: the **Wallet** dropdown at the top of that window still points at whatever was open before. Change it to `bc3-web-wallet-recovery`.

**Command 2** is how you confirm you switched. The answer must say `"walletname": "bc3-web-wallet-recovery"`. If it says anything else, stop and switch — otherwise the next command lands in the wrong wallet.

**Command 3** does the import. It's long; use the copy button rather than retyping it. You should get eight replies, all `"success": true`.

Core then scans the chain, which takes seconds.

> **Why the import says `"active": false`.** In Core, "active" doesn't mean "enabled" — it means *"new addresses of this type come from this descriptor"*, and there's room for exactly one per address type. So importing as active would **evict** whatever was there, and running this in the wrong wallet would silently change which branch that wallet derives from. As `false` it displaces nothing, and you lose nothing that matters: the wallet still sees the imported coins and still spends them, because watching and signing don't consult that flag.

## Step 4 — Check, then spend

Your balance should now be there:

```
getwalletinfo
listunspent
```

Compare what you see against the addresses the recovery file showed you in Step 2. Same keys, same addresses.

To move everything out — the real proof that you are in control:

```
sendall ["YOUR_DESTINATION_ADDRESS"]
```

Use `sendall` rather than `sendtoaddress`: it sweeps everything without needing a change address, which is what you want when the descriptors are imported as inactive.

That's it. Your coins are yours again, and no part of it went through us.

---

## Do this today, not the day you need it

The worst moment to discover your backup doesn't work is when it's the only thing you have left. This takes two minutes and moves nothing:

Open `BC3-recovery.html`, type your seed phrase, and compare the four addresses it shows against the ones your wallet displays under **Receive**. If they match, your seed phrase is correct and this whole guide will work when it matters.

If they *don't* match, you wrote your words down wrong — and you have just found out while you still have a working wallet to fix it from. That is worth two minutes.

---

## If something goes wrong

**`Error parsing JSON: blank=true`**
You typed the command by hand with named arguments. The Core console needs them positional — use the copy button.

**Everything said `success` but the coins aren't there**
You skipped the wallet switch. Core runs against whatever the **Wallet** dropdown says. Switch and run command 3 again; nothing was harmed.

**`Cannot import descriptor without private keys to a wallet with private keys enabled`**
Only happens on the manual route: you copied the `descriptor` field from `getdescriptorinfo` instead of just its `checksum`.

**Balance is zero but you expected coins**
Either the rescan is still running (`getwalletinfo` shows `scanning`), or the coins are on addresses past index 100 — raise `range` to `[0,1000]` and import again.

**`Error parsing JSON: blank=true`**
You used named arguments. The Core console needs them positional: `createwallet "bc3-web-wallet-recovery" false true`.

**Everything said `success` but the funds are in the wrong wallet**
You skipped step 3b. Core executes against whatever the **Wallet** dropdown says, and creating a wallet does not select it. Nothing is lost — see the FAQ below.

**Core won't sync**
BC3 has a public peer network that does not depend on us. If it stays at zero connections, check your firewall.

---

## Questions people actually ask

**Can I remove these descriptors from my wallet afterwards?**
No — Core has no command to delete a descriptor, and it doesn't need one. If you import your own descriptors again with `"active": true`, the imported ones are deactivated automatically. An inactive descriptor generates nothing and costs nothing; it just sits in the list.

**I imported into the wrong wallet. Did I lose anything?**
No. `importdescriptors` only adds. Your original descriptors are still there with their private keys, and your coins are still visible and spendable. If they were imported with `"active": true` they were merely deactivated, meaning that wallet would derive *new* addresses from the other seed — reimport your own with `"active": true` and everything goes back. Following this guide as written (`"active": false`), not even that happens.

**Do inactive descriptors still receive and spend?**
Yes, both. Tested with real coins: a wallet whose descriptors had been deactivated saw an incoming payment within seconds and swept it out without complaint. `active` governs only which branch produces *new* addresses.

**Why can't every descriptor be active at once?**
Because "active" answers the question *"where does the next SegWit address come from?"*, and that question can only have one answer. Core keeps one slot per address type and per branch — eight in total — so a ninth takes someone's seat.

**Does creating a wallet touch my existing one?**
No. Every wallet is its own folder with its own `wallet.dat` under `wallets/`. They never share a file.

**I want a wallet with only my own descriptors in it.**
Create a fresh blank one and import only your own seed with `"timestamp": 0`. The same coins appear there — no transaction, no fee, nothing touches the chain. Then unload the old wallet.

## What this guide does **not** cover

Being straight with you, because this is the part that matters:

- **This recovers what is on the blockchain.** Anything the pool still owed you but had not paid out yet — including amounts sitting below the minimum payout threshold — lives in the pool's own database, not in your wallet. **That money is not recoverable by you** if the pool disappears. Your seed phrase has never had any claim on it.
- **The Android app is not a backup.** It has our domain built into it, so it stops working when the site does. The app was only ever a front end. Your seed phrase is the backup, and this guide is how you use it.
- **We cannot recover your seed phrase.** We never had it. It was generated in your browser and never left it. This is the whole point of the design, and it is also the reason there is no support ticket that can save you if you lose those words.

---

## How we know this actually works

This is not a procedure someone wrote from documentation. Every command above was executed against the live BC3 network before this file was published.

A wallet was created in the web wallet, funded on **all four address types**, and then recovered on a clean BitcoinIII Core node using nothing but the seed phrase and the steps above. Core swept the funds in a single transaction — `6d47ef95931b254d8882fd3652f4491d239eed0207fe1a32d502289b52373bb6` — spending all four input types with the correct signature for each: a legacy `scriptSig`, a P2SH-P2WPKH redeem script, a SegWit v0 witness, and a Taproot Schnorr signature.

You can look that transaction up yourself on any BC3 explorer, or in your own node once it syncs.

---

## Running your own server

The guide above needs nothing but BitcoinIII Core, and that is the route that depends on nobody. But the wallet page itself talks to a server, so if `argfamining.com` is gone, the page stops working even though your coins are fine.

Everything needed to run that service yourself — or to run one for the community — is in this repository:

| Directory | What it is |
|---|---|
| [`electrumx-bc3/`](electrumx-bc3) | The Electrum server. **Stock ElectrumX cannot index BC3**: it hashes block ids with double-SHA256 and BC3 uses SHA3-256t past height 30240. This is the ~40 lines that fix that, and without them nobody can run a BC3 server at all. |
| [`cashier/`](cashier) | A small stateless bridge, because browsers cannot speak the Electrum protocol directly. Never sees a private key. |
| [`wallet/`](wallet) | The wallet page. Three files, no build step, no CDN. |
| [`docker-compose.example.yml`](docker-compose.example.yml) | All of it wired together. |

**If you run a public BC3 server, tell the community.** The more that exist, the less any single operator matters — including us.

---|---|
| [`electrumx-bc3/`](electrumx-bc3) | The Electrum server. **Stock ElectrumX cannot index BC3** — it hashes block ids with double-SHA256 and BC3 uses SHA3-256t past height 30240. This is the ~40 lines that fix that. |
| [`cashier/`](cashier) | A ~400-line stateless bridge, because browsers can't speak the Electrum protocol directly. Never sees a private key. |
| [`wallet/`](wallet) | The wallet page itself. Three files, no build step, no CDN. |
| [`docker-compose.example.yml`](docker-compose.example.yml) | All of it wired together. |

Anyone can run this. That is the whole reason it is published: a wallet whose infrastructure only one company can operate is a wallet with a single point of failure, no matter how good the cryptography underneath is.

**If you run a public BC3 server, tell the community** — the more of them exist, the less any single operator matters.

---

*BitcoinIII Core is MIT-licensed software provided without warranty. This guide is provided in the same spirit: it is accurate to the best of our testing, and following it is your own decision. Nobody but you controls your keys, which also means nobody but you is able to make mistakes with them.*
