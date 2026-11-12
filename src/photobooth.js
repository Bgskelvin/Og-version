/* =====================================================================
   photobooth.js — Photo page (4 photos + countdown) & Edit photo page
   The page markup is in index.html (#photo and #editphoto).
   Uses shared data & functions that are still globals: $, show, sleep, busy,
   resetIdle, noCam, activeCouple, setNotice, setThanks, needStream (see
   state.js, app.js). Only setupPhotobooth() is exported.
   Photos are taken in grabFrame() (webcam/HDMI) or captureSony() (Sony camera).
   Data sent to the main process (savePhotos: singles → `satuan`, `tamu`, meta
   values) keeps its current names until refactor/main-english.
   ===================================================================== */
import { prepareTemplate, drawTemplate } from './template-render.js';
import { applyLut, loadLut } from './lut.js';
import { showDownloadQr } from './download-qr.js';
import { usingSony } from './sony-camera.js';
import { setThanks, needStream } from './recording.js';
import { $, sleep, state } from './state.js';
import { t, todayDate } from './language.js';
import { resetIdle, setNotice, show } from './app.js';
const SHOTS = 4; // photos per session
// Countdown length, preview and flash effect are set in Photo booth settings (cfg)
const COUNTDOWN = () => state.cfg.photoCountdown;
const PREVIEW_MS = () => state.cfg.photoPreview * 1000;

/* ---------------- State ---------------- */
const photos = new Array(SHOTS).fill(null); // full-resolution canvas of each photo
let running = false,
  photoToken = 0,
  cancelArmed = null;
const newEditState = () => ({
  layout: 'grid',
  filter: 'none',
  frame: 0,
  showText: true,
  stickers: [],
  strokes: [],
  sel: null,
  tab: 'layout',
  color: '#FFFFFF',
  size: 10,
});
let editor = newEditState();

/* ---------------- Taking photos ----------------
   Webcam/HDMI: one frame from the connected camera at its native resolution.
   Saved without mirroring, so text on clothes or the background isn't reversed. */
function grabFrame() {
  const v = $('cam');
  const w = v.videoWidth,
    h = v.videoHeight;
  if (!w || !h) throw new Error('Gambar kamera belum siap');
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(v, 0, 0, w, h);
  return c;
}
// Sony camera: the shot is taken in the camera, the full-resolution photo arrives over USB.
// For editing it's scaled down (longest side 3000 px); the original file is saved untouched.
async function captureSony() {
  const flashEl = $('pbFlash');
  if (state.cfg.photoFlash) {
    flashEl.classList.remove('go');
    flashEl.classList.add('on');
    await sleep(90);
  }
  const capture = api.sonyPhoto();
  if (state.cfg.photoFlash) {
    await sleep(250);
    flashEl.classList.remove('on');
    void flashEl.offsetWidth;
    flashEl.classList.add('go');
  }
  const r = await capture;
  if (!r || r.error) throw new Error((r && r.error) || 'Kamera Sony tidak mengirim foto');
  const bmp = await createImageBitmap(new Blob([r.bytes], { type: 'image/jpeg' }), {
    imageOrientation: 'from-image',
  });
  const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  c._original = r.bytes;
  return c;
}
async function snap() {
  if (usingSony()) return captureSony();
  if (!state.cfg.photoFlash) return grabFrame(); // flash effect turned off in Photo booth settings
  const flashEl = $('pbFlash');
  flashEl.classList.remove('go');
  flashEl.classList.add('on'); // brief white screen as a "flash"
  await sleep(90);
  try {
    return grabFrame();
  } finally {
    flashEl.classList.remove('on');
    void flashEl.offsetWidth;
    flashEl.classList.add('go');
  }
}
// Show the photo just taken for a moment, then continue to the next countdown
async function preview(i, token) {
  if (PREVIEW_MS() <= 0) {
    await sleep(400);
    return token === photoToken;
  } // preview turned off
  const box = $('pbPreview');
  // Cropped to the template's photo-box ratio (same as the safe zone), from the center like the final result
  $('pbPreviewImg').src = cropToRatio(photos[i], photoRatio(i), 1600);
  $('pbPreviewLabel').textContent = t('pb.label', { i: i + 1 });
  box.classList.remove('out');
  box.classList.add('on');
  await sleep(PREVIEW_MS());
  box.classList.add('out');
  await sleep(250);
  box.classList.remove('on', 'out');
  return token === photoToken;
}
// large = true only for the first photo of a session: the number shows large in the center,
// then at 3 it shrinks to the top-left corner. Otherwise it's small right away.
async function countdown(token, large = false) {
  const el = $('pbCount');
  el.classList.remove('anim');
  el.classList.toggle('kecil', !large);
  el.style.display = 'block';
  for (let i = COUNTDOWN(); i >= 1; i--) {
    $('pbCountNum').textContent = i;
    // Shrink at 3 (if the countdown is only 3 seconds: after the first number)
    if (large && i <= 3 && i < COUNTDOWN() && !el.classList.contains('kecil')) {
      void el.offsetWidth;
      el.classList.add('anim', 'kecil');
    }
    await sleep(1000);
    if (token !== photoToken) {
      el.style.display = 'none';
      return false;
    }
  }
  el.style.display = 'none';
  return true;
}
// Small image of a photo, cropped from the center to ratio r (width/height); no r = the photo's own ratio
function cropToRatio(c, r, width = 1600) {
  if (!r) return thumbURL(c, width);
  const s = Math.min(c.width, c.height * r),
    sh = s / r; // largest part of the photo with ratio r
  const w = Math.min(width, Math.round(s)),
    h = Math.round(w / r);
  const thumb = document.createElement('canvas');
  thumb.width = w;
  thumb.height = h;
  thumb.getContext('2d').drawImage(c, (c.width - s) / 2, (c.height - sh) / 2, s, sh, 0, 0, w, h);
  return thumb.toDataURL('image/jpeg', 0.85);
}
function thumbURL(c, width = 480) {
  const thumb = document.createElement('canvas');
  thumb.width = Math.min(width, c.width);
  thumb.height = Math.round((thumb.width * c.height) / c.width);
  thumb.getContext('2d').drawImage(c, 0, 0, thumb.width, thumb.height);
  return thumb.toDataURL('image/jpeg', 0.85);
}

/* ---------------- Photo strip at the bottom (left = photo 1, right = last photo) ---------------- */
function buildStrip() {
  const s = $('pbStrip');
  s.innerHTML = '';
  for (let i = 0; i < SHOTS; i++) {
    const slot = document.createElement('div');
    slot.className = 'pb-slot';
    slot.innerHTML = `<div class="pb-thumb" id="pbThumb${i}"><span class="empty">${i + 1}</span></div>
        <button class="pb-ulang" data-redo="${i}" aria-label="${t('pb.ulangiKe', { i: i + 1 })}"><svg class="i"><use href="#i-retry"/></svg>${t('pb.ulangi')}</button>`;
    s.appendChild(slot);
  }
  s.querySelectorAll('[data-redo]').forEach(b => (b.onclick = () => shoot([Number(b.dataset.redo)])));
  for (let i = 0; i < SHOTS; i++) setThumbRatio(i);
}
// Thumbnails follow the template's photo-box ratio (same as the preview & safe zone)
function setThumbRatio(i) {
  const r = photoRatio(i) || 16 / 9,
    el = $('pbThumb' + i);
  el.style.aspectRatio = String(r);
  el.style.setProperty('--r', r);
}
function renderSlot(i) {
  const el = $('pbThumb' + i);
  setThumbRatio(i);
  if (!photos[i]) {
    el.classList.remove('filled');
    el.innerHTML = `<span class="empty">${i + 1}</span>`;
    return;
  }
  el.classList.add('filled');
  el.innerHTML = `<img alt="Foto ${i + 1}" src="${cropToRatio(photos[i], photoRatio(i), 480)}"><span class="n">${i + 1}</span>`;
}
function markNext(i) {
  for (let k = 0; k < SHOTS; k++) $('pbThumb' + k).classList.toggle('next', k === i);
}

/* ---------------- Safe zone ----------------
   The camera photo (e.g. 3:2) is cropped to the template's photo-box ratio. While shooting, the
   area that will be used is outlined, and the part outside it is lightly blurred.
   The math matches the crop used when the photo is placed in the template (centered, not squashed). */
let safeZoneIndex = -1,
  templateReady = Promise.resolve();
const layoutSlots = lay => (lay.tpl ? lay.prepared.tpl.slots : lay.slots());
function photoRatio(i) {
  const p = layoutChoices(),
    lay = p[editor.layout] || p[Object.keys(p)[0]];
  const s = lay && layoutSlots(lay)[i];
  return s && s.w > 0 && s.h > 0 ? s.w / s.h : null;
}
function sourceSize() {
  if (usingSony()) {
    const c = $('camLv');
    return [c.width, c.height];
  }
  const v = $('cam');
  return [v.videoWidth, v.videoHeight];
}
function updateSafeZone(i = safeZoneIndex) {
  safeZoneIndex = i;
  const el = $('pbSafe'),
    r = i >= 0 ? photoRatio(i) : null,
    [fw, fh] = sourceSize();
  if (!r || !fw || !fh || state.current !== 'photo') {
    el.classList.remove('on');
    return;
  }
  // The camera fills the screen (object-fit: cover), so use the same scale
  const SW = window.innerWidth,
    SH = window.innerHeight,
    k = Math.max(SW / fw, SH / fh);
  const [aw, ah] = fw / fh > r ? [fh * r, fh] : [fw, fw / r];
  const w = aw * k,
    h = ah * k;
  if (w >= SW - 2 && h >= SH - 2) {
    el.classList.remove('on');
    return;
  } // the whole screen is already inside
  el.style.setProperty('--l', (SW - w) / 2 + 'px');
  el.style.setProperty('--t', (SH - h) / 2 + 'px');
  el.style.setProperty('--w', w + 'px');
  el.style.setProperty('--h', h + 'px');
  el.classList.add('on');
}

/* ---------------- Photo flow ---------------- */
function setRunningUI(on) {
  running = on;
  $('pbBack').style.display = on ? 'none' : '';
  $('pbPill').style.display = on ? 'flex' : 'none';
  $('pbActions').style.display = 'none';
  $('pbStrip').classList.toggle('done', false);
}
async function shoot(indices) {
  if (running) return;
  if (!needStream()) return;
  if (state.noCam && !usingSony()) {
    setNotice('Photo booth butuh kamera. Sambungkan kamera lalu pilih di Admin.', 8000);
    return;
  }
  const token = ++photoToken;
  disarmCancel();
  state.busy = true;
  resetIdle();
  setRunningUI(true);
  await templateReady; // the safe-zone ratio comes from the couple's template
  try {
    for (const i of indices) {
      $('pbPillText').textContent =
        indices.length === 1 ? t('pb.ulangiKe', { i: i + 1 }) : t('pb.ke', { i: i + 1, n: SHOTS });
      markNext(i);
      updateSafeZone(i);
      const large = indices.length === SHOTS && i === indices[0]; // only the first countdown of a session
      if (!(await countdown(token, large))) return;
      photos[i] = await snap();
      renderSlot(i);
      if (!(await preview(i, token))) return;
    }
  } catch (err) {
    console.log('Photo booth failed: ' + err.message);
    setNotice('Foto gagal diambil: ' + err.message, 10000);
  } finally {
    if (token === photoToken) {
      state.busy = false;
      running = false;
      setRunningUI(false);
      showDone();
      resetIdle();
    }
  }
}
function showDone() {
  const all = photos.every(Boolean);
  $('pbStrip').classList.toggle('done', all);
  $('pbActions').style.display = all ? 'flex' : 'none';
  $('pbBack').style.display = '';
  $('pbBackLabel').textContent = photos.some(Boolean) ? t('pb.batal') : t('pb.kembali');
  markNext(-1);
  updateSafeZone(-1);
}
function openPhoto() {
  $('pbIntro').textContent = t('pb.intro', { n: SHOTS, s: COUNTDOWN() });
  photoToken++;
  running = false;
  state.busy = false;
  photos.fill(null);
  editor = newEditState();
  $('peShowText').checked = true;
  updateSafeZone(-1);
  // Load the couple's templates now: their ratio is used for the safe zone while shooting
  templateReady = loadCoupleTemplates().then(() => {
    const p = layoutChoices();
    if (!p[editor.layout]) editor.layout = Object.keys(p)[0];
  });
  buildStrip();
  $('pbPre').style.display = 'flex';
  $('pbBottom').style.display = 'none';
  $('pbPill').style.display = 'none';
  $('pbBack').style.display = '';
  $('pbBackLabel').textContent = t('pb.kembali');
  disarmCancel();
  show('photo');
}
function startSession() {
  $('pbPre').style.display = 'none';
  $('pbBottom').style.display = 'flex';
  shoot([...Array(SHOTS).keys()]);
}
function disarmCancel() {
  clearTimeout(cancelArmed);
  cancelArmed = null;
}
function backFromPhoto() {
  if (photos.some(Boolean)) {
    // photos already taken: press twice to cancel
    if (!cancelArmed) {
      $('pbBackLabel').textContent = t('pb.yakin');
      cancelArmed = setTimeout(() => {
        disarmCancel();
        showDone();
      }, 3000);
      return;
    }
    disarmCancel();
  }
  photoToken++;
  photos.fill(null);
  show('utama');
}

/* =====================================================================
   Edit photo page
   ===================================================================== */
const LAYOUTS = {
  grid: {
    get name() {
      return t('layout.grid');
    },
    W: 1200,
    H: 1800,
    slots() {
      const m = 60,
        g = 30,
        w = (1200 - 2 * m - g) / 2,
        h = 656;
      return [
        [m, m],
        [m + w + g, m],
        [m, m + h + g],
        [m + w + g, m + h + g],
      ].map(([x, y]) => ({ x, y, w, h }));
    },
    text: { y: 1560, name: 84, date: 36 },
  },
  strip: {
    get name() {
      return t('layout.strip');
    },
    W: 600,
    H: 1800,
    slots() {
      const m = 40,
        g = 24,
        w = 520,
        h = 362;
      return [0, 1, 2, 3].map(i => ({ x: m, y: m + i * (h + g), w, h }));
    },
    text: { y: 1655, name: 46, date: 22 },
  },
  big: {
    get name() {
      return t('layout.big');
    },
    W: 1200,
    H: 1800,
    slots() {
      const m = 60,
        g = 24,
        W = 1080,
        bh = 780,
        sw = (W - 2 * g) / 3,
        sh = 470;
      return [
        { x: m, y: m, w: W, h: bh },
        ...[0, 1, 2].map(i => ({ x: m + i * (sw + g), y: m + bh + g, w: sw, h: sh })),
      ];
    },
    text: { y: 1560, name: 84, date: 36 },
  },
};
const FILTERS = [
  ['none', 'Normal', 'none'],
  ['bw', 'Black & white', 'grayscale(1) contrast(1.12)'],
  ['warm', 'Warm', 'sepia(.22) saturate(1.18) brightness(1.04)'],
  ['soft', 'Soft', 'brightness(1.08) contrast(.9) saturate(.9)'],
  ['vintage', 'Vintage', 'sepia(.45) contrast(.92) brightness(1.05) saturate(.85)'],
  ['bright', 'Bright', 'brightness(1.12) saturate(1.12) contrast(1.04)'],
];
const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#B08D57';
const FRAMES = () => [
  ['#FFFFFF', 'Putih', '#1D1D1F'],
  ['#F3EDE4', 'Krem', '#3A2E25'],
  ['#F6E1E3', 'Blush', '#5B3A40'],
  ['#E3EBE1', 'Sage', '#2F4030'],
  ['#1D1D1F', 'Hitam', '#FFFFFF'],
  [accent(), 'Aksen', '#FFFFFF'],
];
const STICKERS = ['💍', '❤️', '💕', '✨', '🥂', '🎉', '👑', '💐', '🌸', '🕊️', '😘', '😎', '🎀', '💒', '⭐', '🥳'];
const COLORS = ['#FFFFFF', '#1D1D1F', '#FF3B30', '#FF9F0A', '#34C759', '#0A84FF', '#AF52DE'];
const SIZES = [5, 10, 18];
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif';
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
// Admin-made templates for the active couple (loaded when the Edit page opens)
let templateLayouts = {};
const currentLayout = () => LAYOUTS[editor.layout] || templateLayouts[editor.layout] || LAYOUTS.grid;
// Guests only use layouts from Admin. The built-in layouts are used when Admin has no templates yet.
const hasTemplates = () => Object.keys(templateLayouts).length > 0;
const layoutChoices = () => (hasTemplates() ? templateLayouts : LAYOUTS);
async function loadCoupleTemplates() {
  templateLayouts = {};
  if (!state.activeCouple || !api.listTemplates) return;
  try {
    for (const tpl of await api.listTemplates(state.activeCouple.id)) {
      // LUT filter chosen in Admin for this template (if the filter was deleted: no filter)
      const item = tpl.filter ? await loadLut(tpl.filter) : null;
      const lut = item
        ? {
            id: item.id,
            nama: item.nama,
            data: item.lut,
            k: (tpl.filterKekuatan ?? 100) / 100,
            tamu: tpl.filterTamu !== false,
          }
        : null;
      templateLayouts['tpl:' + tpl.id] = {
        name: tpl.nama,
        W: tpl.W,
        H: tpl.H,
        tpl: true,
        lut,
        prepared: await prepareTemplate(tpl),
      };
    }
  } catch (err) {
    console.log('Templates could not be loaded: ' + err.message);
  }
}

// The photo fills its box (cropped from the center, not squashed)
function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s,
    sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}
const dateText = () => todayDate();

/* Filters that can be chosen for this layout.
   Template with a filter from Admin: the template filter ('tpl') first, then the built-in
   filters if Admin lets guests choose. */
const cssFilter = key => (FILTERS.find(x => x[0] === key) || FILTERS[0])[2];
function filterChoices(lay = currentLayout()) {
  if (!lay.lut) return FILTERS;
  const templateOption = ['tpl', lay.lut.nama, 'none'];
  return lay.lut.tamu ? [templateOption, ...FILTERS] : [templateOption];
}
// Make sure the chosen filter exists in this layout; a template with a filter starts with it
function syncFilter(layoutChanged) {
  const lay = currentLayout(),
    exists = filterChoices(lay).some(x => x[0] === editor.filter);
  if (lay.lut && (layoutChanged || !exists)) editor.filter = 'tpl';
  else if (!exists) editor.filter = 'none';
}
// Photos 1-4 with the template's LUT filter (made once per photo, then cached)
const lutPhotoCache = new WeakMap();
function photosWithLut(lay) {
  return photos.map(p => {
    if (!p) return p;
    let m = lutPhotoCache.get(p);
    if (!m) lutPhotoCache.set(p, (m = new Map()));
    const cacheKey = lay.lut.id + ':' + lay.lut.k;
    if (!m.has(cacheKey)) m.set(cacheKey, applyLut(p, lay.lut.data, lay.lut.k, Math.max(lay.W, lay.H)));
    return m.get(cacheKey);
  });
}

// One full photo with the chosen filter (for the QR "single photo" downloads)
function singlePhoto(lay, i, maxSide = 2000) {
  const lut = editor.filter === 'tpl' && lay.lut;
  const src = lut ? photosWithLut(lay)[i] : photos[i];
  const w0 = src.width,
    h0 = src.height,
    s = Math.min(1, maxSide / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * s);
  c.height = Math.round(h0 * s);
  const ctx = c.getContext('2d');
  if (!lut) ctx.filter = cssFilter(editor.filter);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// Base layer: frame, filtered photos, name & date
function renderBase(ctx, lay, scale = 1, filterKey = editor.filter) {
  if (lay.tpl) {
    const lut = filterKey === 'tpl' && lay.lut;
    return drawTemplate(ctx, lay.prepared, {
      scale,
      photos: lut ? photosWithLut(lay) : photos,
      filter: lut ? 'none' : cssFilter(filterKey),
    });
  }
  const [bg, , fg] = FRAMES()[editor.frame];
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, lay.W, lay.H);
  const f = cssFilter(filterKey);
  lay.slots().forEach((s, i) => {
    if (!photos[i]) return;
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(s.x, s.y, s.w, s.h, 8);
    else ctx.rect(s.x, s.y, s.w, s.h);
    ctx.clip();
    ctx.filter = f;
    drawCover(ctx, photos[i], s.x, s.y, s.w, s.h);
    ctx.restore();
  });
  if (editor.showText) {
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${lay.text.name}px ${FONT}`;
    ctx.fillText(state.activeCouple ? state.activeCouple.name : '', lay.W / 2, lay.text.y, lay.W - 80);
    ctx.globalAlpha = 0.72;
    ctx.font = `500 ${lay.text.date}px ${FONT}`;
    ctx.fillText(dateText(), lay.W / 2, lay.text.y + lay.text.date * 1.9, lay.W - 80);
  }
  ctx.restore();
}
function renderStrokes(ctx, lay, scale = 1) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const st of editor.strokes) {
    ctx.strokeStyle = st.color;
    ctx.lineWidth = st.w * lay.W * scale;
    ctx.beginPath();
    st.pts.forEach(([x, y], k) =>
      k ? ctx.lineTo(x * lay.W * scale, y * lay.H * scale) : ctx.moveTo(x * lay.W * scale, y * lay.H * scale),
    );
    if (st.pts.length === 1) ctx.lineTo(st.pts[0][0] * lay.W * scale + 0.1, st.pts[0][1] * lay.H * scale);
    ctx.stroke();
  }
  ctx.restore();
}
function renderStickers(ctx, lay, scale = 1) {
  for (const s of editor.stickers) {
    ctx.save();
    ctx.translate(s.x * lay.W * scale, s.y * lay.H * scale);
    ctx.rotate((s.rot * Math.PI) / 180);
    ctx.font = `${s.size * lay.W * scale}px ${EMOJI_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.ch, 0, 0);
    ctx.restore();
  }
}

/* ---- Preview ---- */
function fitStage() {
  const st = $('peStage').getBoundingClientRect(),
    lay = currentLayout();
  const k = Math.min((st.width - 48) / lay.W, (st.height - 48) / lay.H);
  const box = $('peBox');
  box.style.width = Math.floor(lay.W * k) + 'px';
  box.style.height = Math.floor(lay.H * k) + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const id of ['peCanvas', 'peDraw']) {
    const c = $(id);
    c.width = Math.round(lay.W * k * dpr);
    c.height = Math.round(lay.H * k * dpr);
  }
  redraw();
  placeStickers();
}
const previewScale = () => $('peCanvas').width / currentLayout().W;
function redraw() {
  const c = $('peCanvas'),
    ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  renderBase(ctx, currentLayout(), previewScale());
  redrawInk();
}
function redrawInk() {
  const c = $('peDraw'),
    ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  renderStrokes(ctx, currentLayout(), previewScale());
}

/* ---- Panel options ---- */
function mini(lay) {
  const c = document.createElement('canvas'),
    k = 150 / lay.W;
  c.width = 150;
  c.height = Math.round(lay.H * k);
  renderBase(c.getContext('2d'), lay, k);
  return c;
}
function option(container, on, content, label, onClick) {
  const b = document.createElement('button');
  b.className = 'pe-opt' + (on ? ' on' : '');
  if (typeof content === 'string') b.innerHTML = content;
  else b.appendChild(content);
  b.insertAdjacentText('beforeend', label);
  b.onclick = onClick;
  container.appendChild(b);
}
function buildPanel() {
  const lays = $('peLayouts');
  lays.innerHTML = '';
  for (const [key, lay] of Object.entries(layoutChoices()))
    option(lays, editor.layout === key, mini(lay), lay.name, () => {
      editor.layout = key;
      syncFilter(true);
      fitStage();
      buildPanel();
    });
  const usesTemplate = !!currentLayout().tpl;
  $('peFrameNormal').style.display = usesTemplate ? 'none' : '';
  $('peFrameHint').style.display = usesTemplate ? 'block' : 'none';

  const filterBox = $('peFilters');
  filterBox.innerHTML = '';
  const layNow = currentLayout(),
    filterList = filterChoices(layNow);
  // The Filter tab is hidden when the template locks its filter (only one option)
  const filterTab = document.querySelector('#peTabs .pe-tab[data-tab="filter"]');
  if (filterTab) filterTab.style.display = filterList.length > 1 ? '' : 'none';
  if (filterList.length < 2 && editor.tab === 'filter')
    setTab(Object.keys(layoutChoices()).length > 1 ? 'layout' : 'sticker');
  for (const [key, templateName, f] of filterList) {
    const name = key === 'tpl' ? templateName : t('filter.' + key);
    const c = document.createElement('canvas');
    c.width = 150;
    c.height = 150;
    const cx = c.getContext('2d');
    if (key === 'tpl') drawCover(cx, photosWithLut(layNow)[0], 0, 0, 150, 150);
    else {
      cx.filter = f;
      drawCover(cx, photos[0], 0, 0, 150, 150);
    }
    option(filterBox, editor.filter === key, c, name, () => {
      editor.filter = key;
      redraw();
      buildPanel();
    });
  }

  const fr = $('peFrames');
  fr.innerHTML = '';
  FRAMES().forEach(([bg], i) =>
    option(fr, editor.frame === i, `<span class="pe-sw" style="background:${bg}"></span>`, t('bingkai.' + i), () => {
      editor.frame = i;
      redraw();
      buildPanel();
    }),
  );

  const sl = $('peStickerList');
  if (!sl.childElementCount)
    for (const ch of STICKERS) {
      const b = document.createElement('button');
      b.className = 'pe-stk';
      b.textContent = ch;
      b.style.fontFamily = EMOJI_FONT;
      b.onclick = () => addSticker(ch);
      sl.appendChild(b);
    }

  const cl = $('peColors');
  cl.innerHTML = '';
  for (const col of [...COLORS, accent()]) {
    const b = document.createElement('button');
    b.className = 'pe-dot' + (editor.color === col ? ' on' : '');
    b.style.background = col;
    b.setAttribute('aria-label', 'Warna ' + col);
    b.onclick = () => {
      editor.color = col;
      buildPanel();
    };
    cl.appendChild(b);
  }
  const sz = $('peSizes');
  sz.innerHTML = '';
  for (const s of SIZES) {
    const b = document.createElement('button');
    b.className = 'pe-size' + (editor.size === s ? ' on' : '');
    b.innerHTML = `<i style="width:${s + 4}px;height:${s + 4}px"></i>`;
    b.onclick = () => {
      editor.size = s;
      buildPanel();
    };
    sz.appendChild(b);
  }
}
function setTab(tab) {
  editor.tab = tab;
  document
    .querySelectorAll('#peTabs .pe-tab')
    .forEach(button => button.classList.toggle('on', button.dataset.tab === tab));
  document.querySelectorAll('#editphoto .pe-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === tab));
  $('peBox').classList.toggle('drawing', tab === 'draw');
  if (tab === 'draw') select(null);
}

/* ---- Stickers ---- */
let stickerSeq = 0;
function addSticker(ch) {
  const s = { id: ++stickerSeq, ch, x: 0.5, y: 0.4 + (editor.stickers.length % 5) * 0.04, size: 0.14, rot: 0 };
  editor.stickers.push(s);
  select(s.id);
  resetIdle();
}
const selected = () => editor.stickers.find(s => s.id === editor.sel);
function select(id) {
  editor.sel = id;
  placeStickers();
}
function placeStickers() {
  const box = $('peStickers'),
    bw = $('peBox').getBoundingClientRect().width;
  box.innerHTML = '';
  for (const s of editor.stickers) {
    const el = document.createElement('div');
    el.className = 'pe-sticker' + (s.id === editor.sel ? ' sel' : '');
    el.textContent = s.ch;
    el.dataset.id = s.id;
    el.style.fontFamily = EMOJI_FONT;
    el.style.left = s.x * 100 + '%';
    el.style.top = s.y * 100 + '%';
    el.style.fontSize = s.size * bw + 'px';
    el.style.setProperty('--r', s.rot + 'deg');
    attachGestures(el, s);
    box.appendChild(el);
  }
}
// Move with one finger, resize & rotate with two
function attachGestures(el, s) {
  const pts = new Map();
  let start = null;
  const snapshot = () => {
    const p = [...pts.values()],
      two = p.length >= 2;
    return {
      x: s.x,
      y: s.y,
      size: s.size,
      rot: s.rot,
      d: two ? Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) : 0,
      a: two ? Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) : 0,
      mid: two ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } : p[0],
    };
  };
  el.addEventListener('pointerdown', e => {
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (editor.sel !== s.id) {
      editor.sel = s.id;
      document.querySelectorAll('.pe-sticker').forEach(x => x.classList.toggle('sel', Number(x.dataset.id) === s.id));
    }
    start = snapshot();
    resetIdle();
  });
  el.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = $('peBox').getBoundingClientRect(),
      now = snapshot();
    if (pts.size >= 2 && !start.d) start = { ...now, x: s.x, y: s.y }; // second finger just touched
    s.x = Math.min(1, Math.max(0, start.x + (now.mid.x - start.mid.x) / r.width));
    s.y = Math.min(1, Math.max(0, start.y + (now.mid.y - start.mid.y) / r.height));
    if (pts.size >= 2 && start.d) {
      s.size = Math.min(0.6, Math.max(0.04, (start.size * now.d) / start.d));
      s.rot = start.rot + ((now.a - start.a) * 180) / Math.PI;
      el.style.fontSize = s.size * r.width + 'px';
      el.style.setProperty('--r', s.rot + 'deg');
    }
    el.style.left = s.x * 100 + '%';
    el.style.top = s.y * 100 + '%';
  });
  const up = e => {
    pts.delete(e.pointerId);
    start = pts.size ? snapshot() : null;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
}
function tweakSticker(fn) {
  const s = selected();
  if (!s) {
    setNotice(t('pb.pilihStiker'), 4000);
    return;
  }
  fn(s);
  placeStickers();
}

/* ---- Drawing ---- */
function attachDrawing() {
  const c = $('peDraw');
  let cur = null;
  const pos = e => {
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  c.addEventListener('pointerdown', e => {
    c.setPointerCapture(e.pointerId);
    cur = { color: editor.color, w: editor.size / 1200, pts: [pos(e)] };
    editor.strokes.push(cur);
    redrawInk();
    resetIdle();
  });
  c.addEventListener('pointermove', e => {
    if (!cur) return;
    cur.pts.push(pos(e));
    redrawInk();
  });
  const end = () => {
    cur = null;
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', end);
}

async function openEdit() {
  await loadCoupleTemplates();
  if (!layoutChoices()[editor.layout]) editor.layout = Object.keys(layoutChoices())[0];
  syncFilter(true);
  // The Layout tab only shows with more than one option; the Frame tab only for built-in layouts.
  // The Filter tab is hidden when the template locks its filter.
  const visibleTabs = {
    layout: Object.keys(layoutChoices()).length > 1,
    frame: !hasTemplates(),
    filter: filterChoices().length > 1,
  };
  document.querySelectorAll('#peTabs .pe-tab').forEach(button => {
    button.style.display = visibleTabs[button.dataset.tab] === false ? 'none' : '';
  });
  if (!editor.tab || visibleTabs[editor.tab] === false)
    editor.tab = ['layout', 'filter', 'sticker'].find(x => visibleTabs[x] !== false);
  show('editphoto');
  buildPanel();
  setTab(editor.tab || 'layout');
  requestAnimationFrame(fitStage);
}

/* ---- Done: render the final image, then save ---- */
const toBytes = (c, q) =>
  new Promise((res, rej) =>
    c.toBlob(
      async b => {
        if (!b) return rej(new Error('Gagal membuat file JPG'));
        res(new Uint8Array(await b.arrayBuffer()));
      },
      'image/jpeg',
      q,
    ),
  );
let saving = false;
async function finishEdit() {
  if (saving) return;
  saving = true;
  state.busy = true;
  const lay = currentLayout();
  const out = document.createElement('canvas');
  out.width = lay.W;
  out.height = lay.H;
  const ctx = out.getContext('2d');
  renderBase(ctx, lay);
  renderStrokes(ctx, lay);
  renderStickers(ctx, lay);

  $('savingTitle').textContent = t('simpan.foto');
  const bar = $('saveBar');
  bar.classList.remove('run');
  void bar.offsetWidth;
  bar.classList.add('run');
  show('saving');
  let ok = false,
    err = '',
    link = null;
  const work = (async () => {
    const originals = [];
    for (const p of photos) originals.push(p._original || (await toBytes(p, 0.95))); // Sony: the camera's original file
    const result = await toBytes(out, 0.93);
    // Single photos for QR download: full (not cropped by the template), same filter, max 2000 px
    const singles = [];
    for (let i = 0; i < photos.length; i++) if (photos[i]) singles.push(await toBytes(singlePhoto(lay, i), 0.9));
    const r = await api.savePhotos({
      originals,
      result,
      satuan: singles,
      tamu: state.guestName,
      meta: {
        layout: lay.tpl ? 'template' : editor.layout,
        template: lay.tpl ? lay.name : undefined,
        filter: editor.filter === 'tpl' ? 'template: ' + (lay.lut ? lay.lut.nama : '-') : editor.filter,
        frame: lay.tpl ? undefined : FRAMES()[editor.frame][1],
        stickers: editor.stickers.length,
        drawings: editor.strokes.length,
      },
    });
    ok = !!(r && r.ok);
    err = r && r.error;
    link = r && r.link;
  })().catch(e => {
    err = e.message;
  });
  await Promise.all([sleep(3000), Promise.race([work, sleep(15000)])]);
  $('savingTitle').textContent = t('simpan.rekaman');

  setThanks(ok);
  $('thanksMsg').textContent = ok ? t('tk.fotoOk') : t('tk.fotoGagal');
  if (!ok) setNotice('Foto gagal disimpan: ' + (err || 'waktu habis'), 15000);
  const tp = $('thanksPhoto');
  if (ok) {
    tp.src = out.toDataURL('image/jpeg', 0.85);
    tp.style.display = 'block';
    $('thanksBadge').style.display = 'none';
    $('thanks').classList.add('tk-foto');
  }
  if (ok && link) showDownloadQr(link);
  photos.fill(null);
  saving = false;
  state.busy = false;
  show('thanks');
}

/* ---------------- Wire up the buttons (called once from start.js) ---------------- */
export function setupPhotobooth() {
  $('btnToPhoto').onclick = openPhoto;
  $('pbStart').onclick = startSession;
  $('pbBack').onclick = backFromPhoto;
  $('pbFinish').onclick = () => {
    if (photos.every(Boolean) && !running) openEdit();
  };
  $('peBack').onclick = () => {
    show('photo');
    showDone();
  };
  $('peDone').onclick = finishEdit;
  document.querySelectorAll('.pe-tab').forEach(button => (button.onclick = () => setTab(button.dataset.tab)));
  $('peShowText').onchange = e => {
    editor.showText = e.target.checked;
    redraw();
    buildPanel();
  };
  $('peStkSmaller').onclick = () =>
    tweakSticker(s => {
      s.size = Math.max(0.04, s.size * 0.8);
    });
  $('peStkBigger').onclick = () =>
    tweakSticker(s => {
      s.size = Math.min(0.6, s.size * 1.25);
    });
  $('peStkRotate').onclick = () =>
    tweakSticker(s => {
      s.rot += 15;
    });
  $('peStkDelete').onclick = () =>
    tweakSticker(s => {
      editor.stickers = editor.stickers.filter(x => x !== s);
      editor.sel = null;
    });
  $('peUndo').onclick = () => {
    editor.strokes.pop();
    redrawInk();
  };
  $('peClear').onclick = () => {
    editor.strokes = [];
    redrawInk();
  };
  $('peBox').addEventListener('pointerdown', e => {
    if (e.target.id === 'peCanvas' || e.target.id === 'peStickers') select(null);
  });
  attachDrawing();
  window.addEventListener('resize', () => {
    if ($('editphoto').classList.contains('on')) fitStage();
    updateSafeZone();
  });
  // The camera image size is only known after the first frame arrives: update the safe zone
  setInterval(() => {
    if (safeZoneIndex >= 0) updateSafeZone();
  }, 500);
}
