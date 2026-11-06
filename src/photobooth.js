/* =====================================================================
   photobooth.js — halamanPhoto (4 foto + hitung mundur) & halamanEditPhoto
   Markup halamannya ada di index.html (#photo dan #editphoto).
   Memakai data & fungsi bersama: $, show, sleep, busy, resetIdle, noCam,
   activeCouple, setNotice, setThanks, needStream (lihat state.js, app.js,
   rekaman.js). Semua isi file ini dibungkus supaya namanya tidak bentrok
   dengan fitur lain; yang dibuka ke luar hanya pasangPhotobooth().
   Pengambil foto ada di grabFrame(). Nanti kalau SDK kamera sudah siap,
   cukup fungsi ini yang diganti (jepret kamera + flash), sisanya tetap.
   ===================================================================== */
(() => {
  const SHOTS = 4;            // jumlah foto per sesi
  // Lama hitung mundur, pratinjau, dan efek kilat diatur di Pengaturan photobooth (cfg)
  const COUNTDOWN = () => cfg.photoCountdown;
  const PREVIEW_MS = () => cfg.photoPreview * 1000;


  /* ---------------- Status ---------------- */
  const photos = new Array(SHOTS).fill(null);   // kanvas resolusi penuh setiap foto
  let running = false, pbToken = 0, cancelArmed = null;
  const fresh = () => ({ layout: 'grid', filter: 'none', frame: 0, showText: true, stickers: [], strokes: [], sel: null,
                         tab: 'layout', color: '#FFFFFF', size: 10 });
  let ed = fresh();

  /* ---------------- Ambil foto ----------------
     Saat ini: satu frame dari kamera yang tersambung (HP / HDMI) dalam resolusi aslinya.
     Disimpan tanpa efek cermin, jadi tulisan di baju atau latar tidak terbalik. */
  function grabFrame() {
    const v = $('cam');
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) throw new Error('Gambar kamera belum siap');
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(v, 0, 0, w, h);
    return c;
  }
  // Kamera Sony: jepret di kamera, foto resolusi penuh masuk lewat USB.
  // Untuk diedit, foto diperkecil (sisi terpanjang 3000 px); file aslinya tetap disimpan utuh.
  async function jepretSony() {
    const fl = $('pbFlash');
    if (cfg.photoFlash) { fl.classList.remove('go'); fl.classList.add('on'); await sleep(90); }
    const kerja = api.sonyFoto();
    if (cfg.photoFlash) { await sleep(250); fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('go'); }
    const r = await kerja;
    if (!r || r.error) throw new Error((r && r.error) || 'Kamera Sony tidak mengirim foto');
    const bmp = await createImageBitmap(new Blob([r.bytes], { type: 'image/jpeg' }), { imageOrientation: 'from-image' });
    const k = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    c._asli = r.bytes;
    return c;
  }
  async function snap() {
    if (pakaiSony()) return jepretSony();
    if (!cfg.photoFlash) return grabFrame();                // efek kilat dimatikan di Pengaturan photobooth
    const fl = $('pbFlash');
    fl.classList.remove('go'); fl.classList.add('on');   // layar putih sesaat sebagai "flash"
    await sleep(90);
    try { return grabFrame(); }
    finally { fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('go'); }
  }
  // Tampilkan foto yang baru diambil sebentar, lalu lanjut ke hitungan berikutnya
  async function preview(i, token) {
    if (PREVIEW_MS() <= 0) { await sleep(400); return token === pbToken; }   // pratinjau dimatikan
    const box = $('pbPreview');
    // Dipotong ke rasio kotak foto di template (sama dengan zona aman), dari tengah seperti hasil akhirnya
    $('pbPreviewImg').src = potongRasio(photos[i], rasioFoto(i), 1600);
    $('pbPreviewLabel').textContent = t('pb.label', { i: i + 1 });
    box.classList.remove('out'); box.classList.add('on');
    await sleep(PREVIEW_MS());
    box.classList.add('out');
    await sleep(250);
    box.classList.remove('on', 'out');
    return token === pbToken;
  }
  // besar = true hanya untuk foto pertama sesi: angka tampil besar di tengah,
  // lalu saat angka 3 mengecil ke pojok kiri atas. Selain itu langsung kecil.
  async function countdown(token, besar = false) {
    const el = $('pbCount');
    el.classList.remove('anim');
    el.classList.toggle('kecil', !besar);
    el.style.display = 'block';
    for (let i = COUNTDOWN(); i >= 1; i--) {
      $('pbCountNum').textContent = i;
      // Mengecil saat angka 3 (kalau hitungan cuma 3 detik: setelah angka pertama)
      if (besar && i <= 3 && i < COUNTDOWN() && !el.classList.contains('kecil')) {
        void el.offsetWidth; el.classList.add('anim', 'kecil');
      }
      await sleep(1000);
      if (token !== pbToken) { el.style.display = 'none'; return false; }
    }
    el.style.display = 'none';
    return true;
  }
  // Gambar kecil dari foto, dipotong dari tengah ke rasio r (lebar/tinggi); tanpa r = rasio asli foto
  function potongRasio(c, r, width = 1600) {
    if (!r) return thumbURL(c, width);
    const s = Math.min(c.width, c.height * r), sh = s / r;      // bagian foto terbesar dengan rasio r
    const w = Math.min(width, Math.round(s)), h = Math.round(w / r);
    const t = document.createElement('canvas'); t.width = w; t.height = h;
    t.getContext('2d').drawImage(c, (c.width - s) / 2, (c.height - sh) / 2, s, sh, 0, 0, w, h);
    return t.toDataURL('image/jpeg', 0.85);
  }
  function thumbURL(c, width = 480) {
    const t = document.createElement('canvas');
    t.width = Math.min(width, c.width); t.height = Math.round(t.width * c.height / c.width);
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.85);
  }

  /* ---------------- Deretan foto di bawah (kiri = foto 1, kanan = foto terakhir) ---------------- */
  function buildStrip() {
    const s = $('pbStrip'); s.innerHTML = '';
    for (let i = 0; i < SHOTS; i++) {
      const slot = document.createElement('div'); slot.className = 'pb-slot';
      slot.innerHTML = `<div class="pb-thumb" id="pbThumb${i}"><span class="empty">${i + 1}</span></div>
        <button class="btn sm glassy" data-redo="${i}"><svg class="i"><use href="#i-retry"/></svg>${t('pb.ulangi')}</button>`;
      s.appendChild(slot);
    }
    s.querySelectorAll('[data-redo]').forEach(b => b.onclick = () => shoot([Number(b.dataset.redo)]));
    for (let i = 0; i < SHOTS; i++) rasioThumb(i);
  }
  // Kotak kecil mengikuti rasio kotak foto di template (sama dengan pratinjau & zona aman)
  function rasioThumb(i) { const r = rasioFoto(i); $('pbThumb' + i).style.aspectRatio = String(r || 16 / 9); }
  function renderSlot(i) {
    const el = $('pbThumb' + i);
    rasioThumb(i);
    if (!photos[i]) { el.classList.remove('filled'); el.innerHTML = `<span class="empty">${i + 1}</span>`; return; }
    el.classList.add('filled');
    el.innerHTML = `<img alt="Foto ${i + 1}" src="${potongRasio(photos[i], rasioFoto(i), 480)}"><span class="n">${i + 1}</span>`;
  }
  function markNext(i) { for (let k = 0; k < SHOTS; k++) $('pbThumb' + k).classList.toggle('next', k === i); }

  /* ---------------- Zona aman ----------------
     Foto kamera (mis. 3:2) dipotong ke rasio kotak foto di template. Saat difoto, area yang
     akan dipakai ditandai bingkai, dan bagian di luarnya dibuat blur tipis.
     Hitungannya sama dengan pemotongan saat foto dipasang ke template (tengah, tanpa gepeng). */
  let amanIdx = -1, siapTemplate = Promise.resolve();
  const slotsLayout = lay => (lay.tpl ? lay.siap.tpl.slots : lay.slots());
  function rasioFoto(i) {
    const p = pilihanLayout(), lay = p[ed.layout] || p[Object.keys(p)[0]];
    const s = lay && slotsLayout(lay)[i];
    return s && s.w > 0 && s.h > 0 ? s.w / s.h : null;
  }
  function ukuranSumber() {
    if (pakaiSony()) { const c = $('camLv'); return [c.width, c.height]; }
    const v = $('cam'); return [v.videoWidth, v.videoHeight];
  }
  function aturZonaAman(i = amanIdx) {
    amanIdx = i;
    const el = $('pbSafe'), r = i >= 0 ? rasioFoto(i) : null, [fw, fh] = ukuranSumber();
    if (!r || !fw || !fh || current !== 'photo') { el.classList.remove('on'); return; }
    // Kamera tampil memenuhi layar (object-fit: cover), jadi hitung dengan skala yang sama
    const SW = window.innerWidth, SH = window.innerHeight, k = Math.max(SW / fw, SH / fh);
    const [aw, ah] = fw / fh > r ? [fh * r, fh] : [fw, fw / r];
    const w = aw * k, h = ah * k;
    if (w >= SW - 2 && h >= SH - 2) { el.classList.remove('on'); return; }     // seluruh layar sudah masuk
    el.style.setProperty('--l', (SW - w) / 2 + 'px'); el.style.setProperty('--t', (SH - h) / 2 + 'px');
    el.style.setProperty('--w', w + 'px'); el.style.setProperty('--h', h + 'px');
    el.classList.add('on');
  }

  /* ---------------- Alur foto ---------------- */
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
    if (noCam && !pakaiSony()) { setNotice('Photo booth butuh kamera. Sambungkan kamera lalu pilih di Admin.', 8000); return; }
    const token = ++pbToken;
    disarmCancel();
    busy = true; resetIdle();
    setRunningUI(true);
    await siapTemplate;                         // rasio zona aman berasal dari template couple
    try {
      for (const i of indices) {
        $('pbPillText').textContent = indices.length === 1 ? t('pb.ulangiKe', { i: i + 1 }) : t('pb.ke', { i: i + 1, n: SHOTS });
        markNext(i);
        aturZonaAman(i);
        const besar = indices.length === SHOTS && i === indices[0];   // hanya hitungan pertama sesi
        if (!(await countdown(token, besar))) return;
        photos[i] = await snap();
        renderSlot(i);
        if (!(await preview(i, token))) return;
      }
    } catch (err) {
      console.log('Photo booth gagal: ' + err.message);
      setNotice('Foto gagal diambil: ' + err.message, 10000);
    } finally {
      if (token === pbToken) { busy = false; running = false; setRunningUI(false); showDone(); resetIdle(); }
    }
  }
  function showDone() {
    const all = photos.every(Boolean);
    $('pbStrip').classList.toggle('done', all);
    $('pbActions').style.display = all ? 'flex' : 'none';
    $('pbBack').style.display = '';
    $('pbBackLabel').textContent = photos.some(Boolean) ? t('pb.batal') : t('pb.kembali');
    markNext(-1);
    aturZonaAman(-1);
  }
  function openPhoto() {
    $('pbIntro').textContent = t('pb.intro', { n: SHOTS, s: COUNTDOWN() });
    pbToken++; running = false; busy = false;
    photos.fill(null);
    ed = fresh();
    $('peShowText').checked = true;
    aturZonaAman(-1);
    // Muat template couple sekarang: rasionya dipakai untuk zona aman saat difoto
    siapTemplate = muatTemplateCouple().then(() => { const p = pilihanLayout(); if (!p[ed.layout]) ed.layout = Object.keys(p)[0]; });
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
  function disarmCancel() { clearTimeout(cancelArmed); cancelArmed = null; }
  function backFromPhoto() {
    if (photos.some(Boolean)) {                     // sudah ada foto: tekan dua kali untuk membatalkan
      if (!cancelArmed) {
        $('pbBackLabel').textContent = t('pb.yakin');
        cancelArmed = setTimeout(() => { disarmCancel(); showDone(); }, 3000);
        return;
      }
      disarmCancel();
    }
    pbToken++; photos.fill(null);
    show('utama');
  }

  /* =====================================================================
     Halaman Edit Photo
     ===================================================================== */
  const LAYOUTS = {
    grid:  { get name() { return t('layout.grid'); }, W: 1200, H: 1800,
             slots() { const m = 60, g = 30, w = (1200 - 2 * m - g) / 2, h = 656;
               return [[m, m], [m + w + g, m], [m, m + h + g], [m + w + g, m + h + g]].map(([x, y]) => ({ x, y, w, h })); },
             text: { y: 1560, name: 84, date: 36 } },
    strip: { get name() { return t('layout.strip'); }, W: 600, H: 1800,
             slots() { const m = 40, g = 24, w = 520, h = 362; return [0, 1, 2, 3].map(i => ({ x: m, y: m + i * (h + g), w, h })); },
             text: { y: 1655, name: 46, date: 22 } },
    big:   { get name() { return t('layout.big'); }, W: 1200, H: 1800,
             slots() { const m = 60, g = 24, W = 1080, bh = 780, sw = (W - 2 * g) / 3, sh = 470;
               return [{ x: m, y: m, w: W, h: bh }, ...[0, 1, 2].map(i => ({ x: m + i * (sw + g), y: m + bh + g, w: sw, h: sh }))]; },
             text: { y: 1560, name: 84, date: 36 } },
  };
  const FILTERS = [
    ['none', 'Normal', 'none'],
    ['bw', 'Hitam putih', 'grayscale(1) contrast(1.12)'],
    ['warm', 'Hangat', 'sepia(.22) saturate(1.18) brightness(1.04)'],
    ['soft', 'Lembut', 'brightness(1.08) contrast(.9) saturate(.9)'],
    ['vintage', 'Vintage', 'sepia(.45) contrast(.92) brightness(1.05) saturate(.85)'],
    ['bright', 'Cerah', 'brightness(1.12) saturate(1.12) contrast(1.04)'],
  ];
  const accent = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#B08D57';
  const FRAMES = () => [
    ['#FFFFFF', 'Putih', '#1D1D1F'], ['#F3EDE4', 'Krem', '#3A2E25'], ['#F6E1E3', 'Blush', '#5B3A40'],
    ['#E3EBE1', 'Sage', '#2F4030'], ['#1D1D1F', 'Hitam', '#FFFFFF'], [accent(), 'Aksen', '#FFFFFF'],
  ];
  const STICKERS = ['💍', '❤️', '💕', '✨', '🥂', '🎉', '👑', '💐', '🌸', '🕊️', '😘', '😎', '🎀', '💒', '⭐', '🥳'];
  const COLORS = ['#FFFFFF', '#1D1D1F', '#FF3B30', '#FF9F0A', '#34C759', '#0A84FF', '#AF52DE'];
  const SIZES = [5, 10, 18];
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif';
  const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  // Template buatan admin untuk couple aktif (dimuat saat halaman Edit dibuka)
  let tplLays = {};
  const L = () => LAYOUTS[ed.layout] || tplLays[ed.layout] || LAYOUTS.grid;
  // Tamu hanya memakai layout dari admin. Layout bawaan dipakai kalau admin belum membuat template.
  const adaTemplate = () => Object.keys(tplLays).length > 0;
  const pilihanLayout = () => (adaTemplate() ? tplLays : LAYOUTS);
  async function muatTemplateCouple() {
    tplLays = {};
    if (!activeCouple || !api.listTemplates) return;
    try {
      for (const t of await api.listTemplates(activeCouple.id))
        tplLays['tpl:' + t.id] = { name: t.nama, W: t.W, H: t.H, tpl: true, siap: await siapkanTemplate(t) };
    } catch (err) { console.log('Gagal memuat template: ' + err.message); }
  }

  // Foto mengisi kotaknya (dipotong di tengah, tidak gepeng)
  function drawCover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const sw = w / s, sh = h / s;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  }
  const dateText = () => tanggalHariIni();

  // Lapisan dasar: bingkai, foto dengan filter, nama & tanggal
  function renderBase(ctx, lay, scale = 1, filterKey = ed.filter) {
    if (lay.tpl) return gambarTemplate(ctx, lay.siap, { scale, photos, filter: FILTERS.find(x => x[0] === filterKey)[2] });
    const [bg, , fg] = FRAMES()[ed.frame];
    ctx.save(); ctx.scale(scale, scale);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, lay.W, lay.H);
    const f = FILTERS.find(x => x[0] === filterKey)[2];
    lay.slots().forEach((s, i) => {
      if (!photos[i]) return;
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(s.x, s.y, s.w, s.h, 8); else ctx.rect(s.x, s.y, s.w, s.h);
      ctx.clip();
      ctx.filter = f;
      drawCover(ctx, photos[i], s.x, s.y, s.w, s.h);
      ctx.restore();
    });
    if (ed.showText) {
      ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = `700 ${lay.text.name}px ${FONT}`;
      ctx.fillText(activeCouple ? activeCouple.name : '', lay.W / 2, lay.text.y, lay.W - 80);
      ctx.globalAlpha = .72;
      ctx.font = `500 ${lay.text.date}px ${FONT}`;
      ctx.fillText(dateText(), lay.W / 2, lay.text.y + lay.text.date * 1.9, lay.W - 80);
    }
    ctx.restore();
  }
  function renderStrokes(ctx, lay, scale = 1) {
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const st of ed.strokes) {
      ctx.strokeStyle = st.color; ctx.lineWidth = st.w * lay.W * scale;
      ctx.beginPath();
      st.pts.forEach(([x, y], k) => k ? ctx.lineTo(x * lay.W * scale, y * lay.H * scale) : ctx.moveTo(x * lay.W * scale, y * lay.H * scale));
      if (st.pts.length === 1) ctx.lineTo(st.pts[0][0] * lay.W * scale + .1, st.pts[0][1] * lay.H * scale);
      ctx.stroke();
    }
    ctx.restore();
  }
  function renderStickers(ctx, lay, scale = 1) {
    for (const s of ed.stickers) {
      ctx.save();
      ctx.translate(s.x * lay.W * scale, s.y * lay.H * scale);
      ctx.rotate(s.rot * Math.PI / 180);
      ctx.font = `${s.size * lay.W * scale}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(s.ch, 0, 0);
      ctx.restore();
    }
  }

  /* ---- Pratinjau ---- */
  function fitStage() {
    const st = $('peStage').getBoundingClientRect(), lay = L();
    const k = Math.min((st.width - 48) / lay.W, (st.height - 48) / lay.H);
    const box = $('peBox');
    box.style.width = Math.floor(lay.W * k) + 'px';
    box.style.height = Math.floor(lay.H * k) + 'px';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const id of ['peCanvas', 'peDraw']) {
      const c = $(id); c.width = Math.round(lay.W * k * dpr); c.height = Math.round(lay.H * k * dpr);
    }
    redraw(); placeStickers();
  }
  const previewScale = () => $('peCanvas').width / L().W;
  function redraw() {
    const c = $('peCanvas'), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    renderBase(ctx, L(), previewScale());
    redrawInk();
  }
  function redrawInk() {
    const c = $('peDraw'), ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    renderStrokes(ctx, L(), previewScale());
  }

  /* ---- Pilihan di panel ---- */
  function mini(lay) {
    const c = document.createElement('canvas'), k = 150 / lay.W;
    c.width = 150; c.height = Math.round(lay.H * k);
    renderBase(c.getContext('2d'), lay, k);
    return c;
  }
  function option(container, on, content, label, onClick) {
    const b = document.createElement('button');
    b.className = 'pe-opt' + (on ? ' on' : '');
    if (typeof content === 'string') b.innerHTML = content; else b.appendChild(content);
    b.insertAdjacentText('beforeend', label);
    b.onclick = onClick;
    container.appendChild(b);
  }
  function buildPanel() {
    const lays = $('peLayouts'); lays.innerHTML = '';
    for (const [key, lay] of Object.entries(pilihanLayout()))
      option(lays, ed.layout === key, mini(lay), lay.name, () => { ed.layout = key; fitStage(); buildPanel(); });
    const pakaiTpl = !!L().tpl;
    $('peFrameNormal').style.display = pakaiTpl ? 'none' : '';
    $('peFrameHint').style.display = pakaiTpl ? 'block' : 'none';

    const fil = $('peFilters'); fil.innerHTML = '';
    for (const [key, , f] of FILTERS) {
      const name = t('filter.' + key);
      const c = document.createElement('canvas'); c.width = 150; c.height = 150;
      const cx = c.getContext('2d'); cx.filter = f; drawCover(cx, photos[0], 0, 0, 150, 150);
      option(fil, ed.filter === key, c, name, () => { ed.filter = key; redraw(); buildPanel(); });
    }

    const fr = $('peFrames'); fr.innerHTML = '';
    FRAMES().forEach(([bg], i) =>
      option(fr, ed.frame === i, `<span class="pe-sw" style="background:${bg}"></span>`, t('bingkai.' + i), () => { ed.frame = i; redraw(); buildPanel(); }));

    const sl = $('peStickerList');
    if (!sl.childElementCount) for (const ch of STICKERS) {
      const b = document.createElement('button'); b.className = 'pe-stk'; b.textContent = ch; b.style.fontFamily = EMOJI_FONT;
      b.onclick = () => addSticker(ch);
      sl.appendChild(b);
    }

    const cl = $('peColors'); cl.innerHTML = '';
    for (const col of [...COLORS, accent()]) {
      const b = document.createElement('button'); b.className = 'pe-dot' + (ed.color === col ? ' on' : '');
      b.style.background = col; b.setAttribute('aria-label', 'Warna ' + col);
      b.onclick = () => { ed.color = col; buildPanel(); };
      cl.appendChild(b);
    }
    const sz = $('peSizes'); sz.innerHTML = '';
    for (const s of SIZES) {
      const b = document.createElement('button'); b.className = 'pe-size' + (ed.size === s ? ' on' : '');
      b.innerHTML = `<i style="width:${s + 4}px;height:${s + 4}px"></i>`;
      b.onclick = () => { ed.size = s; buildPanel(); };
      sz.appendChild(b);
    }
  }
  function setTab(tab) {
    ed.tab = tab;
    document.querySelectorAll('.pe-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
    document.querySelectorAll('.pe-pane').forEach(p => p.classList.toggle('on', p.dataset.pane === tab));
    $('peBox').classList.toggle('drawing', tab === 'draw');
    if (tab === 'draw') select(null);
  }

  /* ---- Stiker ---- */
  let stkSeq = 0;
  function addSticker(ch) {
    const s = { id: ++stkSeq, ch, x: .5, y: .4 + (ed.stickers.length % 5) * .04, size: .14, rot: 0 };
    ed.stickers.push(s); select(s.id); resetIdle();
  }
  const selected = () => ed.stickers.find(s => s.id === ed.sel);
  function select(id) { ed.sel = id; placeStickers(); }
  function placeStickers() {
    const box = $('peStickers'), bw = $('peBox').getBoundingClientRect().width;
    box.innerHTML = '';
    for (const s of ed.stickers) {
      const el = document.createElement('div');
      el.className = 'pe-sticker' + (s.id === ed.sel ? ' sel' : '');
      el.textContent = s.ch; el.dataset.id = s.id; el.style.fontFamily = EMOJI_FONT;
      el.style.left = (s.x * 100) + '%'; el.style.top = (s.y * 100) + '%';
      el.style.fontSize = (s.size * bw) + 'px'; el.style.setProperty('--r', s.rot + 'deg');
      attachGestures(el, s);
      box.appendChild(el);
    }
  }
  // Geser dengan satu jari, perbesar & putar dengan dua jari
  function attachGestures(el, s) {
    const pts = new Map(); let start = null;
    const snapshot = () => {
      const p = [...pts.values()], two = p.length >= 2;
      return { x: s.x, y: s.y, size: s.size, rot: s.rot,
               d: two ? Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) : 0,
               a: two ? Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x) : 0,
               mid: two ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } : p[0] };
    };
    el.addEventListener('pointerdown', e => {
      e.stopPropagation(); el.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ed.sel !== s.id) { ed.sel = s.id; document.querySelectorAll('.pe-sticker').forEach(x => x.classList.toggle('sel', Number(x.dataset.id) === s.id)); }
      start = snapshot(); resetIdle();
    });
    el.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId) || !start) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = $('peBox').getBoundingClientRect(), now = snapshot();
      if (pts.size >= 2 && !start.d) start = { ...now, x: s.x, y: s.y };   // jari kedua baru menyentuh
      s.x = Math.min(1, Math.max(0, start.x + (now.mid.x - start.mid.x) / r.width));
      s.y = Math.min(1, Math.max(0, start.y + (now.mid.y - start.mid.y) / r.height));
      if (pts.size >= 2 && start.d) {
        s.size = Math.min(.6, Math.max(.04, start.size * now.d / start.d));
        s.rot = start.rot + (now.a - start.a) * 180 / Math.PI;
        el.style.fontSize = (s.size * r.width) + 'px'; el.style.setProperty('--r', s.rot + 'deg');
      }
      el.style.left = (s.x * 100) + '%'; el.style.top = (s.y * 100) + '%';
    });
    const up = e => { pts.delete(e.pointerId); start = pts.size ? snapshot() : null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }
  function tweakSticker(fn) {
    const s = selected();
    if (!s) { setNotice(t('pb.pilihStiker'), 4000); return; }
    fn(s); placeStickers();
  }

  /* ---- Coret ---- */
  function attachDrawing() {
    const c = $('peDraw'); let cur = null;
    const pos = e => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      cur = { color: ed.color, w: ed.size / 1200, pts: [pos(e)] };
      ed.strokes.push(cur); redrawInk(); resetIdle();
    });
    c.addEventListener('pointermove', e => { if (!cur) return; cur.pts.push(pos(e)); redrawInk(); });
    const end = () => { cur = null; };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  }

  async function openEdit() {
    await muatTemplateCouple();
    if (!pilihanLayout()[ed.layout]) ed.layout = Object.keys(pilihanLayout())[0];
    // Tab Layout hanya tampil kalau ada lebih dari satu pilihan; tab Bingkai hanya untuk layout bawaan
    const tampil = { layout: Object.keys(pilihanLayout()).length > 1, frame: !adaTemplate() };
    document.querySelectorAll('#peTabs .pe-tab').forEach(t => { t.style.display = tampil[t.dataset.tab] === false ? 'none' : ''; });
    if (tampil[ed.tab] === false) ed.tab = tampil.layout ? 'layout' : 'filter';
    show('editphoto');
    buildPanel(); setTab(ed.tab || 'layout');
    requestAnimationFrame(fitStage);
  }

  /* ---- Selesai: buat gambar akhir lalu simpan ---- */
  const toBytes = (c, q) => new Promise((res, rej) => c.toBlob(async b => {
    if (!b) return rej(new Error('Gagal membuat file JPG'));
    res(new Uint8Array(await b.arrayBuffer()));
  }, 'image/jpeg', q));
  let saving = false;
  async function finishEdit() {
    if (saving) return;
    saving = true; busy = true;
    const lay = L();
    const out = document.createElement('canvas'); out.width = lay.W; out.height = lay.H;
    const ctx = out.getContext('2d');
    renderBase(ctx, lay); renderStrokes(ctx, lay); renderStickers(ctx, lay);

    $('savingTitle').textContent = t('simpan.foto');
    const bar = $('saveBar'); bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run');
    show('saving');
    let ok = false, err = '', link = null;
    const work = (async () => {
      const originals = [];
      for (const p of photos) originals.push(p._asli || await toBytes(p, 0.95));   // Sony: file asli kamera
      const result = await toBytes(out, 0.93);
      const r = await api.savePhotos({ originals, result, tamu: namaTamu,
        meta: { layout: lay.tpl ? 'template' : ed.layout, template: lay.tpl ? lay.name : undefined, filter: ed.filter, frame: lay.tpl ? undefined : FRAMES()[ed.frame][1], stickers: ed.stickers.length, drawings: ed.strokes.length } });
      ok = !!(r && r.ok); err = r && r.error; link = r && r.link;
    })().catch(e => { err = e.message; });
    await Promise.all([sleep(3000), Promise.race([work, sleep(15000)])]);
    $('savingTitle').textContent = t('simpan.rekaman');

    setThanks(ok);
    $('thanksMsg').textContent = ok ? t('tk.fotoOk') : t('tk.fotoGagal');
    if (!ok) setNotice('Foto gagal disimpan: ' + (err || 'waktu habis'), 15000);
    const tp = $('thanksPhoto');
    if (ok) { tp.src = out.toDataURL('image/jpeg', .8); tp.style.display = 'block'; $('thanksBadge').style.display = 'none'; }
    if (ok && link) tampilkanQR(link);
    photos.fill(null);
    saving = false; busy = false;
    show('thanks');
  }

  /* ---------------- Sambungan tombol (dipanggil sekali dari mulai.js) ---------------- */
  window.pasangPhotobooth = function () {
    $('btnToPhoto').onclick = openPhoto;
    $('pbStart').onclick = startSession;
    $('pbBack').onclick = backFromPhoto;
    $('pbFinish').onclick = () => { if (photos.every(Boolean) && !running) openEdit(); };
    $('peBack').onclick = () => { show('photo'); showDone(); };
    $('peDone').onclick = finishEdit;
    document.querySelectorAll('.pe-tab').forEach(t => t.onclick = () => setTab(t.dataset.tab));
    $('peShowText').onchange = e => { ed.showText = e.target.checked; redraw(); buildPanel(); };
    $('peStkSmaller').onclick = () => tweakSticker(s => { s.size = Math.max(.04, s.size * .8); });
    $('peStkBigger').onclick = () => tweakSticker(s => { s.size = Math.min(.6, s.size * 1.25); });
    $('peStkRotate').onclick = () => tweakSticker(s => { s.rot += 15; });
    $('peStkDelete').onclick = () => tweakSticker(s => { ed.stickers = ed.stickers.filter(x => x !== s); ed.sel = null; });
    $('peUndo').onclick = () => { ed.strokes.pop(); redrawInk(); };
    $('peClear').onclick = () => { ed.strokes = []; redrawInk(); };
    $('peBox').addEventListener('pointerdown', e => { if (e.target.id === 'peCanvas' || e.target.id === 'peStickers') select(null); });
    attachDrawing();
    window.addEventListener('resize', () => { if ($('editphoto').classList.contains('on')) fitStage(); aturZonaAman(); });
    // Ukuran gambar kamera baru diketahui setelah gambar pertama datang: perbarui zona aman
    setInterval(() => { if (amanIdx >= 0) aturZonaAman(); }, 500);
  };
})();
