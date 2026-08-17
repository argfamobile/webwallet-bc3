# Recover your BC3 web wallet without ArgfaMining

**If `argfamining.com` is gone, your coins are not.** This guide takes you from your 12 (or 24) recovery words to spendable BitcoinIII, using only software you download yourself. Nothing here needs our servers, our website, or our permission.

You do not need to trust us to follow it. Every step is a command you can read, run and verify.

---

## The short version

Your wallet is a standard **BIP39 seed phrase** with standard derivation paths. That is not a marketing claim — it means any tool that implements those standards produces the exact same keys, forever. To get your coins back you need two things:

1. **BitcoinIII Core**, the network's own wallet software.
2. **Your master key**, derived from your words on a machine with no internet.

Then you paste in a handful of one-line commands and Core does the rest.

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

## Step 2 — Get your master key, offline

Core does not understand seed phrases. It understands *keys*. So first you convert one into the other, and you do it with the network turned off.

1. Go to **https://github.com/iancoleman/bip39/releases** and download the file named `bip39-standalone.html` from the latest release. This is a widely used, open-source tool that runs entirely inside your browser — it is not ours, and that is on purpose: it has been reviewed by far more people than anything we could write.
2. **Disconnect from the internet.** Turn off Wi-Fi, unplug the cable. Do it now, before the next step.
3. Open the downloaded `bip39-standalone.html` file in your browser.
4. Type your seed phrase into the **BIP39 Mnemonic** field.
5. Leave **Coin** set to `BTC - Bitcoin`. This is correct — BC3 uses the same key format as Bitcoin.
6. Find the field labelled **BIP32 Root Key**. It starts with `xprv`. Copy it.

That `xprv` is your master key. Keep it exactly as private as your seed phrase: anyone who has it owns your coins.

> **It must start with `xprv`.** If you copied something starting with `zprv` or `yprv`, you took it from the wrong box — those are a different encoding and BitcoinIII Core will reject them. The **BIP32 Root Key** field at the top is the one you want.

Once you have finished with the tool, close the browser tab. You can reconnect after Step 3.

---

## Step 3 — Import into BitcoinIII Core

Open Core and go to **Window → Console** (in `bitcoinIII-qt`). You'll type commands there.

### 3a. Create an empty wallet

```
createwallet "bc3-web-wallet-recovery" false true
```

Those arguments are positional on purpose. The Core console reads every argument as JSON, so `blank=true` fails there with `Error parsing JSON` — named arguments only work with `bitcoinIII-cli -named`, which is a different path.

### 3b. Switch to that wallet, and check that you did

**Core does not switch for you.** At the top of the console window there is a **Wallet** dropdown still pointing at whatever was open before. Change it to `bc3-web-wallet-recovery`, then confirm:

```
getwalletinfo
```

The answer must say `"walletname": "bc3-web-wallet-recovery"`. If it says anything else, you are about to import into the wrong wallet.

### 3c. Build your eight descriptors

A *descriptor* tells Core how your addresses were made. Your wallet could receive on four different address styles, so there are four of them — and each needs a receiving and a change version, which is eight lines.

Take the eight templates below and **replace every `XPRV` with your master key from Step 2**:

```
pkh(XPRV/44h/0h/0h/0/*)
pkh(XPRV/44h/0h/0h/1/*)
sh(wpkh(XPRV/49h/0h/0h/0/*))
sh(wpkh(XPRV/49h/0h/0h/1/*))
wpkh(XPRV/84h/0h/0h/0/*)
wpkh(XPRV/84h/0h/0h/1/*)
tr(XPRV/86h/0h/0h/0/*)
tr(XPRV/86h/0h/0h/1/*)
```

**Import all eight even if you only ever used one address.** They cover the four styles the wallet supported — legacy `1…`, `3…`, `bc1q…` and `bc1p…`. If you skip one, any coins you received on it stay invisible, and the balance you see will be wrong in the worst possible way: quietly.

### 3d. Get a checksum for each one

Core refuses descriptors without a checksum. For each of the eight lines, run:

```
getdescriptorinfo "pkh(XPRV/44h/0h/0h/0/*)"
```

From the reply, copy **only the `checksum` value** (eight characters). Your descriptor becomes the line you typed, plus `#`, plus that checksum:

```
pkh(XPRV/44h/0h/0h/0/*)#abcd1234
```

> **Do not copy the `descriptor` field from that reply.** This is the single most common way to get stuck. Core answers with a *rewritten* version of your descriptor in which your private key has been replaced by a public one. Import that and you get a wallet that can watch your coins but can never spend them, and the error message won't explain why. Take the `checksum` and nothing else.

### 3e. Import

Import them **one at a time** — eight short commands instead of one enormous one. If a line has a typo you'll see exactly which, instead of hunting through a wall of text.

> **Why `"active": false`.** In Core, "active" doesn't mean "enabled" — it means *"new addresses of this type come from this descriptor"*, and there is room for exactly one per address type. Importing with `"active": true` therefore **evicts** whatever was there, so running these commands in the wrong wallet silently changes which branch that wallet derives from. With `false` nothing is displaced, and you lose nothing that matters here: the wallet still sees the imported funds and still spends them, because watching and signing don't consult that flag. The only thing it won't do is hand you *new* addresses from this seed, which is not what you came for.

Note the quoting: **single quotes on the outside, double quotes inside, no backslashes.** That is what the Core console expects.

The four *receiving* descriptors use `"internal":false`:

```
importdescriptors '[{"desc":"pkh(XPRV/44h/0h/0h/0/*)#CHECKSUM","timestamp":0,"active":false,"internal":false,"range":[0,100]}]'
importdescriptors '[{"desc":"sh(wpkh(XPRV/49h/0h/0h/0/*))#CHECKSUM","timestamp":0,"active":false,"internal":false,"range":[0,100]}]'
importdescriptors '[{"desc":"wpkh(XPRV/84h/0h/0h/0/*)#CHECKSUM","timestamp":0,"active":false,"internal":false,"range":[0,100]}]'
importdescriptors '[{"desc":"tr(XPRV/86h/0h/0h/0/*)#CHECKSUM","timestamp":0,"active":false,"internal":false,"range":[0,100]}]'
```

The four *change* ones are identical except the path ends in `/1/*` and `internal` is `true`:

```
importdescriptors '[{"desc":"pkh(XPRV/44h/0h/0h/1/*)#CHECKSUM","timestamp":0,"active":false,"internal":true,"range":[0,100]}]'
importdescriptors '[{"desc":"sh(wpkh(XPRV/49h/0h/0h/1/*))#CHECKSUM","timestamp":0,"active":false,"internal":true,"range":[0,100]}]'
importdescriptors '[{"desc":"wpkh(XPRV/84h/0h/0h/1/*)#CHECKSUM","timestamp":0,"active":false,"internal":true,"range":[0,100]}]'
importdescriptors '[{"desc":"tr(XPRV/86h/0h/0h/1/*)#CHECKSUM","timestamp":0,"active":false,"internal":true,"range":[0,100]}]'
```

Each `CHECKSUM` is the one you got in Step 3d **for that exact line** — they are all different, and a checksum from the wrong line will be rejected.

`"timestamp":0` tells Core to search the whole chain, because you don't know when you received. On BC3 that scan takes seconds.

Every command should answer `"success": true`.

> **Using a terminal instead of the Core window?** With `bitcoinIII-cli` the quoting rules are your shell's, not Core's. On Linux and macOS the commands above work as written. On Windows `cmd.exe`, single quotes don't apply — use double quotes outside and `\"` for the inner ones. If you are unsure, use the Core window: it is the same commands and one less thing to get wrong.

---

## Step 4 — Check, then spend

Your balance should now be there:

```
getwalletinfo
listunspent
```

Before trusting it, confirm Core reproduces an address you recognise:

```
getnewaddress
```

Compare it against the addresses your web wallet used to show. They come from the same keys, so they match.

To move everything out — the real proof that you are in control:

```
sendall ["YOUR_DESTINATION_ADDRESS"]
```

Use `sendall` rather than `sendtoaddress`: it sweeps everything without needing a change address, which is what you want when the descriptors are imported as inactive.

That's it. Your coins are yours again, and no part of it went through us.

---

## Do this today, not the day you need it

The worst moment to discover your backup doesn't work is when it's the only thing you have left. This takes two minutes and moves nothing:

Do **Step 2** offline, then compare the addresses the tool shows under its `BIP84`, `BIP86`, `BIP44` and `BIP49` tabs against the ones your wallet displays under **Receive**. If they match, your seed phrase is correct and this whole guide will work for you when it matters.

If they *don't* match, you wrote your words down wrong — and you have just found out while you still have a working wallet to fix it from. That is worth two minutes.

---

## If something goes wrong

**`Cannot import descriptor without private keys to a wallet with private keys enabled`**
You imported the rewritten descriptor from Step 3d instead of your own. Go back and use only the `checksum`, appended to the line you typed.

**`Missing checksum`**
You skipped Step 3d on that descriptor.

**Core rejects your key**
It probably starts with `zprv` or `yprv`. Use the **BIP32 Root Key** field, which starts with `xprv`.

**Balance is zero but you expected coins**
Either the rescan is still running (`getwalletinfo` shows `scanning`), or you imported fewer than eight descriptors, or the coins are on addresses beyond index 100 — raise `range` to `[0,1000]` and import again.

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
