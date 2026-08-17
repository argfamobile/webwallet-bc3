/**
 * wallet-bc3.js — Web wallet HD no-custodial de BitcoinIII (BC3).
 * ----------------------------------------------------------------------------
 * Las claves y la seed viven SOLO en este navegador. La firma de transacciones
 * ocurre 100% client-side. El backend (cajero /api/bc3/wallet/*) nunca ve una clave:
 * solo recibe addresses públicas y, al enviar, una tx ya firmada.
 *
 * Stack cripto vendoreado local (assets/vendor/wallet-core.js, esbuild de scure/noble,
 * sin CDN, eval-free → compatible con la CSP estricta). BC3 = address params Bitcoin
 * mainnet (P2PKH '1...', WIF 0x80) → derivación BIP44 m/44'/0'/0'/{0,1}/i (coin type 0).
 *
 * v1 (Fase 3): crear/importar, recibir+QR, balance, historial, export de seed, persistencia
 * cifrada (WebCrypto AES-GCM). ENVIAR queda gateado hasta la validación con dinero real
 * (Fase 4) — el bundle ya trae el firmador (btc-signer); se habilita con SEND_ENABLED.
 */
import * as WC from './vendor/wallet-core.js';

const SEND_ENABLED = true;                  // habilitado tras validar la firma (testmempoolaccept allowed) — Fase 4
// Cajero por defecto: el del propio origen. Se puede apuntar a OTRO servidor (el de un
// tercero, o el tuyo) por <meta name="bc3-cashier"> o desde Settings, y esa es justamente
// la pieza que hace que la wallet siga sirviendo el día que este servidor no exista:
// cualquiera puede levantar ElectrumX-BC3 + cajero y los usuarios apuntan su copia ahí.
// Ver github.com/argfamobile/webwallet-bc3.
const CASHIER_DEFAULT = '/api/bc3/wallet';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
function cashierBase() {
  const meta = document.querySelector('meta[name="bc3-cashier"]');
  return (lsGet('bc3_cashier') || (meta && meta.content) || CASHIER_DEFAULT).replace(/\/+$/, '');
}
const NET = WC.btc.NETWORK;                 // Bitcoin mainnet = params BC3
const GAP = { receive: 12, change: 6 };     // ventana de scan por cadena
const COIN = 0;                             // coin type (BC3 reusa params Bitcoin)
const hexToBytes = WC.base.hex.decode;
const bytesToHex = WC.base.hex.encode;
const ADDR_RE = /^(?:[123][a-km-zA-HJ-NP-Z1-9]{25,39}|bc1[a-z0-9]{8,87})$/;   // P2PKH/P2SH/bech32(m) BC3

// Tipos de address soportados para RECIBIR (BC3 tiene SegWit @h290 + Taproot @h6048 ACTIVOS).
//  · purpose = BIP por tipo (44/49/84/86)  · vbytes = peso real del input medido (fee correcto por tipo)
//  · pay(node) = builder btc-signer cuyo .address/.script/.redeemScript/.tapInternalKey usamos.
// OJO p2tr: x-only key (pub.slice(1)) y scriptTree=undefined como 2º arg — `btc.p2tr(pub, NET)` está MAL
// (el 2º arg posicional es el árbol de scripts, no la red) → verificado contra el bundle vendoreado.
const ADDR_TYPES = {
  p2wpkh: { purpose: 84, label: 'SegWit',  vbytes: 68,  pay: (node) => WC.btc.p2wpkh(node.publicKey, NET) },
  p2tr:   { purpose: 86, label: 'Taproot', vbytes: 58,  pay: (node) => WC.btc.p2tr(node.publicKey.slice(1), undefined, NET) },
  p2pkh:  { purpose: 44, label: 'Legacy',  vbytes: 148, pay: (node) => WC.btc.p2pkh(node.publicKey, NET) },
  p2sh:   { purpose: 49, label: 'P2SH',    vbytes: 91,  pay: (node) => WC.btc.p2sh(WC.btc.p2wpkh(node.publicKey, NET), NET) },
};
const TYPE_ORDER = ['p2wpkh', 'p2tr', 'p2pkh', 'p2sh'];   // SegWit por defecto primero

// ── estado en memoria (nunca se loguea ni se manda al server) ───────────────
let W = null;   // { root, mnemonic, receive: {p2wpkh:[{i,type,chain,node,address}],…}, change: {…} }
let curRxType = 'p2wpkh';                                          // tipo activo en Recibir (default SegWit)
const curReceiveIdx = { p2wpkh: 0, p2tr: 0, p2pkh: 0, p2sh: 0 };  // índice de address por tipo

const $ = (id) => document.getElementById(id);
const fmt = (sats) => (sats / 1e8).toLocaleString('en-US', { minimumFractionDigits: 8, maximumFractionDigits: 8 });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (msg, kind = 'ok') => { const t = $('toast'); t.textContent = msg; t.className = 'toast show ' + kind; setTimeout(() => t.className = 'toast', 2600); };

// ── derivación HD (multi-formato BIP44/49/84/86) ────────────────────────────
function deriveChain(root, type, chain, n, startIdx = 0) {
  const t = ADDR_TYPES[type];
  const out = [];
  for (let k = 0; k < n; k++) {
    const i = startIdx + k;
    const node = root.derive(`m/${t.purpose}'/${COIN}'/0'/${chain}/${i}`);
    out.push({ i, type, chain, node, address: t.pay(node).address });
  }
  return out;
}
function buildWallet(mnemonic) {
  const seed = WC.bip39.mnemonicToSeedSync(mnemonic);
  const root = WC.HDKey.fromMasterSeed(seed);
  const receive = {}, change = {};
  for (const type of TYPE_ORDER) {
    receive[type] = deriveChain(root, type, 0, GAP.receive);
    change[type] = deriveChain(root, type, 1, GAP.change);
  }
  return { mnemonic, root, receive, change };
}
// Todas las addresses derivadas (4 tipos × receive+change) — para escanear balance/utxos/historial.
const allDerived = () => TYPE_ORDER.flatMap((t) => [...W.receive[t], ...W.change[t]]);
// Aplica fn en lotes de `size` concurrentes (no satura el pool TCP cajero→ElectrumX con 72 addresses).
async function mapChunked(items, fn, size = 10) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

// ── API del cajero ──────────────────────────────────────────────────────────
async function api(path, opts) {
  const r = await fetch(cashierBase() + path, opts);
  const j = await r.json().catch(() => ({ ok: false, error: 'bad json' }));
  if (!r.ok || j.ok === false) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
const getBalance = (addr) => api('/balance?address=' + encodeURIComponent(addr));
const getHistory = (addr) => api('/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr }) });

// ── persistencia cifrada (WebCrypto AES-GCM + PBKDF2) ───────────────────────
const LS_KEY = 'bc3wallet.v1';
const enc = new TextEncoder(), dec = new TextDecoder();
async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function saveEncrypted(mnemonic, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(mnemonic)));
  localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, salt: bytesToHex(salt), iv: bytesToHex(iv), ct: bytesToHex(ct) }));
}
async function loadEncrypted(pass) {
  const raw = JSON.parse(localStorage.getItem(LS_KEY));
  const key = await deriveKey(pass, hexToBytes(raw.salt));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(raw.iv) }, key, hexToBytes(raw.ct));
  return dec.decode(pt);
}
const hasSaved = () => !!localStorage.getItem(LS_KEY);

// ── routing de pantallas ────────────────────────────────────────────────────
function show(screen) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = (s.dataset.screen !== screen);
  for (const e of document.querySelectorAll('[data-screen-only]')) e.hidden = (e.dataset.screenOnly !== screen);
}
function tab(name) {
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const p of document.querySelectorAll('.pane')) p.hidden = (p.dataset.pane !== name);
  if (name === 'receive') renderReceive();
  if (name === 'send') renderSend();
  if (name === 'history') refreshHistory();
}

// ── onboarding ──────────────────────────────────────────────────────────────
let pendingMnemonic = null;
function startCreate() {
  pendingMnemonic = WC.bip39.generateMnemonic(WC.wordlist, 128);   // 12 palabras
  const grid = $('seedGrid'); grid.innerHTML = '';
  pendingMnemonic.split(' ').forEach((w, i) => {
    const li = document.createElement('li'); li.innerHTML = `<span class="seed-n">${i + 1}</span>${esc(w)}`; grid.appendChild(li);
  });
  $('seedAck').checked = false; $('confirmSeed').disabled = true;
  show('create');
}
function finishCreate() {
  openWallet(pendingMnemonic);
  toast('Wallet created — back up your seed phrase');
  pendingMnemonic = null;
}
function doImport() {
  const v = $('importInput').value.trim().replace(/\s+/g, ' ').toLowerCase();
  try {
    if (!WC.bip39.validateMnemonic(v, WC.wordlist)) throw new Error('Invalid seed phrase (need 12 or 24 BIP39 words)');
    openWallet(v);
    toast('Wallet imported');
  } catch (e) { toast(e.message, 'err'); }
}

function openWallet(mnemonic) {
  W = buildWallet(mnemonic);
  show('wallet');
  tab('receive');
  refreshBalance();
}

// ── balance (scan de la ventana de addresses, 4 tipos) ──────────────────────
async function refreshBalance() {
  $('balAmount').textContent = '…';
  const addrs = allDerived().map((a) => a.address);
  try {
    const results = await mapChunked(addrs, (a) => getBalance(a).catch(() => ({ confirmed_sats: 0, unconfirmed_sats: 0 })));
    let conf = 0, unconf = 0;
    results.forEach((b) => { conf += b.confirmed_sats || 0; unconf += b.unconfirmed_sats || 0; });
    $('balAmount').textContent = fmt(conf);
    $('balUnconf').textContent = unconf > 0 ? ('+' + fmt(unconf) + ' BC3 pending') : '';
    $('balUnconf').hidden = !(unconf > 0);
  } catch (e) { $('balAmount').textContent = '—'; toast('Balance error: ' + e.message, 'err'); }
}

// ── recibir + QR ────────────────────────────────────────────────────────────
function renderReceive() {
  const list = W.receive[curRxType];
  const a = list[curReceiveIdx[curRxType]];
  $('rxAddr').textContent = a.address;
  $('rxPath').textContent = `m/${ADDR_TYPES[curRxType].purpose}'/${COIN}'/0'/0/${a.i}`;
  const qr = WC.qrcode(0, 'M'); qr.addData(a.address); qr.make();
  $('rxQr').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
}
function nextAddress() {
  const list = W.receive[curRxType];
  curReceiveIdx[curRxType]++;
  if (curReceiveIdx[curRxType] >= list.length) list.push(...deriveChain(W.root, curRxType, 0, 1, list.length));
  renderReceive();
  toast('New receive address');
}

// ── historial ───────────────────────────────────────────────────────────────
async function refreshHistory() {
  const box = $('histList'); box.innerHTML = '<div class="muted">Loading…</div>';
  try {
    const addrs = allDerived().map((a) => a.address);
    const lists = await mapChunked(addrs, (a) => getHistory(a).then((r) => r.history).catch(() => []));
    const seen = new Set(), rows = [];
    lists.flat().forEach((h) => { if (!seen.has(h.txid)) { seen.add(h.txid); rows.push(h); } });
    rows.sort((a, b) => (b.height || 9e15) - (a.height || 9e15));
    if (!rows.length) { box.innerHTML = '<div class="muted">No transactions yet.</div>'; return; }
    box.innerHTML = rows.slice(0, 50).map((h) => `
      <a class="hist-row" href="/explorer/bc3/tx/${esc(h.txid)}" target="_blank" rel="noopener">
        <span class="hist-tx mono">${esc(h.txid.slice(0, 16))}…${esc(h.txid.slice(-8))}</span>
        <span class="hist-h">${h.height > 0 ? ('#' + h.height + ' · ' + h.confirmations + ' conf') : 'pending'}</span>
      </a>`).join('');
  } catch (e) { box.innerHTML = `<div class="muted">Error: ${esc(e.message)}</div>`; }
}

// ── ENVIAR (build + sign + broadcast 100% client-side) ──────────────────────
let feeRates = { slow: 1, normal: 2, fast: 3 };
let curFee = 'normal';
// vbytes con peso real por tipo de input (P2PKH 148 / P2SH 91 / SegWit 68 / Taproot 58) + outputs ~34 + overhead.
const inVbytes = (u) => (ADDR_TYPES[u.type] ? ADDR_TYPES[u.type].vbytes : 148);
const txVbytes = (utxos, nout) => Math.ceil(10.5 + utxos.reduce((s, u) => s + inVbytes(u), 0) + nout * 34);
// El nodo BC3 rechaza por `tx-size` toda tx sobre MAX_STANDARD_TX_WEIGHT = 400.000 WU = 100.000 vB
// (verificado con testmempoolaccept contra el nodo: 399.688 WU pasa, 400.344 da tx-size).
// Un minero acumula cientos de UTXOs chicos (un pago de pool = un UTXO) → sin este cap la wallet
// arma una tx que la red no acepta. 99.000 vB deja margen para el redondeo del estimador.
const MAX_TX_VBYTES = 99_000;
// Toma de `list` (ya ordenada por prioridad) todo lo que entra en una tx estándar de `nout` salidas.
function capBySize(list, nout) {
  const out = [];
  let vb = Math.ceil(10.5 + nout * 34);
  for (const u of list) {
    const next = vb + inVbytes(u);
    if (next > MAX_TX_VBYTES) break;
    vb = next; out.push(u);
  }
  return out;
}

async function renderSend() {
  try {
    const f = await api('/feerate');
    feeRates = { slow: f.slow_sat_vb || 1, normal: f.normal_sat_vb || 2, fast: f.fast_sat_vb || 3 };
  } catch { /* defaults */ }
  $('feeInfo').textContent = (feeRates[curFee] || 2) + ' sat/vB';
}

// Junta UTXOs gastables (confirmados) de todas las addresses derivadas, cada uno
// etiquetado con su nodo HD (= su clave privada para firmar).
async function gatherUtxos() {
  const out = [];
  await mapChunked(allDerived(), async (a) => {
    try {
      const r = await api('/utxos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: a.address }) });
      for (const u of (r.utxos || [])) if (u.confirmations >= 1) out.push({ ...u, node: a.node, type: a.type });
    } catch { /* skip address */ }
  });
  return out;
}

const maxOn = () => $('sendMax').dataset.on === '1';
function setMax(on) {
  $('sendMax').dataset.on = on ? '1' : '0';
  $('sendMax').classList.toggle('on', on);
  $('sendAmt').disabled = on;
  $('sendAmt').placeholder = on ? 'all funds (sweep)' : '0.00000000';
  if (on) $('sendAmt').value = '';
}

async function doSend() {
  const to = $('sendTo').value.trim();
  if (!ADDR_RE.test(to)) return toast('Invalid BC3 address', 'err');
  const sweep = maxOn();
  if (!sweep && !(parseFloat($('sendAmt').value) > 0)) return toast('Enter an amount', 'err');
  const st = (m) => { $('sendStatus').textContent = m; };
  toast('Building transaction…');                 // feedback instantáneo: el click registró
  $('sendBtn').disabled = true; st('Gathering coins…');
  try {
    const rate = feeRates[curFee] || 2;
    const utxos = await gatherUtxos();
    if (!utxos.length) throw new Error('No confirmed funds to spend');
    utxos.sort((a, b) => b.value - a.value);
    const total = utxos.reduce((s, u) => s + u.value, 0);

    let selected, amountSats, fee, change = 0;
    let leftover = 0;                                     // UTXOs que no entraron en esta tx (sweep por tandas)
    if (sweep) {
      selected = capBySize(utxos, 1);
      leftover = utxos.length - selected.length;
      const selTotal = selected.reduce((s, u) => s + u.value, 0);
      fee = txVbytes(selected, 1) * rate;
      amountSats = selTotal - fee;
      if (amountSats <= 546) throw new Error('Balance too low after fee');
    } else {
      amountSats = Math.round(parseFloat($('sendAmt').value) * 1e8);
      if (amountSats <= 546) throw new Error('Amount below dust');
      const room = capBySize(utxos, 2);                   // cuánto cabe en una tx estándar
      selected = []; let acc = 0;
      for (const u of room) { selected.push(u); acc += u.value; if (acc >= amountSats + txVbytes(selected, 2) * rate) break; }
      fee = txVbytes(selected, 2) * rate;
      if (acc < amountSats + fee) {
        // Con TODO lo que cabe en una tx no alcanza. Si hay saldo de sobra, el techo no es el dinero
        // sino el tamaño: son demasiadas monedas chicas y hay que consolidarlas por tandas.
        if (total >= amountSats + fee) {
          throw new Error(`Too many small coins for one transaction (${utxos.length} coins). `
            + `Send up to ${(acc / 1e8).toFixed(8)} BC3 at a time, or use Max to sweep in batches.`);
        }
        throw new Error('Insufficient funds (incl. fee)');
      }
      change = acc - amountSats - fee;
      if (change <= 546) { fee += change; change = 0; }   // pliega cambio dust al fee
    }

    st('Building & signing…');
    const tx = new WC.btc.Transaction();
    for (const u of selected) {
      const input = { txid: hexToBytes(u.txid), index: u.vout };
      if (u.type === 'p2pkh') {
        const pr = await api('/rawtx/' + u.txid);          // legacy → prev-tx completa (nonWitnessUtxo)
        input.nonWitnessUtxo = hexToBytes(pr.hex);
      } else {                                             // segwit/taproot/p2sh → witnessUtxo (script + amount)
        const p = ADDR_TYPES[u.type].pay(u.node);
        input.witnessUtxo = { script: p.script, amount: BigInt(u.value) };
        if (u.type === 'p2sh') input.redeemScript = p.redeemScript;       // P2SH-P2WPKH
        if (u.type === 'p2tr') input.tapInternalKey = p.tapInternalKey;   // Taproot key-path (x-only)
      }
      tx.addInput(input);
    }
    tx.addOutputAddress(to, BigInt(amountSats), NET);
    if (change > 546) tx.addOutputAddress(W.change.p2wpkh[0].address, BigInt(change), NET);   // cambio a SegWit (más barato)
    selected.forEach((u, i) => tx.signIdx(u.node.privateKey, i));   // firma 100% client-side (Schnorr auto-tweak en p2tr)
    tx.finalize();
    const rawHex = bytesToHex(tx.extract());

    st('Broadcasting…');
    const res = await api('/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rawtx: rawHex }) });
    const txid = String(res.txid || '');
    $('sendStatus').innerHTML = 'Sent ✓ &nbsp;<a href="/explorer/bc3/tx/' + esc(txid) + '" target="_blank" rel="noopener">' + esc(txid.slice(0, 20)) + '…</a>';
    toast('Transaction broadcast', 'ok');
    if (leftover > 0) {                                   // el sweep no entraba en una sola tx estándar
      $('sendStatus').innerHTML += ` &nbsp;· ${leftover} coins left — run Max again to sweep the rest.`;
      toast(`${leftover} coins left: run Max again`, 'ok');
    }
    $('sendTo').value = ''; setMax(false);
    setTimeout(refreshBalance, 1500);
  } catch (e) {
    st('Error: ' + e.message); toast(e.message, 'err');
  } finally { $('sendBtn').disabled = false; }
}

// ── settings / export / persistencia ────────────────────────────────────────
function showSeed() {
  if (!confirm('Your seed phrase gives FULL control of your funds. Make sure no one can see your screen. Reveal it?')) return;
  $('seedReveal').textContent = W.mnemonic;
  $('seedReveal').hidden = false;
}
async function saveToDevice() {
  const p1 = $('encPass').value, p2 = $('encPass2').value;
  if (p1.length < 8) return toast('Passphrase must be at least 8 characters', 'err');
  if (p1 !== p2) return toast('Passphrases do not match', 'err');
  try { await saveEncrypted(W.mnemonic, p1); toast('Wallet encrypted and saved on this device'); updateLockUI(); }
  catch (e) { toast('Error: ' + e.message, 'err'); }
}
function removeWallet() {
  if (!confirm('Remove the wallet from this device? You can only restore it with your seed phrase.')) return;
  localStorage.removeItem(LS_KEY); W = null; updateLockUI(); show('onboard');
  toast('Wallet removed from this device');
}
function updateLockUI() { $('removeBtn').hidden = !hasSaved(); }

async function unlock() {
  const p = $('unlockPass').value;
  try { const mn = await loadEncrypted(p); openWallet(mn); $('unlockPass').value = ''; }
  catch { toast('Wrong passphrase', 'err'); }
}

// ── bootstrap ───────────────────────────────────────────────────────────────
function wire() {
  $('createBtn').onclick = startCreate;
  $('importBtn').onclick = () => show('import');
  $('seedAck').onchange = (e) => { $('confirmSeed').disabled = !e.target.checked; };
  $('confirmSeed').onclick = finishCreate;
  $('doImportBtn').onclick = doImport;
  for (const b of document.querySelectorAll('[data-back]')) b.onclick = () => show(hasSaved() ? 'unlock' : 'onboard');
  for (const t of document.querySelectorAll('.tab')) t.onclick = () => tab(t.dataset.tab);
  for (const t of document.querySelectorAll('.rxtab')) t.onclick = () => {   // selector de tipo de address en Recibir
    curRxType = t.dataset.rxtype;
    document.querySelectorAll('.rxtab').forEach((x) => x.classList.toggle('active', x === t));
    renderReceive();
  };
  // Drawer móvil: el sidebar se abre/cierra como menú off-canvas (hamburguesa + backdrop)
  const sideEl = document.querySelector('.side'), backdrop = $('sideBackdrop'), navToggle = $('navToggle');
  const setDrawer = (open) => { if (sideEl) sideEl.classList.toggle('open', open); if (backdrop) backdrop.classList.toggle('open', open); };
  if (navToggle) navToggle.onclick = () => setDrawer(!(sideEl && sideEl.classList.contains('open')));
  if (backdrop) backdrop.onclick = () => setDrawer(false);
  for (const a of document.querySelectorAll('.side a')) a.addEventListener('click', () => setDrawer(false));
  // Si ya estamos dentro de la app Android (Capacitor), ocultar la tarjeta de descarga (redundante)
  if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) {
    const dl = $('dlSection'); if (dl) dl.hidden = true;
  }
  // Modal de descarga: la tarjeta lo abre (en vez de navegar); el QR apunta a la página de descarga
  const dlCard = $('dlAndroid'), dlModal = $('dlModal');
  if (dlCard && dlModal) {
    const openDl = (e) => {
      if (e) e.preventDefault();
      dlModal.hidden = false;
      const qr = WC.qrcode(0, 'M'); qr.addData('https://argfamining.com/get_bc3_wallet.html'); qr.make();
      $('dlQr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    };
    const closeDl = () => { dlModal.hidden = true; };
    dlCard.onclick = openDl;
    $('dlModalClose').onclick = closeDl;
    dlModal.onclick = (e) => { if (e.target === dlModal) closeDl(); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !dlModal.hidden) closeDl(); });
  }
  const doCopy = () => {
    navigator.clipboard.writeText(W.receive[curRxType][curReceiveIdx[curRxType]].address).catch(() => {});
    toast('Address copied');
    const b = $('copyAddr'); b.classList.add('ok'); setTimeout(() => b.classList.remove('ok'), 1200);
  };
  $('copyAddr').onclick = doCopy;
  $('rxAddr').onclick = doCopy;
  $('newAddr').onclick = nextAddress;
  $('refreshBal').onclick = refreshBalance;
  $('showSeedBtn').onclick = showSeed;
  // Selector de cajero: lo que permite seguir usando la wallet contra otro servidor.
  const cu = $('cashierUrl');
  if (cu) {
    cu.value = lsGet('bc3_cashier') || '';
    cu.placeholder = CASHIER_DEFAULT;
    $('saveCashier').onclick = () => {
      const v = cu.value.trim().replace(/\/+$/, '');
      try {
        if (v) localStorage.setItem('bc3_cashier', v); else localStorage.removeItem('bc3_cashier');
      } catch { return toast('This browser blocks local storage', 'err'); }
      toast(v ? 'Using ' + v : 'Back to the default server');
      refreshBalance();
    };
    $('resetCashier').onclick = () => {
      try { localStorage.removeItem('bc3_cashier'); } catch { /* ignore */ }
      cu.value = ''; toast('Back to the default server'); refreshBalance();
    };
  }
  $('saveDeviceBtn').onclick = saveToDevice;
  // Mostrar/ocultar passphrase (ojo) en ambos campos
  for (const eye of document.querySelectorAll('.pass-eye')) eye.onclick = () => {
    const inp = $(eye.dataset.target), show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    eye.querySelector('.eye-on').hidden = show;
    eye.querySelector('.eye-off').hidden = !show;
  };
  // Verificación en vivo: las 2 passphrases coinciden + ≥8 chars → habilita el botón; si no, lo indica
  const checkPass = () => {
    const p1 = $('encPass').value, p2 = $('encPass2').value, el = $('passMatch'), btn = $('saveDeviceBtn');
    if (!p1 && !p2) { el.hidden = true; btn.disabled = true; return; }
    if (p1.length < 8) { el.hidden = false; el.className = 'pass-match err'; el.textContent = '✗ At least 8 characters'; btn.disabled = true; return; }
    if (!p2) { el.hidden = true; btn.disabled = true; return; }
    const ok = p1 === p2;
    el.hidden = false; el.className = 'pass-match ' + (ok ? 'ok' : 'err');
    el.textContent = ok ? '✓ Passphrases match' : '✗ Passphrases don’t match';
    btn.disabled = !ok;
  };
  $('encPass').addEventListener('input', checkPass);
  $('encPass2').addEventListener('input', checkPass);
  $('removeBtn').onclick = removeWallet;
  $('unlockBtn').onclick = unlock;
  $('unlockToImport').onclick = () => show('onboard');
  $('unlockPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
  // El botón Lock vive en el topbar del sitio; en un hosting propio de la wallet
  // (webwallet-bc3/wallet) ese chrome no existe, así que el módulo no puede asumirlo.
  const lockBtn = $('lockBtn');
  if (lockBtn) lockBtn.onclick = () => { W = null; show(hasSaved() ? 'unlock' : 'onboard'); };
  // Send (build + sign + broadcast client-side)
  for (const t of document.querySelectorAll('.feetab')) t.onclick = () => {
    curFee = t.dataset.fee;
    document.querySelectorAll('.feetab').forEach((x) => x.classList.toggle('active', x === t));
    $('feeInfo').textContent = (feeRates[curFee] || 2) + ' sat/vB';
  };
  $('sendMax').onclick = () => setMax(!maxOn());
  $('sendBtn').onclick = doSend;

  updateLockUI();
  show(hasSaved() ? 'unlock' : 'onboard');
}

// Capturador global: cualquier error no atrapado se muestra (diagnóstico visible).
window.addEventListener('error', (ev) => { try { toast('Error: ' + (ev.message || (ev.error && ev.error.message) || 'unknown'), 'err'); } catch {} });
window.addEventListener('unhandledrejection', (ev) => { try { toast('Error: ' + ((ev.reason && ev.reason.message) || ev.reason || 'rejection'), 'err'); } catch {} });

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
else wire();
