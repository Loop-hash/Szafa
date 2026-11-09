// Szafa: stos zdjęć przecenionych ciuchów z sieciówek.
// Dane zbiera robot na GitHubie (data/offers.json), apka filtruje je u siebie.

const REPO = 'Loop-hash/Szafa';
const DATA_URL = `https://raw.githubusercontent.com/${REPO}/main/data/offers.json`;
const PRICES_URL = `https://raw.githubusercontent.com/${REPO}/main/data/prices.json`;
const RELEASE_API = `https://api.github.com/repos/${REPO}/releases/tags/najnowsza`;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const today = () => new Date().toISOString().slice(0, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const disc = (it) => (it.old > 0 ? Math.round((1 - it.price / it.old) * 100) : 0);
const zl = (v) => (v == null ? '' : (Math.round(v * 100) / 100).toFixed(2).replace('.', ',').replace(',00', ''));
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const native = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

function plugin(name) {
  const C = window.Capacitor;
  if (!C || !native()) return null;
  if (C.Plugins && C.Plugins[name]) return C.Plugins[name];
  return C.registerPlugin ? C.registerPlugin(name) : null;
}

// ---------- kategorie, sklepy, rozmiary ----------
const CATS = [
  ['kurtki', 'Kurtki', 'płaszcze i puchówki'], ['bluzy', 'Bluzy', 'z kapturem i bez'], ['swetry', 'Swetry', 'ciepło i miękko'],
  ['koszulki', 'Koszulki', 't-shirty i longsleeve'], ['koszule', 'Koszule', 'na każdą okazję'], ['spodnie', 'Spodnie', 'jeansy, cargo, dresy'],
  ['szorty', 'Szorty', 'na ciepłe dni'], ['sukienki', 'Sukienki', 'krótkie i długie'], ['spodnice', 'Spódnice', ''],
  ['buty', 'Buty', 'sneakersy i nie tylko'], ['dodatki', 'Dodatki', 'czapki, torby, paski'], ['bielizna', 'Bielizna', ''], ['inne', 'Inne', 'reszta'],
];
const CAT_NAME = Object.fromEntries(CATS.map((c) => [c[0], c[1]]));
const SHOPS = [['reserved', 'Reserved'], ['cropp', 'Cropp'], ['house', 'House'], ['mohito', 'Mohito'], ['sinsay', 'Sinsay'], ['zara', 'Zara'], ['ccc', 'CCC']];
const GROUP = { kurtki: 'top', bluzy: 'top', swetry: 'top', koszulki: 'top', koszule: 'top', sukienki: 'top', spodnie: 'bottom', szorty: 'bottom', spodnice: 'bottom', buty: 'shoes' };
const SIZES = {
  top: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
  bottom: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '29', '30', '31', '32', '33', '34', '36', '38'],
  shoes: ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47'],
};

// ---------- pamięć ----------
const DEF = {
  sex: ['m', 'k', 'u'], cats: CATS.map((c) => c[0]).filter((c) => c !== 'inne'), shops: SHOPS.map((s) => s[0]),
  sizes: { top: [], bottom: [], shoes: [] }, minDisc: 20, maxPrice: 0, low30: false, newOnly: false,
  film: false, sound: true, haptic: true, shake: true, facedown: true, scratch: true,
};
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem('szafa.' + k)); return v == null ? d : v; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem('szafa.' + k, JSON.stringify(v)); } catch (e) { /* pełna pamięć */ } };

const S = {
  set: { ...DEF, ...load('set', {}) },
  saved: load('saved', {}), // id -> {item, at, price}
  trash: new Set(load('trash', [])),
  sold: load('sold', {}), // id -> dzień, kiedy apka zobaczyła, że wyprzedane
  scratchDay: load('scratchDay', ''),
  launches: load('launches', 0) + 1,
  items: [], byId: new Map(), feed: [], pos: 0, quickCat: null, updated: '',
};
S.set.sizes = { ...DEF.sizes, ...(S.set.sizes || {}) };
for (const [k] of SHOPS) if (!load('seenShop.' + k, false)) { if (!S.set.shops.includes(k)) S.set.shops.push(k); save('seenShop.' + k, true); }
save('launches', S.launches);

// duże dane w IndexedDB (localStorage ma za mało miejsca)
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('szafa', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) { const db = await idb(); return new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); }
async function idbSet(k, v) { const db = await idb(); return new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); }

// ---------- dźwięki (syntezowane, bez plików) ----------
let AC = null;
function ac() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } } if (AC.state === 'suspended') AC.resume(); return AC; }
function noise(dur, { freq = 1200, q = 1, gain = 0.3, type = 'bandpass', at = 0 } = {}) {
  const a = ac(); if (!a || !S.set.sound) return;
  const n = Math.floor(a.sampleRate * dur); const b = a.createBuffer(1, n, a.sampleRate); const d = b.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource(); src.buffer = b;
  const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = a.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination); src.start(a.currentTime + at);
}
function tone(f0, f1, dur, { gain = 0.25, type = 'sine', at = 0 } = {}) {
  const a = ac(); if (!a || !S.set.sound) return;
  const o = a.createOscillator(); const g = a.createGain(); const t = a.currentTime + at;
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
const SFX = {
  drawer() { noise(0.28, { freq: 500, q: 0.7, gain: 0.35 }); tone(140, 60, 0.18, { gain: 0.5, at: 0.26 }); noise(0.05, { freq: 2500, gain: 0.25, at: 0.27 }); },
  film() { noise(0.025, { freq: 3800, q: 3, gain: 0.25 }); noise(0.02, { freq: 2600, q: 3, gain: 0.18, at: 0.05 }); },
  tick() { noise(0.015, { freq: 3000, q: 4, gain: 0.08 }); },
  crumple() { for (let i = 0; i < 9; i++) noise(0.04 + Math.random() * 0.05, { freq: 1500 + Math.random() * 3000, q: 0.8, gain: 0.25, at: i * 0.06 }); tone(220, 70, 0.15, { gain: 0.3, at: 0.62 }); },
  whoosh() { noise(0.45, { freq: 700, q: 0.5, gain: 0.3, type: 'lowpass' }); },
  flip() { noise(0.09, { freq: 1800, q: 1.2, gain: 0.2 }); },
  scratch() { noise(0.03, { freq: 5000 + Math.random() * 2000, q: 2, gain: 0.07 }); },
  win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.14, { gain: 0.16, type: 'square', at: i * 0.09 })); },
};
function buzz(ms) { if (S.set.haptic && navigator.vibrate) navigator.vibrate(ms); }

function toast(t, ms = 2000) {
  const el = $('#toast'); el.textContent = t; el.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('on'), ms);
}

// ---------- dane ----------
async function loadData() {
  const cached = await idbGet('offers').catch(() => null);
  if (cached) useData(cached);
  try {
    const r = await fetch(DATA_URL + '?t=' + Math.floor(Date.now() / 600000), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (!cached || d.updated !== cached.updated) { await idbSet('offers', d).catch(() => {}); useData(d, !!cached); }
  } catch (e) {
    if (!cached) { toast('Brak internetu i zapisanych promocji', 3500); render(); }
  }
}

function useData(d, refresh) {
  S.items = d.items || []; S.updated = d.updated || ''; S.status = d.status || {};
  S.byId = new Map(S.items.map((i) => [i.id, i]));
  buildFeed(refresh);
  syncWatch();
  if ($('#wardrobe').classList.contains('active')) renderWardrobe(false);
}

function sizeOk(it) {
  const g = GROUP[it.cat]; if (!g) return true;
  const want = S.set.sizes[g] || []; if (!want.length || !it.sizes || !it.sizes.length) return true;
  return it.sizes.some((s) => want.some((w) => s === w || s.split(/[\/ ]/)[0] === w || s.toUpperCase() === w));
}

function passes(it, ignoreQuick) {
  const s = S.set;
  if (S.trash.has(it.id) || S.sold[it.id]) return false;
  if (!s.shops.includes(it.shop)) return false;
  if (!s.sex.includes(it.sex === 'd' ? 'd' : it.sex)) return false;
  if (!s.cats.includes(it.cat)) return false;
  if (!ignoreQuick && S.quickCat && it.cat !== S.quickCat) return false;
  if (disc(it) < s.minDisc) return false;
  if (s.maxPrice > 0 && it.price > s.maxPrice) return false;
  if (s.low30 && !(it.price <= it.min + 0.01 && (!it.low30 || it.price <= it.low30 + 0.01))) return false;
  if (s.newOnly && it.first !== today()) return false;
  return sizeOk(it);
}

// prosty losowy z ziarnem: kolejność jest stała przez cały dzień, więc da się wrócić do tego, co się widziało
function rng(seed) { let x = 0; for (const c of seed) x = (x * 31 + c.charCodeAt(0)) | 0; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; }; }

function buildFeed(keepPos) {
  const cur = S.feed[Math.round(S.pos)];
  const r = rng(today() + (S.quickCat || ''));
  const list = S.items.filter((i) => passes(i)).map((i) => ({ i, k: disc(i) + (i.first === today() ? 18 : 0) + r() * 45 }));
  list.sort((a, b) => b.k - a.k);
  S.feed = list.map((x) => x.i);
  // zdrapka: najlepsza okazja dnia na górze stosu, zakryta
  S.scratchId = null;
  if (S.set.scratch && S.feed.length > 3 && S.scratchDay !== today()) {
    const best = S.feed.slice().sort((a, b) => disc(b) - disc(a))[0];
    S.feed = [best, ...S.feed.filter((x) => x !== best)];
    S.scratchId = best.id;
  }
  if (keepPos && cur) { const k = S.feed.indexOf(cur); S.pos = k >= 0 ? k : clamp(Math.round(S.pos), 0, Math.max(0, S.feed.length - 1)); } else S.pos = 0;
  resetCards(); render();
}

// ---------- stos kart ----------
const stack = $('#stack');
const cards = new Map(); // indeks w feed -> element
let cardH = 0; let cardW = 0;
function measure() { cardW = Math.round(window.innerWidth * 0.96); cardH = Math.round(cardW * 0.78); const r = document.documentElement.style; r.setProperty('--card-w', cardW + 'px'); r.setProperty('--card-h', cardH + 'px'); }

function resetCards() { for (const el of cards.values()) el.remove(); cards.clear(); }

function frameNo(i) { return String((i % 36) + 1).padStart(2, '0') + 'A'; }

function makeCard(idx) {
  const it = S.feed[idx];
  const el = document.createElement('div');
  el.className = 'card' + (disc(it) >= 60 ? ' mega' : '');
  el._st = {};
  el.dataset.idx = idx;
  el.innerHTML = `<div class="inner">
    <div class="face front"><img src="${esc(it.img[0])}" loading="eager" decoding="async" referrerpolicy="no-referrer" alt="">
      <i class="grain"></i><i class="shade"></i><i class="burn"></i><span class="frame">${frameNo(idx)} ▸ SZAFA 400</span></div>
    <div class="face back"></div></div>`;
  const img = el.querySelector('img'); img.decoding = 'async'; el._shade = el.querySelector('.shade');
  img.onerror = () => { if (it.img[1] && img.src !== it.img[1]) img.src = it.img[1]; };
  if (it.id === S.scratchId) addScratch(el);
  stack.appendChild(el);
  return el;
}

function render() {
  const n = S.feed.length;
  $('#empty').classList.toggle('hidden', n > 0);
  if (!n) { resetCards(); return; }
  S.pos = clamp(S.pos, -0.35, n - 1 + 0.35);
  const c = Math.round(S.pos);
  const lo = Math.max(0, Math.floor(S.pos) - 3); const hi = Math.min(n - 1, Math.ceil(S.pos) + 3);
  for (const [i, el] of cards) if (i < lo || i > hi) { el.remove(); cards.delete(i); }
  const peek = Math.max(40, (stack.clientHeight - cardH) / 2 / 2.4);
  // na początku i końcu stosu przesuwamy całość, żeby nie było pustego pół ekranu
  const room = (stack.clientHeight - cardH) / 2 - 10;
  const edge = -clamp(room * (1 - S.pos / 2.4), 0, room) + clamp(room * (1 - (n - 1 - S.pos) / 2.4), 0, room);
  for (let i = lo; i <= hi; i++) {
    let el = cards.get(i); if (!el) { el = makeCard(i); cards.set(i, el); }
    const d = i - S.pos; const ad = Math.abs(d); const sg = Math.sign(d);
    const s = 1 - 0.06 * Math.min(ad, 4);
    let y = sg * (cardH / 2 * (1 - s) + peek * Math.min(ad, 4)) + edge;
    let tx = 0; let rot = 0;
    if (i === c && drag.mode === 'h') { tx = drag.dx; rot = drag.dx * 0.04; y += Math.abs(drag.dx) * 0.05; }
    const st = el._st;
    const tf = `translate3d(${tx.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${s.toFixed(4)})`;
    if (st.tf !== tf) { el.style.transform = tf; st.tf = tf; }
    const z = 100 - Math.round(ad * 10); if (st.z !== z) { el.style.zIndex = String(z); st.z = z; }
    const op = ad > 2.8 ? Math.round(clamp(3.6 - ad, 0, 1) * 50) / 50 : 1; if (st.op !== op) { el.style.opacity = String(op); st.op = op; }
    const so = Math.round(Math.min(ad, 3) * 0.16 * 50) / 50; if (st.so !== so) { el._shade.style.opacity = String(so); st.so = so; }
    if (el.classList.contains('center') !== (i === c)) el.classList.toggle('center', i === c);
    if (i !== c && el.classList.contains('flipped')) el.classList.remove('flipped', 'flipping');
  }
  if (c !== render.last) { if (render.last != null) { S.set.film ? SFX.film() : SFX.tick(); } render.last = c; preload(c); checkCenterSoon(); }
}

// jedno przerysowanie na klatkę, nawet gdy palec wysyła więcej zdarzeń
let rq = 0;
function queueRender() { if (!rq) rq = requestAnimationFrame(() => { rq = 0; render(); }); }

// zdjęcia kolejnych kart pobierają się zawczasu, żeby przewijanie nie czekało na sieć
const pre = new Set();
function preload(c) {
  for (let i = c + 1; i <= c + 6 && i < S.feed.length; i++) {
    const u = S.feed[i].img[0]; if (pre.has(u)) continue; pre.add(u);
    const im = new Image(); im.decoding = 'async'; im.referrerPolicy = 'no-referrer'; im.src = u;
    if (im.decode) im.decode().catch(() => {});
  }
  if (pre.size > 400) pre.clear();
}

// ziarno kliszy: raz narysowany mały szum zamiast filtra SVG na każdej karcie
function makeGrain() {
  const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d'); const d = x.createImageData(96, 96);
  for (let i = 0; i < d.data.length; i += 4) { const v = Math.random() * 255 | 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 34; }
  x.putImageData(d, 0, 0); document.documentElement.style.setProperty('--grain', `url(${c.toDataURL()})`);
}

// ---------- gesty na stosie ----------
const drag = { mode: null };
let anim = null;

stack.addEventListener('pointerdown', (e) => {
  if (e.target.classList.contains('scratch')) return;
  cancelAnimationFrame(anim); anim = null;
  ac();
  Object.assign(drag, { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, mode: null, p0: S.pos, t0: performance.now(), v: 0, lt: performance.now(), ly: e.clientY, moved: false, card: e.target.closest('.card') });
  stack.setPointerCapture(e.pointerId);
  clearTimeout(drag.lp);
  drag.lp = setTimeout(() => { if (!drag.moved && drag.mode == null) { drag.mode = 'lp'; flipCenter(); } }, 430);
});
stack.addEventListener('pointerdown', () => document.body.classList.remove('navopen'), { passive: true });
stack.addEventListener('pointermove', (e) => {
  if (e.pointerId !== drag.id || drag.mode === 'lp') return;
  drag.dx = e.clientX - drag.x0; drag.dy = e.clientY - drag.y0;
  if (!drag.mode) {
    if (Math.abs(drag.dx) > 14 && Math.abs(drag.dx) > Math.abs(drag.dy) * 1.2) drag.mode = 'h';
    else if (Math.abs(drag.dy) > 9) drag.mode = 'v';
  }
  if (drag.mode) { drag.moved = true; clearTimeout(drag.lp); }
  if (drag.mode === 'v') {
    const step = cardH * 0.42;
    const now = performance.now(); const dt = Math.max(1, now - drag.lt);
    drag.v = 0.7 * drag.v + 0.3 * (-(e.clientY - drag.ly) / step / dt * 1000);
    drag.lt = now; drag.ly = e.clientY;
    S.pos = drag.p0 - drag.dy / step;
    queueRender();
  } else if (drag.mode === 'h') queueRender();
});
function endDrag(e) {
  if (e.pointerId !== drag.id) return;
  clearTimeout(drag.lp);
  const mode = drag.mode; drag.mode = null; drag.id = null;
  if (mode === 'lp') return;
  if (mode === 'v') { coast(drag.v); return; }
  if (mode === 'h') {
    const c = Math.round(S.pos);
    if (drag.dx > 100) { toWardrobe(c); return; }
    if (drag.dx < -100) { toTrash(c); return; }
    springBack(drag.dx); return;
  }
  // dotknięcie
  if (performance.now() - drag.t0 < 400) {
    const el = drag.card; if (!el) return;
    const i = Number(el.dataset.idx); const c = Math.round(S.pos);
    if (i !== c) { snapTo(i); return; }
    if (el.classList.contains('flipped')) { el.classList.remove('flipped'); setTimeout(() => el.classList.remove('flipping'), 600); SFX.flip(); return; }
    if (el.querySelector('canvas.scratch')) return;
    openDetail(S.feed[i]);
  }
}
stack.addEventListener('pointerup', endDrag);
stack.addEventListener('pointercancel', endDrag);

function coast(v) {
  let pos = S.pos; let vel = clamp(v, -14, 14); let last = performance.now();
  const n = S.feed.length;
  const target = clamp(Math.round(pos + vel * 0.22), 0, n - 1);
  const from = pos; const t0 = last; const dur = clamp(260 + Math.abs(target - from) * 70, 260, 900);
  const step = (now) => {
    const k = clamp((now - t0) / dur, 0, 1); const e = 1 - Math.pow(1 - k, 3);
    S.pos = from + (target - from) * e; render();
    if (k < 1) anim = requestAnimationFrame(step); else anim = null;
  };
  anim = requestAnimationFrame(step);
}
function snapTo(i) { const from = S.pos; const t0 = performance.now(); const dur = 320; const step = (now) => { const k = clamp((now - t0) / dur, 0, 1); S.pos = from + (i - from) * (1 - Math.pow(1 - k, 3)); render(); if (k < 1) anim = requestAnimationFrame(step); }; anim = requestAnimationFrame(step); }
function springBack(dx) { const t0 = performance.now(); const step = (now) => { const k = clamp((now - t0) / 280, 0, 1); drag.dx = dx * (1 - (1 - Math.pow(1 - k, 3))); drag.mode = k < 1 ? 'h' : null; render(); if (k < 1) anim = requestAnimationFrame(step); }; anim = requestAnimationFrame(step); }

function flipCenter() {
  const c = Math.round(S.pos); const el = cards.get(c); if (!el || el.querySelector('canvas.scratch')) return;
  const it = S.feed[c];
  const back = el.querySelector('.back');
  if (!back.dataset.done) {
    back.innerHTML = `<div class="meta mono"><span>${esc(CAT_NAME[it.cat] || '')}</span><span>${it.first === today() ? 'NOWOŚĆ DZIŚ' : 'OD ' + esc(it.first)}</span></div>
      <div class="left"><div class="brand">${esc(it.brand).toUpperCase()}=]</div><div class="name">${esc(it.name)}</div>
      <canvas width="160" height="50"></canvas><div class="mono">${lowLine(it)}</div></div>
      <div class="prices"><span class="badge">-${disc(it)}%</span><span class="was">${zl(it.old)} zł</span><span class="now">${zl(it.price)} zł</span></div>`;
    back.dataset.done = 1;
    drawChart(back.querySelector('canvas'), it);
  }
  el.classList.add('flipping'); requestAnimationFrame(() => el.classList.add('flipped')); SFX.flip(); buzz(15);
}

function lowLine(it) {
  if (it.price <= it.min + 0.01) return '▼ najniższa cena, odkąd robot ją śledzi';
  return `najniżej było ${zl(it.min)} zł`;
}

// pikselowy wykres historii ceny
function drawChart(cv, it) {
  const ctx = cv.getContext('2d'); const W = cv.width; const H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const h = (it.hist && it.hist.length ? it.hist : [[it.first, it.price]]).slice();
  const pts = [[null, it.old], ...h];
  const vals = pts.map((p) => p[1]); const mx = Math.max(...vals) * 1.05; const mn = Math.min(...vals) * 0.85;
  ctx.fillStyle = '#141414';
  const n = pts.length; const colW = Math.max(2, Math.floor(W / Math.max(n, 2)));
  for (let i = 0; i < W; i += 4) ctx.fillRect(i, H - 1, 2, 1);
  let prevY = null;
  for (let i = 0; i < n; i++) {
    const y = Math.round(H - 4 - (pts[i][1] - mn) / (mx - mn || 1) * (H - 10));
    const x0 = Math.round(i * (W / n)); const x1 = Math.round((i + 1) * (W / n));
    ctx.fillStyle = i === n - 1 ? '#F28C28' : '#141414';
    ctx.fillRect(x0, y, x1 - x0, 3);
    if (prevY != null) { ctx.fillStyle = '#141414'; ctx.fillRect(x0, Math.min(prevY, y), 2, Math.abs(prevY - y) + 3); }
    prevY = y;
  }
}

// ---------- zdrapka ----------
function addScratch(el) {
  const cv = document.createElement('canvas'); cv.className = 'scratch';
  el.querySelector('.front').appendChild(cv);
  (document.fonts ? document.fonts.load('20px Pix').catch(() => {}) : Promise.resolve()).then(() => {
    const r = cv.getBoundingClientRect(); const w = Math.max(10, Math.round(cardW)); const h = Math.max(10, Math.round(cardH));
    cv.width = Math.round(w / 2); cv.height = Math.round(h / 2);
    const x = cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, cv.width, cv.height); g.addColorStop(0, '#b9b6ae'); g.addColorStop(0.5, '#e7e4dc'); g.addColorStop(1, '#a7a399');
    x.fillStyle = g; x.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < 1400; i++) { x.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.12)'; x.fillRect(Math.random() * cv.width, Math.random() * cv.height, 1, 1); }
    x.fillStyle = '#141414'; x.textAlign = 'center'; x.font = `${Math.round(cv.width / 7)}px Pix`;
    x.fillText('OKAZJA', cv.width / 2, cv.height * 0.44); x.fillText('DNIA', cv.width / 2, cv.height * 0.44 + cv.width / 6.5);
    x.font = `${Math.round(cv.width / 18)}px monospace`; x.fillText('ZDRAP PALCEM', cv.width / 2, cv.height * 0.72);
    x.fillText('albo przewiń obok karty', cv.width / 2, cv.height * 0.72 + cv.width / 14);
    void r;
  });
  let down = false; let n = 0;
  const scr = (e) => {
    const r = cv.getBoundingClientRect(); const x = cv.getContext('2d');
    const px = (e.clientX - r.left) / r.width * cv.width; const py = (e.clientY - r.top) / r.height * cv.height;
    x.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 3; k++) x.fillRect(Math.round(px - 10 + (Math.random() * 6 - 3)), Math.round(py - 10 + (Math.random() * 6 - 3)), 20, 20);
    if (++n % 3 === 0) SFX.scratch();
    if (n % 12 === 0) {
      const d = x.getImageData(0, 0, cv.width, cv.height).data; let clear = 0;
      for (let i = 3; i < d.length; i += 16) if (d[i] === 0) clear++;
      if (clear / (d.length / 16) > 0.42) reveal();
    }
  };
  const reveal = () => {
    if (cv.dataset.gone) return; cv.dataset.gone = 1;
    cv.style.transition = 'opacity .5s'; cv.style.opacity = '0'; setTimeout(() => cv.remove(), 520);
    S.scratchDay = today(); save('scratchDay', S.scratchDay); S.scratchId = null;
    SFX.win(); buzz([20, 40, 20]); confetti(); toast('-' + disc(S.feed[Number(el.dataset.idx)]) + '%  OKAZJA DNIA');
  };
  cv.addEventListener('pointerdown', (e) => { e.stopPropagation(); down = true; cv.setPointerCapture(e.pointerId); scr(e); });
  cv.addEventListener('pointermove', (e) => { if (down) { e.stopPropagation(); scr(e); } });
  cv.addEventListener('pointerup', () => { down = false; });
}

// ---------- efekty na płótnie ----------
const fx = $('#fx'); const fxc = fx.getContext('2d');
let fxN = 0; const fxOn = () => { fxN++; fx.classList.add('on'); }; const fxOff = () => { if (--fxN <= 0) { fxN = 0; fx.classList.remove('on'); } };
function fitFx() { fx.width = window.innerWidth; fx.height = window.innerHeight; }

function confetti() {
  const parts = Array.from({ length: 90 }, () => ({ x: fx.width / 2, y: fx.height * 0.45, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4, c: Math.random() > 0.5 ? '#F28C28' : '#141414', s: 4 + Math.random() * 5 | 0 }));
  const t0 = performance.now(); fxOn();
  const step = (now) => {
    fxc.clearRect(0, 0, fx.width, fx.height);
    for (const p of parts) { p.vy += 0.5; p.x += p.vx; p.y += p.vy; fxc.fillStyle = p.c; fxc.fillRect(p.x | 0, p.y | 0, p.s, p.s); }
    if (now - t0 < 1800) requestAnimationFrame(step); else { fxc.clearRect(0, 0, fx.width, fx.height); fxOff(); }
  };
  requestAnimationFrame(step);
}

// zgniecenie karty w pikselową kulkę
function crumple(el, done) {
  const img = el.querySelector('.front img'); const r = el.getBoundingClientRect();
  el.style.visibility = 'hidden'; fxOn();
  const off = document.createElement('canvas'); const ox = off.getContext('2d');
  const t0 = performance.now(); const D = 820;
  let vy = 0; let by = 0;
  const step = (now) => {
    const k = clamp((now - t0) / D, 0, 1);
    fxc.clearRect(0, 0, fx.width, fx.height);
    const sk = Math.min(1, k / 0.6); const e = 1 - Math.pow(1 - sk, 2);
    const w = r.width * (1 - e) + 44 * e; const h = r.height * (1 - e) + 44 * e;
    const res = Math.max(4, Math.round(48 * (1 - e) + 5 * e));
    off.width = res; off.height = Math.round(res * h / w) || res;
    try { ox.drawImage(img, 0, 0, off.width, off.height); } catch (err) { ox.fillStyle = '#ccc'; ox.fillRect(0, 0, off.width, off.height); }
    if (k > 0.6) { vy += 1.6; by += vy; }
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2 + by;
    fxc.save(); fxc.translate(cx, cy); fxc.rotate(e * 2.6);
    fxc.imageSmoothingEnabled = false;
    if (e > 0.5) { fxc.beginPath(); fxc.arc(0, 0, Math.max(w, h) / 2, 0, Math.PI * 2); fxc.clip(); }
    fxc.drawImage(off, -w / 2, -h / 2, w, h);
    fxc.restore();
    if (k < 1 && cy < fx.height + 60) requestAnimationFrame(step); else { fxc.clearRect(0, 0, fx.width, fx.height); fxOff(); done(); }
  };
  requestAnimationFrame(step);
}

// ---------- szafa i kosz ----------
function toWardrobe(c) {
  const it = S.feed[c]; const el = cards.get(c);
  S.saved[it.id] = { item: it, at: Date.now(), price: it.price }; save('saved', S.saved); syncWatch();
  SFX.whoosh(); setTimeout(SFX.drawer, 260); buzz(25);
  const nav = $('#menuBtn').getBoundingClientRect();
  el.style.transition = 'transform .5s cubic-bezier(.5,0,.8,.4), opacity .5s';
  const r = el.getBoundingClientRect();
  el.style.transform = `translate3d(${nav.left + nav.width / 2 - (r.left + r.width / 2)}px, ${nav.top - (r.top + r.height / 2)}px, 0) scale(.08) rotate(25deg)`;
  el.style.opacity = '0.2';
  $('#menuBtn').animate([{ transform: 'scale(1)', opacity: .28 }, { transform: 'scale(1.6)', opacity: 1 }, { transform: 'scale(1)', opacity: .28 }], { duration: 400, delay: 450 });
  setTimeout(() => removeFromFeed(c), 480);
}

function toTrash(c) {
  const it = S.feed[c]; const el = cards.get(c);
  S.trash.add(it.id); save('trash', [...S.trash].slice(-3000));
  SFX.crumple(); buzz([10, 30, 10, 30, 10]);
  drag.dx = 0; crumple(el, () => {}); setTimeout(() => removeFromFeed(c), 120);
}

function removeFromFeed(c) {
  S.feed.splice(c, 1); resetCards();
  S.pos = clamp(c, 0, Math.max(0, S.feed.length - 1)); render.last = Math.round(S.pos); render();
}

// ---------- widok produktu (plakat) ----------
function glyph(seed) { const r = rng(seed); let h = ''; for (let i = 0; i < 25; i++) h += `<i class="${r() > 0.45 ? '' : 'o'}"></i>`; return `<div class="glyph">${h}</div>`; }

function openDetail(it, opts = {}) {
  const L = $('#detail'); const sv = !!S.saved[it.id];
  const live = S.byId.get(it.id) || it; const gone = !S.byId.has(it.id);
  const dots = Array.from({ length: 6 }, (_, i) => `<b style="height:${[26, 26, 8, 8, 8, 14][i]}px"></b>`).join('');
  L.innerHTML = `<button class="close" data-x>✕</button>
    <div class="poster"><div class="side">${glyph(it.id)}<div class="dots">${dots}</div>${glyph(it.id + 'x')}</div>
    <div><div class="photos">${it.img.map((u) => `<img src="${esc(u)}" referrerpolicy="no-referrer" alt="">`).join('')}</div>
      <div class="bname"><span>${esc(it.brand).toUpperCase()}=</span><span class="br">]</span></div>
      <div class="sub">${esc(it.name)}</div>
      <div class="pr"><span class="now">${zl(live.price)} zł</span><span class="was">${zl(live.old)} zł</span><span class="dbadge">-${disc(live)}%</span></div>
      <canvas width="200" height="70"></canvas>
      <div class="desc">${esc(CAT_NAME[it.cat] || '')} · ${esc(it.color || '')} · ${esc(it.brand)}. ${gone ? 'Promocja chyba się skończyła albo rzecz zniknęła ze sklepu. ' : ''}W promocji od ${esc(it.first)}. ${lowLine(live)}.${live.low30 ? ' Najniższa cena z 30 dni wg sklepu: ' + zl(live.low30) + ' zł.' : ''}${sv && S.saved[it.id].price !== live.price ? ' Gdy wkładałeś do szafy: ' + zl(S.saved[it.id].price) + ' zł.' : ''}</div>
      <div class="chips" id="dsizes">${(it.sizes || []).map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>
    </div></div>
    <div class="actions"><button class="btn" data-w>${sv ? 'Wyjmij z szafy' : 'Do szafy'}</button><button class="btn dark" data-shop>Do sklepu ↗</button></div>`;
  drawChart(L.querySelector('canvas'), live);
  L.classList.add('on');
  liveSizes(it).then((sz) => {
    const box = L.querySelector('#dsizes'); if (!box || sz == null) return;
    if (!sz.length) {
      box.innerHTML = '<span class="chip on">WYPRZEDANE</span>'; markSold(it);
      const k = S.feed.indexOf(it); if (k >= 0) { S.feed.splice(k, 1); resetCards(); render(); }
      return;
    }
    box.innerHTML = sz.map((s) => `<span class="chip on">${esc(s)}</span>`).join('');
  });
  if (opts.drop) L.animate([{ transform: 'translateY(-110vh) rotate(-6deg)' }, { transform: 'translateY(4vh) rotate(1deg)' }, { transform: 'translateY(0)' }], { duration: 650, easing: 'cubic-bezier(.3,.9,.3,1)' });
  L.querySelector('[data-x]').onclick = () => L.classList.remove('on');
  L.querySelector('[data-shop]').onclick = () => openUrl(it.url);
  L.querySelector('[data-w]').onclick = (e) => {
    if (S.saved[it.id]) { delete S.saved[it.id]; e.target.textContent = 'Do szafy'; toast('Wyjęte z szafy'); }
    else { S.saved[it.id] = { item: live, at: Date.now(), price: live.price }; e.target.textContent = 'Wyjmij z szafy'; SFX.drawer(); toast('W szafie, dam znać, gdy stanieje'); askNotify(); }
    save('saved', S.saved); syncWatch();
    if ($('#wardrobe').classList.contains('active')) renderWardrobe(false);
  };
}

// ---------- dostępność na żywo (strona produktu sklepu) ----------
const LPP = ['reserved', 'cropp', 'house', 'mohito', 'sinsay'];
const live = {}; // id -> {t, sizes} (null = nie wiadomo)
async function liveSizes(it) {
  if (!LPP.includes(it.shop) || !native()) return null;
  const c = live[it.id]; if (c && Date.now() - c.t < 20 * 60000) return c.sizes;
  try {
    const r = await fetch(it.url, { cache: 'no-store' });
    if (r.status === 404) { live[it.id] = { t: Date.now(), sizes: [] }; return []; }
    const h = await r.text(); const sku = it.id.split(':')[1];
    const rx = /"isInStock":(true|false),"isStockInTransit":(?:true|false),"magentoId":\d+,"mappedAs":\[[^\]]*\],"sizeId":\d+,"sizeName":"([^"]+)","sku":"([^"]+)"/g;
    const got = {}; let m;
    while ((m = rx.exec(h))) if (m[3].startsWith(sku + '-')) got[m[2]] = got[m[2]] || m[1] === 'true';
    if (!Object.keys(got).length) return null;
    const sizes = Object.keys(got).filter((k) => got[k]);
    live[it.id] = { t: Date.now(), sizes };
    return sizes;
  } catch (e) { return null; }
}
function markSold(it) { S.sold[it.id] = today(); const keep = {}; const lim = Date.now() - 20 * 864e5; for (const [k, v] of Object.entries(S.sold)) if (new Date(v).getTime() > lim) keep[k] = v; S.sold = keep; save('sold', S.sold); }

// środkowa karta sprawdza się sama, gdy się na niej zatrzymasz; wyprzedana znika
let liveTimer = 0;
function checkCenterSoon() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(async () => {
    const c = Math.round(S.pos); const it = S.feed[c]; if (!it) return;
    const sz = await liveSizes(it);
    if (sz && !sz.length && S.feed[Math.round(S.pos)] === it && !drag.mode) {
      markSold(it); const el = cards.get(c);
      if (el) el.animate([{ opacity: 1, filter: 'grayscale(0)' }, { opacity: 0, filter: 'grayscale(1)' }], { duration: 500 }).onfinish = () => removeFromFeed(S.feed.indexOf(it));
      toast('Wyprzedane, wyrzucam');
    } else if (sz && sz.length) it.sizes = sz;
  }, 700);
}

function openUrl(u) { if (native()) window.location.href = u; else window.open(u, '_blank', 'noopener'); }

// ---------- potrząśnięcie i telefon ekranem w dół ----------
let shakeHits = []; let faceDownAt = 0; let armed = false;
window.addEventListener('devicemotion', (e) => {
  const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
  const m = Math.hypot(a.x, a.y, a.z); const now = Date.now();
  if (S.set.shake && Math.abs(m - 9.81) > 14) {
    shakeHits = shakeHits.filter((t) => now - t < 700); shakeHits.push(now);
    if (shakeHits.length >= 3 && now - (window.lastShake || 0) > 2500) { window.lastShake = now; shakeHits = []; onShake(); }
  }
  if (S.set.facedown) {
    if (a.z < -8.3 && Math.abs(a.x) < 3 && Math.abs(a.y) < 3) { if (!faceDownAt) faceDownAt = now; if (!armed && now - faceDownAt > 1300) { armed = true; buzz(60); } }
    else { faceDownAt = 0; if (armed && a.z > 3) { armed = false; showOutfit(); } }
  }
});

function onShake() {
  if (!$('#feed').classList.contains('active') || S.feed.length < 2 || $('.layer.on')) return;
  SFX.whoosh(); buzz([30, 30, 60]);
  for (const el of cards.values()) {
    const r = (Math.random() - 0.5) * 70;
    el.classList.add('dropping');
    el.style.transform += ` translate3d(${(Math.random() - 0.5) * 160}px, ${window.innerHeight * 1.3}px, 0) rotate(${r}deg)`;
    el.style.opacity = '0.6';
  }
  setTimeout(() => {
    const i = Math.floor(Math.random() * S.feed.length);
    resetCards(); S.pos = i; render.last = i; render();
    const el = cards.get(i);
    if (el) el.animate([{ transform: `translate3d(0, ${-window.innerHeight}px, 0) rotate(-12deg)` }, { transform: el.style.transform }], { duration: 600, easing: 'cubic-bezier(.3,1.3,.5,1)' });
    tone(900, 300, 0.25, { gain: 0.12, type: 'triangle' });
    setTimeout(() => { buzz(30); openDetail(S.feed[i], { drop: true }); }, 700);
  }, 820);
}

const TOPS = ['koszulki', 'bluzy', 'koszule', 'swetry', 'kurtki'];
const BOTS = ['spodnie', 'szorty', 'spodnice'];
function showOutfit() {
  if ($('#detail').classList.contains('on')) return;
  const pool = S.items.filter((i) => passes(i, true));
  const pick = (cats) => { const p = pool.filter((i) => cats.includes(i.cat)); return p.length ? p[Math.floor(Math.random() * p.length)] : null; };
  const set = [pick(TOPS), pick(BOTS), pick(['buty'])].filter(Boolean);
  if (set.length < 2) { toast('Za mało rzeczy na zestaw'); return; }
  const sum = set.reduce((a, i) => a + i.price, 0); const old = set.reduce((a, i) => a + i.old, 0);
  const L = $('#outfit');
  L.innerHTML = `<button class="close" data-x>✕</button><div class="ofit"><h2>ZESTAW=]</h2>
    ${set.map((i) => `<div class="tile" data-id="${esc(i.id)}"><img src="${esc(i.img[0])}" referrerpolicy="no-referrer"></div>`).join('')}
    <div class="mono" style="grid-column:span 2">razem ${zl(sum)} zł zamiast ${zl(old)} zł · odwróć telefon jeszcze raz, żeby wylosować inny</div></div>
    <div class="actions"><button class="btn" data-again>Inny</button><button class="btn or" data-all>Wszystko do szafy</button></div>`;
  L.classList.add('on'); SFX.win(); buzz([20, 50, 20]);
  L.querySelector('[data-x]').onclick = () => L.classList.remove('on');
  L.querySelector('[data-again]').onclick = () => { L.classList.remove('on'); setTimeout(showOutfit, 50); };
  L.querySelector('[data-all]').onclick = () => { set.forEach((i) => { S.saved[i.id] = { item: i, at: Date.now(), price: i.price }; }); save('saved', S.saved); syncWatch(); SFX.drawer(); toast('Cały zestaw w szafie'); };
  $$('.tile', L).forEach((t) => { t.onclick = () => { const it = S.byId.get(t.dataset.id); if (it) openDetail(it); }; });
}

// ---------- szafa ----------
function renderWardrobe(withDoors) {
  const list = Object.values(S.saved).sort((a, b) => b.at - a.at);
  $('#wardCount').textContent = list.length ? list.length + ' rzeczy' : '';
  const G = $('#wardGrid');
  G.innerHTML = list.length ? list.map(({ item, price }) => {
    const live = S.byId.get(item.id); const drop = live && live.price < price - 0.01;
    return `<div class="tile" data-id="${esc(item.id)}"><img src="${esc(item.img[0])}" referrerpolicy="no-referrer" loading="lazy">
      ${drop ? `<span class="drop">-${zl(price - live.price)} zł</span>` : ''}${S.items.length && !live ? '<span class="gone">KONIEC</span>' : ''}</div>`;
  }).join('') : '<p class="mono" style="grid-column:span 2;text-align:center;margin-top:30vh">pusto · przesuń kartę w prawo, żeby coś tu włożyć</p>';
  $$('.tile', G).forEach((t) => { t.onclick = () => { const s = S.saved[t.dataset.id]; if (s) openDetail(S.byId.get(s.item.id) || s.item); }; });
  if (!withDoors) return;
  const D = $('#doors'); D.className = ''; void D.offsetWidth;
  const full = list.length > 30;
  D.className = full ? 'open stuck' : 'open';
  noise(0.4, { freq: 300, q: 0.6, gain: 0.25 });
  if (full) {
    [0, 0.18, 0.36].forEach((t) => tone(90, 60, 0.08, { gain: 0.4, at: t }));
    setTimeout(() => {
      const it = list[Math.floor(Math.random() * list.length)].item;
      const f = document.createElement('div'); f.className = 'fallout'; f.innerHTML = `<img src="${esc(it.img[0])}" referrerpolicy="no-referrer">`;
      document.body.appendChild(f); SFX.whoosh(); buzz(40);
      f.animate([{ transform: 'translateY(-10vh) rotate(0)' }, { transform: `translateY(110vh) rotate(${Math.random() > 0.5 ? '' : '-'}50deg)` }], { duration: 1100, easing: 'cubic-bezier(.5,0,.9,.5)' }).onfinish = () => f.remove();
      setTimeout(() => toast('Szafa się nie domyka…'), 300);
    }, 700);
  }
  setTimeout(() => { D.className = ''; }, full ? 1600 : 1200);
}

// ---------- nawigacja ----------
function go(name) {
  document.body.classList.toggle('onfeed', name === 'feed'); document.body.classList.remove('navopen');
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === name));
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.go === name));
  if (name === 'wardrobe') renderWardrobe(true);
  if (name === 'settings') renderSettings();
  if (name === 'feed') { measure(); render(); }
}
$$('#nav button').forEach((b) => { b.onclick = () => { ac(); SFX.tick(); go(b.dataset.go); }; });

// ---------- kategorie (pasy z falami) ----------
function wave(top, flip) {
  const pts = []; const N = 24;
  for (let i = 0; i <= N; i++) { const x = (i / N) * 100; const y = (flip ? 100 - top : top) + Math.sin((i / N) * Math.PI * 2 + (flip ? Math.PI : 0)) * (top * 0.9); pts.push(`${x}% ${y}%`); }
  return pts;
}
function openCats() {
  const L = $('#cats');
  const pool = S.items.filter((i) => passes(i, true));
  const secs = [['', 'Wszystko', pool.length + ' rzeczy']].concat(CATS.filter((c) => S.set.cats.includes(c[0])).map((c) => [c[0], c[1], c[2]]));
  L.innerHTML = '<button class="close" data-x>✕</button>' + secs.map(([k, name, sub], n) => {
    const p = k ? pool.filter((i) => i.cat === k) : pool; if (k && !p.length) return '';
    const img = p.length ? p[Math.floor(rng(k + today())() * p.length)].img[0] : '';
    const top = n === 0 ? ['0% 0%', '100% 0%'] : wave(12, false);
    const bot = ['100% 100%', '0% 100%'];
    const clip = `polygon(${top.join(',')},${bot.join(',')})`;
    return `<div class="wsec ${(S.quickCat || '') === k ? 'on' : ''}" data-k="${k}" style="clip-path:${clip};-webkit-clip-path:${clip}">
      ${img ? `<img src="${esc(img)}" referrerpolicy="no-referrer" loading="lazy">` : ''}<div class="t"><b>${name}</b><span>${k ? p.length + ' · ' + sub : sub}</span></div></div>`;
  }).join('') + '<div style="height:12vh"></div>';
  L.classList.add('on');
  L.querySelector('[data-x]').onclick = () => L.classList.remove('on');
  $$('.wsec', L).forEach((s) => { s.onclick = () => { S.quickCat = s.dataset.k || null; L.classList.remove('on'); SFX.film(); buildFeed(false); }; });
}
$('#catBtn').onclick = () => { ac(); openCats(); };

// ---------- ustawienia ----------
function chipRow(key, opts, multi = true) {
  const cur = S.set[key];
  return `<div class="chips" data-key="${key}">${opts.map(([v, n]) => `<button class="chip ${cur.includes(v) ? 'on' : ''}" data-v="${v}">${n}</button>`).join('')}</div>`;
}
function sizeRow(g) { const cur = S.set.sizes[g]; return `<div class="chips" data-size="${g}">${SIZES[g].map((v) => `<button class="chip ${cur.includes(v) ? 'on' : ''}" data-v="${v}">${v}</button>`).join('')}</div>`; }
function toggleRow(key, name, desc) { return `<div class="sgrp"><h3>${name}</h3><p class="mono">${desc}</p><div class="chips"><button class="chip or ${S.set[key] ? 'on' : ''}" data-t="${key}">${S.set[key] ? 'włączone' : 'wyłączone'}</button></div></div>`; }

function renderSettings() {
  const st = S.status || {};
  const B = $('#setBody');
  B.innerHTML = `
  <div class="sgrp"><h3>Dla kogo</h3>${chipRow('sex', [['m', 'On'], ['k', 'Ona'], ['u', 'Unisex'], ['d', 'Dzieci']])}</div>
  <div class="sgrp"><h3>Kategorie</h3>${chipRow('cats', CATS.map((c) => [c[0], c[1]]))}</div>
  <div class="sgrp"><h3>Sklepy</h3>${chipRow('shops', SHOPS.map(([k, n]) => [k, n + (typeof st[k] === 'number' ? ' · ' + st[k] : '')]))}</div>
  <div class="sgrp"><h3>Rozmiary</h3><p class="mono">nic nie zaznaczone = wszystkie</p>
    <p class="mono">góra</p>${sizeRow('top')}<p class="mono">dół</p>${sizeRow('bottom')}<p class="mono">buty</p>${sizeRow('shoes')}</div>
  <div class="sgrp"><h3>Minimalna zniżka</h3><span class="val" id="mdv">-${S.set.minDisc}%</span><input type="range" min="0" max="80" step="5" value="${S.set.minDisc}" id="md"></div>
  <div class="sgrp"><h3>Maksymalna cena</h3><p class="mono">0 = bez limitu</p><input type="number" min="0" step="10" value="${S.set.maxPrice || 0}" id="mp"> zł</div>
  ${toggleRow('low30', 'Tylko prawdziwe okazje', 'cena najniższa, odkąd robot ją śledzi, i nie wyższa niż najniższa z 30 dni wg sklepu')}
  ${toggleRow('newOnly', 'Tylko dzisiejsze nowości', 'rzeczy, które weszły w promocję dziś')}
  ${toggleRow('film', 'Tryb klisza', 'karty jak stara taśma filmowa')}
  ${toggleRow('scratch', 'Zdrapka dnia', 'najlepsza okazja dnia zakryta na górze stosu')}
  ${toggleRow('shake', 'Potrząśnij', 'karty spadają, wpada jedna losowa')}
  ${toggleRow('facedown', 'Odwróć telefon', 'ekranem w dół na chwilę i z powrotem = losowy zestaw')}
  ${toggleRow('sound', 'Dźwięki', '')}
  ${toggleRow('haptic', 'Wibracje', '')}
  <div class="sgrp"><h3>Kosz</h3><p class="mono">${S.trash.size} wyrzuconych rzeczy nie pokazuje się w stosie</p><div class="chips"><button class="chip" id="untrash">opróżnij kosz</button></div></div>
  <div class="sgrp"><h3>Aplikacja</h3><p class="mono" id="ver">promocje z ${esc(S.updated.replace('T', ' ').replace('Z', ' UTC'))} · ${S.items.length} rzeczy</p>
    <div class="chips"><button class="chip" id="refresh">odśwież promocje</button><button class="chip" id="upd">sprawdź aktualizację</button></div></div>`;
  fetch('build.json').then((r) => r.json()).then((b) => { $('#ver').textContent += ' · wersja ' + b.build; }).catch(() => {});
  $$('[data-key]', B).forEach((row) => row.onclick = (e) => {
    const b = e.target.closest('.chip'); if (!b) return; const k = row.dataset.key; const v = b.dataset.v;
    const arr = S.set[k]; const i = arr.indexOf(v); if (i >= 0) { if (arr.length > 1) arr.splice(i, 1); else return toast('Coś musi zostać'); } else arr.push(v);
    b.classList.toggle('on'); changed();
  });
  $$('[data-size]', B).forEach((row) => row.onclick = (e) => {
    const b = e.target.closest('.chip'); if (!b) return; const arr = S.set.sizes[row.dataset.size]; const v = b.dataset.v;
    const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); b.classList.toggle('on'); changed();
  });
  $$('[data-t]', B).forEach((b) => b.onclick = () => { const k = b.dataset.t; S.set[k] = !S.set[k]; b.classList.toggle('on'); b.textContent = S.set[k] ? 'włączone' : 'wyłączone'; if (k === 'film') document.body.classList.toggle('film', S.set.film); changed(); });
  $('#md').oninput = (e) => { S.set.minDisc = Number(e.target.value); $('#mdv').textContent = '-' + S.set.minDisc + '%'; };
  $('#md').onchange = changed;
  $('#mp').onchange = (e) => { S.set.maxPrice = Math.max(0, Number(e.target.value) || 0); changed(); };
  $('#untrash').onclick = () => { S.trash.clear(); save('trash', []); changed(); renderSettings(); toast('Kosz pusty'); };
  $('#refresh').onclick = () => { toast('Pobieram…'); loadData(); };
  $('#upd').onclick = () => checkUpdate(true);
}
function changed() { save('set', S.set); buildFeed(false); }

// ---------- powiadomienia o spadkach ceny ----------
function syncWatch() {
  const W = plugin('Watch'); if (!W) return;
  const items = Object.values(S.saved).map(({ item, price }) => ({ id: item.id, price: (S.byId.get(item.id) || {}).price || price, title: item.name, brand: item.brand }));
  W.set({ items, url: PRICES_URL }).catch(() => {});
}
function askNotify() { if (askNotify.done) return; askNotify.done = true; const W = plugin('Watch'); if (W) W.askNotify().catch(() => {}); }

// ---------- aktualizacje apki ----------
async function checkUpdate(manual) {
  try {
    const mine = await fetch('build.json').then((r) => r.json()).catch(() => ({ build: 0 }));
    const rel = await fetch(RELEASE_API, { cache: 'no-store' }).then((r) => r.json());
    const m = /build:\s*(\d+)/.exec(rel.body || ''); const build = m ? Number(m[1]) : 0;
    const apk = (rel.assets || []).find((a) => a.name === 'szafa.apk');
    if (!apk || build <= Number(mine.build || 0)) { if (manual) toast('Masz najnowszą wersję'); return; }
    if (!manual) { $('#nav [data-go=settings] .circ').style.boxShadow = '0 0 0 3px #F28C28'; return; }
    const up = plugin('Updater');
    if (!up) { openUrl(apk.browser_download_url); return; }
    let can = true; try { can = (await up.canInstall()).allowed !== false; } catch (e) { /* dalej */ }
    if (!can) { toast('Pozwól apce instalować aktualizacje i kliknij jeszcze raz', 3500); up.openInstallSettings().catch(() => {}); return; }
    toast('Pobieram wersję ' + build + '…', 5000);
    await up.downloadAndInstall({ url: apk.browser_download_url, size: apk.size || 0 });
  } catch (e) { if (manual) toast('Nie udało się sprawdzić aktualizacji'); }
}

// ---------- ozdobnik w rogu ----------


// ---------- start ----------
window.addEventListener('resize', () => { measure(); fitFx(); render(); });
document.addEventListener('backbutton', (e) => e.preventDefault());
if (window.Capacitor && plugin('App')) plugin('App').addListener('backButton', () => {
  const L = $('.layer.on'); if (L) { L.classList.remove('on'); return; }
  if (!$('#feed').classList.contains('active')) { go('feed'); return; }
  plugin('App').exitApp();
});
document.body.classList.toggle('film', S.set.film);
measure(); fitFx(); makeGrain(); document.body.classList.add('onfeed');
$('#menuBtn').onclick = () => { ac(); SFX.tick(); document.body.classList.toggle('navopen'); };
loadData();
setTimeout(() => checkUpdate(false), 4000);
if (S.launches <= 3) {
  const h = $('#hint'); h.innerHTML = '↕ przewijaj · → do szafy · ← kosz<br>przytrzymaj = cena · potrząśnij = los';
  h.classList.remove('hidden'); setTimeout(() => h.classList.add('hidden'), 7000);
}
try { if (plugin('Updater')) plugin('Updater').webReady().catch(() => {}); } catch (e) { /* stara wtyczka */ }
