/* =====================================================================
   Photo Booth: halamanPhoto (4 foto + hitung mundur) & halamanEditPhoto
   Memakai fungsi bersama dari index.html: $, show, sleep, busy, resetIdle,
   noCam, activeCouple, setNotice, setThanks, needStream, SCREENS.
   Pengambil foto ada di grabFrame(). Nanti kalau SDK kamera sudah siap,
   cukup fungsi ini yang diganti (jepret kamera + flash), sisanya tetap.
   ===================================================================== */
(() => {
  const SHOTS = 4;            // jumlah foto per sesi
  const COUNTDOWN = 5;        // detik hitung mundur sebelum setiap foto

  /* ---------------- Markup ---------------- */
  document.body.insertAdjacentHTML('beforeend', `
  <div class="screen" id="photo">
    <button class="chip left" id="pbBack"><svg class="i"><use href="#i-back"/></svg><span id="pbBackLabel">Kembali</span></button>
    <div class="rec pb-pill" id="pbPill" style="display:none"><svg class="i"><use href="#i-camera"/></svg><span id="pbPillText"></span></div>
    <div class="part" id="pbPre">
      <div class="card glass"><h1>Photo booth</h1>
        <p>Kamu akan difoto ${SHOTS} kali. Sebelum setiap foto ada hitungan mundur ${COUNTDOWN} detik, jadi siapkan gayamu.</p></div>
      <div class="row"><button id="pbStart" class="btn primary"><svg class="i"><use href="#i-camera"/></svg>Mulai</button></div>
    </div>
    <div class="pb-bottom" id="pbBottom" style="display:none">
      <div class="row pb-actions" id="pbActions" style="display:none">
        <button id="pbFinish" class="btn primary"><svg class="i"><use href="#i-wand"/></svg>Finish &amp; edit</button>
      </div>
      <div class="pb-strip glass" id="pbStrip"></div>
    </div>
  </div>

  <div class="screen mid" id="editphoto">
    <div class="pe-wrap">
      <div class="pe-stage glass" id="peStage">
        <div class="pe-box" id="peBox"><canvas id="peCanvas"></canvas><canvas id="peDraw"></canvas><div id="peStickers"></div></div>
      </div>
      <div class="sheet glass pe-panel">
        <div class="sheet-head">
          <button id="peBack" class="btn sm tint"><svg class="i"><use href="#i-back"/></svg>Foto</button>
          <h2>Edit foto</h2>
          <button id="peDone" class="btn sm primary">Selesai</button>
        </div>
        <div class="pe-tabs" id="peTabs">
          <button class="pe-tab on" data-tab="layout"><svg class="i"><use href="#i-layout"/></svg>Layout</button>
          <button class="pe-tab" data-tab="filter"><svg class="i"><use href="#i-drop"/></svg>Filter</button>
          <button class="pe-tab" data-tab="frame"><svg class="i"><use href="#i-frame"/></svg>Bingkai</button>
          <button class="pe-tab" data-tab="sticker"><svg class="i"><use href="#i-smile"/></svg>Stiker</button>
          <button class="pe-tab" data-tab="draw"><svg class="i"><use href="#i-pen"/></svg>Coret</button>
        </div>
        <div class="sheet-body">
          <div class="pe-pane on" data-pane="layout"><div class="pe-sec">Susunan foto</div><div class="pe-grid" id="peLayouts"></div></div>
          <div class="pe-pane" data-pane="filter"><div class="pe-sec">Filter untuk semua foto</div><div class="pe-grid" id="peFilters"></div></div>
          <div class="pe-pane" data-pane="frame">
            <div class="pe-sec">Warna bingkai</div><div class="pe-grid" id="peFrames"></div>
            <div class="group" style="margin-top:16px"><div class="item split" style="justify-content:space-between">
              <span style="width:auto">Nama couple &amp; tanggal</span>
              <label class="switch"><input type="checkbox" id="peShowText" checked><i></i></label></div></div>
          </div>
          <div class="pe-pane" data-pane="sticker">
            <div class="pe-sec">Ketuk untuk menambahkan</div><div class="pe-grid" id="peStickerList" style="grid-template-columns:repeat(4,1fr)"></div>
            <div class="pe-sec">Stiker terpilih</div>
            <div class="pe-row">
              <button class="btn sm tint" id="peStkSmaller">Perkecil</button>
              <button class="btn sm tint" id="peStkBigger">Perbesar</button>
              <button class="btn sm tint" id="peStkRotate">Putar</button>
              <button class="btn sm tint danger" id="peStkDelete"><svg class="i"><use href="#i-trash"/></svg>Hapus</button>
            </div>
            <p class="pe-hint">Geser stiker dengan jari. Pakai dua jari untuk memperbesar dan memutar.</p>
          </div>
          <div class="pe-pane" data-pane="draw">
            <div class="pe-sec">Warna</div><div class="pe-row" id="peColors"></div>
            <div class="pe-sec">Ukuran</div><div class="pe-row" id="peSizes"></div>
            <div class="pe-row" style="margin-top:16px">
              <button class="btn sm tint" id="peUndo"><svg class="i"><use href="#i-undo"/></svg>Urungkan</button>
              <button class="btn sm tint danger" id="peClear">Hapus semua</button>
            </div>
            <p class="pe-hint">Tulis ucapan atau tanda tangan langsung di foto dengan jari.</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="pb-count" id="pbCount"><div class="glass"><span id="pbCountNum">5</span></div></div>
  <div id="pbFlash"></div>`);
  SCREENS.push('photo', 'editphoto');

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
  async function snap() {
    const fl = $('pbFlash');
    fl.classList.remove('go'); fl.classList.add('on');   // layar putih sesaat sebagai "flash"
    await sleep(90);
    try { return grabFrame(); }
    finally { fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('go'); }
  }
  async function countdown(token) {
    $('pbCount').style.display = 'flex';
    for (let i = COUNTDOWN; i >= 1; i--) {
      $('pbCountNum').textContent = i;
      await sleep(1000);
      if (token !== pbToken) { $('pbCount').style.display = 'none'; return false; }
    }
    $('pbCount').style.display = 'none';
    return true;
  }
  function thumbURL(c) {
    const t = document.createElement('canvas');
    t.width = 480; t.height = Math.round(480 * c.height / c.width);
    t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
    return t.toDataURL('image/jpeg', 0.85);
  }

  /* ---------------- Deretan foto di bawah (kiri = foto 1, kanan = foto terakhir) ---------------- */
  function buildStrip() {
    const s = $('pbStrip'); s.innerHTML = '';
    for (let i = 0; i < SHOTS; i++) {
      const slot = document.createElement('div'); slot.className = 'pb-slot';
      slot.innerHTML = `<div class="pb-thumb" id="pbThumb${i}"><span class="empty">${i + 1}</span></div>
        <button class="btn sm glassy" data-redo="${i}"><svg class="i"><use href="#i-retry"/></svg>Ulangi</button>`;
      s.appendChild(slot);
    }
    s.querySelectorAll('[data-redo]').forEach(b => b.onclick = () => shoot([Number(b.dataset.redo)]));
  }
  function renderSlot(i) {
    const el = $('pbThumb' + i);
    if (!photos[i]) { el.classList.remove('filled'); el.innerHTML = `<span class="empty">${i + 1}</span>`; return; }
    el.classList.add('filled');
    el.innerHTML = `<img alt="Foto ${i + 1}" src="${thumbURL(photos[i])}"><span class="n">${i + 1}</span>`;
  }
  function markNext(i) { for (let k = 0; k < SHOTS; k++) $('pbThumb' + k).classList.toggle('next', k === i); }

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
    if (noCam) { setNotice('Photo booth butuh kamera. Sambungkan kamera lalu pilih di Admin.', 8000); return; }
    const token = ++pbToken;
    disarmCancel();
    busy = true; resetIdle();
    setRunningUI(true);
    try {
      for (const i of indices) {
        $('pbPillText').textContent = indices.length === 1 ? `Ulangi foto ${i + 1}` : `Foto ${i + 1} dari ${SHOTS}`;
        markNext(i);
        if (!(await countdown(token))) return;
        photos[i] = await snap();
        renderSlot(i);
        await sleep(600);
        if (token !== pbToken) return;
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
    $('pbBackLabel').textContent = photos.some(Boolean) ? 'Batal' : 'Kembali';
    markNext(-1);
  }
  function openPhoto() {
    pbToken++; running = false; busy = false;
    photos.fill(null);
    ed = fresh();
    $('peShowText').checked = true;
    buildStrip();
    $('pbPre').style.display = 'flex';
    $('pbBottom').style.display = 'none';
    $('pbPill').style.display = 'none';
    $('pbBack').style.display = '';
    $('pbBackLabel').textContent = 'Kembali';
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
        $('pbBackLabel').textContent = 'Yakin batal?';
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
    grid:  { name: 'Kisi 2×2', W: 1200, H: 1800,
             slots() { const m = 60, g = 30, w = (1200 - 2 * m - g) / 2, h = 656;
               return [[m, m], [m + w + g, m], [m, m + h + g], [m + w + g, m + h + g]].map(([x, y]) => ({ x, y, w, h })); },
             text: { y: 1560, name: 84, date: 36 } },
    strip: { name: 'Strip', W: 600, H: 1800,
             slots() { const m = 40, g = 24, w = 520, h = 362; return [0, 1, 2, 3].map(i => ({ x: m, y: m + i * (h + g), w, h })); },
             text: { y: 1655, name: 46, date: 22 } },
    big:   { name: '1 besar + 3', W: 1200, H: 1800,
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
  const L = () => LAYOUTS[ed.layout];

  // Foto mengisi kotaknya (dipotong di tengah, tidak gepeng)
  function drawCover(ctx, img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const sw = w / s, sh = h / s;
    ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
  }
  const dateText = () => new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  // Lapisan dasar: bingkai, foto dengan filter, nama & tanggal
  function renderBase(ctx, lay, scale = 1, filterKey = ed.filter) {
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
    for (const [key, lay] of Object.entries(LAYOUTS))
      option(lays, ed.layout === key, mini(lay), lay.name, () => { ed.layout = key; fitStage(); buildPanel(); });

    const fil = $('peFilters'); fil.innerHTML = '';
    for (const [key, name, f] of FILTERS) {
      const c = document.createElement('canvas'); c.width = 150; c.height = 150;
      const cx = c.getContext('2d'); cx.filter = f; drawCover(cx, photos[0], 0, 0, 150, 150);
      option(fil, ed.filter === key, c, name, () => { ed.filter = key; redraw(); buildPanel(); });
    }

    const fr = $('peFrames'); fr.innerHTML = '';
    FRAMES().forEach(([bg, name], i) =>
      option(fr, ed.frame === i, `<span class="pe-sw" style="background:${bg}"></span>`, name, () => { ed.frame = i; redraw(); buildPanel(); }));

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
    if (!s) { setNotice('Ketuk stiker di foto dulu untuk memilihnya.', 4000); return; }
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

  function openEdit() {
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

    $('savingTitle').textContent = 'Menyimpan fotomu';
    const bar = $('saveBar'); bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run');
    show('saving');
    let ok = false, err = '';
    const work = (async () => {
      const originals = [];
      for (const p of photos) originals.push(await toBytes(p, 0.95));
      const result = await toBytes(out, 0.93);
      const r = await api.savePhotos({ originals, result,
        meta: { layout: ed.layout, filter: ed.filter, frame: FRAMES()[ed.frame][1], stickers: ed.stickers.length, drawings: ed.strokes.length } });
      ok = !!(r && r.ok); err = r && r.error;
    })().catch(e => { err = e.message; });
    await Promise.all([sleep(3000), Promise.race([work, sleep(15000)])]);
    $('savingTitle').textContent = 'Menyimpan rekamanmu';

    setThanks(ok);
    $('thanksMsg').textContent = ok ? 'Fotomu sudah tersimpan.' : 'Fotomu belum berhasil tersimpan. Silakan hubungi petugas.';
    if (!ok) setNotice('Foto gagal disimpan: ' + (err || 'waktu habis'), 15000);
    const tp = $('thanksPhoto');
    if (ok) { tp.src = out.toDataURL('image/jpeg', .8); tp.style.display = 'block'; $('thanksBadge').style.display = 'none'; }
    photos.fill(null);
    saving = false; busy = false;
    show('thanks');
  }

  /* ---------------- Sambungan tombol ---------------- */
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
  window.addEventListener('resize', () => { if ($('editphoto').classList.contains('on')) fitStage(); });

  // Halaman Terima kasih untuk video tidak menampilkan foto
  const baseSetThanks = window.setThanks;
  window.setThanks = function (result) {
    $('thanksPhoto').style.display = 'none'; $('thanksBadge').style.display = '';
    return baseSetThanks(result);
  };
})();
