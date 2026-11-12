/* =====================================================================
   api-demo.js — Leura versi DEMO untuk browser HP (presentasi ke klien)
   Menggantikan bagian Mac (preload.js + folder main/) dengan versi browser:
   - Kamera depan HP, rekaman & foto disimpan di HP itu (IndexedDB).
     Hanya foto hasil photobooth yang dikirim ke server demo (untuk QR).
   - Admin bisa dibuka (ID: leura, password: 1234). Perubahan hanya di HP ini.
   - QR unduh foto jalan sungguhan (lewat demo/server.mjs, foto disimpan 1 hari).
   - Yang tidak ada di demo: kamera Sony, MP4,
     folder penyimpanan, ganti password, tutup aplikasi.
   File ini dimuat SEBELUM src/state.js. Kode aplikasi aslinya tidak diubah.
   ===================================================================== */
(function () {
  'use strict';
  const DEMO = 'Not available in the demo.';
  const MAKS_SESI = 20; // sesi terlama dihapus supaya memori HP tidak penuh

  /* ---------- Penyimpanan kecil di HP (IndexedDB) ---------- */
  let dbJanji = null;
  function db() {
    if (!dbJanji)
      dbJanji = new Promise((ok, gagal) => {
        const r = indexedDB.open('leura-demo', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => ok(r.result);
        r.onerror = () => gagal(r.error);
      });
    return dbJanji;
  }
  async function ambil(k, bawaan) {
    try {
      const d = await db();
      return await new Promise(ok => {
        const q = d.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => ok(q.result === undefined ? bawaan : q.result);
        q.onerror = () => ok(bawaan);
      });
    } catch {
      return bawaan;
    }
  }
  async function simpan(k, v) {
    try {
      const d = await db();
      await new Promise(ok => {
        const t = d.transaction('kv', 'readwrite');
        v === undefined ? t.objectStore('kv').delete(k) : t.objectStore('kv').put(v, k);
        t.oncomplete = t.onerror = () => ok();
      });
    } catch {
      /* demo: penyimpanan HP penuh/diblokir — data hanya hilang di HP itu */
    }
  }
  const salinan = x => JSON.parse(JSON.stringify(x));

  /* ---------- Data awal ---------- */
  const PERTANYAAN = [
    'Where did Rina and Dimas first meet?',
    'What are your wishes for their marriage?',
    'Share a funny memory with the couple!',
  ];
  const ST_AWAL = {
    quizSeconds: 20,
    quizRounds: 2,
    messageCountdown: 3,
    messageMaxSeconds: 30,
    photoCountdown: 3,
    photoPreview: 2,
    enableMessage: true,
    enableQuiz: true,
    enablePhoto: true,
    photoFlash: true,
    askName: true,
    kiosk: false,
    camera: 'webcam',
    language: 'en',
    accent: '#B08D57',
    loginId: 'leura',
  };
  const BATAS = {
    quizSeconds: [10, 300],
    quizRounds: [1, 10],
    messageCountdown: [0, 10],
    messageMaxSeconds: [0, 600],
    photoCountdown: [2, 10],
    photoPreview: [0, 5],
  };
  const idBaru = p => p + Date.now() + Math.random().toString(36).slice(2, 6);
  // Demo data saved on this phone by an older version (Indonesian names), same as main/migrate.js
  const OLD_NAMES = {
    settings: {
      pesanCountdown: 'messageCountdown',
      pesanMaxSeconds: 'messageMaxSeconds',
      enablePesan: 'enableMessage',
      tanyaNama: 'askName',
      kamera: 'camera',
      bahasa: 'language',
    },
    template: {
      nama: 'name',
      ukuran: 'size',
      latarWarna: 'backgroundColor',
      rasio: 'ratio',
      filterKekuatan: 'filterStrength',
      filterTamu: 'guestPicksFilter',
      dibuat: 'created',
      diubah: 'changed',
      latarUrl: 'backgroundUrl',
      bingkaiUrl: 'frameUrl',
    },
    session: { tamu: 'guest', kode: 'code', unggah: 'upload', bingkai: 'frame' },
    filter: { nama: 'name', dibuat: 'created' },
  };
  const OLD_VALUES = {
    size: { '4r-tegak': '4r-portrait', '4r-datar': '4r-landscape', persegi: 'square' },
    label: { pesan: 'message', foto: 'photo' },
    upload: { antre: 'queued', menunggu: 'waiting', terkirim: 'sent' },
  };
  function updateOldDemoData(obj, names) {
    let changed = false;
    if (!obj || typeof obj !== 'object') return false;
    for (const [from, to] of Object.entries(names))
      if (from in obj) {
        obj[to] = obj[from];
        delete obj[from];
        changed = true;
      }
    for (const [key, map] of Object.entries(OLD_VALUES))
      if (typeof obj[key] === 'string' && Object.hasOwn(map, obj[key])) {
        obj[key] = map[obj[key]];
        changed = true;
      }
    return changed;
  }
  async function updateOldDemoList(key, names) {
    const list = await ambil(key, null);
    if (!Array.isArray(list)) return list;
    if (list.map(x => updateOldDemoData(x, names)).some(Boolean)) await simpan(key, list);
    return list;
  }
  let ST, CP, TPL, SESI;
  const siap = (async () => {
    const savedSettings = await ambil('settings', {});
    if (updateOldDemoData(savedSettings, OLD_NAMES.settings)) await simpan('settings', savedSettings);
    ST = { ...ST_AWAL, ...savedSettings };
    CP = await ambil('couples', null);
    if (CP && CP.couples && CP.couples.map(c => updateOldDemoData(c.menu, { pesan: 'message' })).some(Boolean))
      await simpan('couples', CP);
    await updateOldDemoList('filters', OLD_NAMES.filter);
    if (!CP) {
      const id = idBaru('c');
      CP = {
        activeId: id,
        couples: [
          {
            id,
            name: 'Rina & Dimas',
            welcome: 'Leave us a message',
            questions: PERTANYAAN,
            menu: { message: true, quiz: true, photo: true },
          },
        ],
      };
    }
    TPL = (await updateOldDemoList('templates', OLD_NAMES.template)) || [];
    SESI = (await updateOldDemoList('sessions', OLD_NAMES.session)) || [];
  })();
  const coupleAktif = () => CP.couples.find(c => c.id === CP.activeId) || CP.couples[0];

  /* ---------- Catatan (log) sederhana ---------- */
  const LOG = [];
  const jam = () => new Date().toTimeString().slice(0, 8);
  const catat = (p, t = 'info') => {
    LOG.push(`${jam()} ${t === 'error' ? '✗' : t === 'peringatan' ? '⚠' : ' '} ${p}`);
    if (LOG.length > 400) LOG.shift();
  };
  catat('────────── Leura demo dibuka ──────────');
  catat(navigator.userAgent);
  addEventListener('error', e => catat('Error: ' + e.message, 'error'));

  /* ---------- Bantuan ---------- */
  const pesanLayar = teks => {
    try {
      if (window.__leura) window.__leura.setNotice(teks, 3500);
    } catch {
      /* demo: notifikasi hanya pelengkap */
    }
  };
  const urlCache = new Map();
  const urlMedia = async id => {
    if (urlCache.has(id)) return urlCache.get(id);
    const b = await ambil('media:' + id, null);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urlCache.set(id, u);
    return u;
  };
  const namaFile = s =>
    String(s || '')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 40);
  async function tambahSesi(sesi, blob) {
    SESI.push(sesi);
    if (blob) await simpan('media:' + sesi.id, blob);
    while (SESI.length > MAKS_SESI) {
      const lama = SESI.shift();
      await simpan('media:' + lama.id, undefined);
      await simpan('thumb:' + lama.id, undefined);
    }
    await simpan('sessions', SESI);
  }

  /* ---------- Template (sama seperti main/template.js) ---------- */
  const UKURAN = {
    '4r-portrait': { W: 1200, H: 1800, name: '4R tegak (4×6)' },
    '4r-landscape': { W: 1800, H: 1200, name: '4R mendatar (6×4)' },
    strip: { W: 600, H: 1800, name: 'Strip 2×6' },
    square: { W: 1200, H: 1200, name: 'Persegi' },
  };
  const FONT = ['sans', 'serif', 'script'],
    RASIO = ['3:2', '4:3', '16:9', '1:1', '4:5', '3:4', '2:3'];
  const angka = (v, lo, hi, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const warna = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : d);
  function bersihkanTpl(t) {
    const ukuran = UKURAN[t.size] ? t.size : '4r-portrait';
    const { W, H } = UKURAN[ukuran];
    const slots = (Array.isArray(t.slots) ? t.slots : []).slice(0, 4).map(s => {
      const w = angka(s.w, 40, W, W / 2),
        h = angka(s.h, 40, H, H / 4);
      return {
        x: angka(s.x, -w / 2, W - w / 2, 0),
        y: angka(s.y, -h / 2, H - h / 2, 0),
        w,
        h,
        r: angka(s.r, 0, 200, 8),
      };
    });
    while (slots.length < 4) slots.push({ x: 40, y: 40 + slots.length * 60, w: W / 3, h: H / 6, r: 8 });
    const texts = (Array.isArray(t.texts) ? t.texts : []).slice(0, 12).map((x, i) => ({
      id: String(x.id || 't' + i).slice(0, 20),
      text: String(x.text || '').slice(0, 120),
      x: angka(x.x, 0, W, W / 2),
      y: angka(x.y, 0, H, H / 2),
      size: angka(x.size, 10, 400, 60),
      color: warna(x.color, '#1D1D1F'),
      font: FONT.includes(x.font) ? x.font : 'sans',
      bold: !!x.bold,
    }));
    return {
      id:
        String(t.id || 'tpl' + Date.now())
          .replace(/[^a-z0-9_-]/gi, '')
          .slice(0, 40) || 'tpl' + Date.now(),
      coupleId: String(t.coupleId || ''),
      name:
        String(t.name || '')
          .trim()
          .slice(0, 60) || 'Untitled template',
      size: ukuran,
      W,
      H,
      backgroundColor: warna(t.backgroundColor, '#FFFFFF'),
      ratio: RASIO.includes(t.ratio) ? t.ratio : null,
      filter:
        String(t.filter || '')
          .replace(/[^a-z0-9_-]/gi, '')
          .slice(0, 40) || null,
      filterStrength: Math.round(angka(t.filterStrength, 0, 100, 100)),
      guestPicksFilter: t.guestPicksFilter !== false,
      slots,
      texts,
    };
  }
  const keDataUrl = bytes =>
    new Promise(ok => {
      const png = bytes[0] === 0x89 && bytes[1] === 0x50;
      const r = new FileReader();
      r.onload = () => ok(r.result);
      r.onerror = () => ok(null);
      r.readAsDataURL(new Blob([bytes], { type: png ? 'image/png' : 'image/jpeg' }));
    });

  /* ---------- Perekam: pakai format yang didukung HP (iPhone = MP4) ---------- */
  const MR = window.MediaRecorder;
  let formatTerakhir = '';
  if (MR) {
    const VIDEO = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];
    const AUDIO = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
    const Ganti = function (stream, opsi = {}) {
      const o = { ...opsi };
      if (o.mimeType && !MR.isTypeSupported(o.mimeType)) {
        const daftar = /^audio/.test(o.mimeType) ? AUDIO : VIDEO;
        const pilih = daftar.find(m => MR.isTypeSupported(m));
        if (pilih) o.mimeType = pilih;
        else delete o.mimeType;
      }
      const r = new MR(stream, o);
      formatTerakhir = r.mimeType || o.mimeType || '';
      return r;
    };
    Ganti.prototype = MR.prototype;
    Ganti.isTypeSupported = t => MR.isTypeSupported(t);
    window.MediaRecorder = Ganti;
  }
  /* Kamera depan HP; minta 16:9 tegak/datar sesuai arah HP */
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = c => {
      if (c && c.video && typeof c.video === 'object' && !c.video.deviceId)
        c = { ...c, video: { ...c.video, facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } };
      else if (c && c.video === true) c = { ...c, video: { facingMode: 'user' } };
      return gum(c);
    };
  }

  /* ---------- Pemutar hasil (pengganti "buka file" di Mac) ---------- */
  function putar(url, foto) {
    const lapis = document.createElement('div');
    lapis.className = 'demo-rotate';
    const isi = document.createElement(foto ? 'img' : 'video');
    isi.src = url;
    if (!foto) {
      isi.controls = true;
      isi.autoplay = true;
      isi.playsInline = true;
    }
    const tutup = document.createElement('button');
    tutup.className = 'btn glassy';
    tutup.textContent = 'Tutup';
    tutup.onclick = () => {
      if (!foto) isi.pause();
      lapis.remove();
    };
    lapis.append(isi, tutup);
    document.body.appendChild(lapis);
  }

  /* ---------- Unduh lewat QR (demo): foto dikirim ke server demo, disimpan 1 hari ---------- */
  function kodeBaru() {
    const huruf = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const acak = crypto.getRandomValues(new Uint8Array(12));
    return Array.from(acak, b => huruf[b % huruf.length]).join('');
  }
  async function tandaiUnggah(kode, st) {
    const x = SESI.find(z => z.code === kode);
    if (x && x.upload !== st) {
      x.upload = st;
      await simpan('sessions', SESI);
    }
  }
  async function unggahFoto(kode, bytes) {
    for (let coba = 1; coba <= 5; coba++) {
      try {
        const r = await fetch('/u/' + kode, {
          method: 'PUT',
          headers: { 'content-type': 'image/jpeg' },
          body: new Blob([bytes], { type: 'image/jpeg' }),
        });
        if (r.ok) {
          catat(`QR ${kode}: foto terkirim`);
          return tandaiUnggah(kode, 'sent');
        }
        catat(`QR ${kode}: ditolak server (${r.status})`, 'peringatan');
        if (r.status < 500) return tandaiUnggah(kode, 'refused by server');
      } catch (e) {
        catat(`QR ${kode}: belum terkirim (${e.message}), coba lagi`, 'peringatan');
      }
      await tandaiUnggah(kode, 'waiting');
      await new Promise(ok => setTimeout(ok, coba * 3000));
    }
  }

  /* ---------- Rekaman yang sedang berjalan ---------- */
  const rekam = new Map();
  let nomor = 0,
    cbErrorRekam = null;

  const config = () => ({
    couple: coupleAktif().name,
    welcome: coupleAktif().welcome,
    cameraName: '',
    micName: '',
    colors: { bg: '#1f1a17', card: 'rgba(255,255,255,0.92)', accent: ST.accent, text: '#2b2420' },
    quiz: coupleAktif().questions,
    ...Object.fromEntries(Object.entries(ST).filter(([k]) => !['loginId', 'accent'].includes(k))),
  });

  window.api = {
    getConfig: async () => {
      await siap;
      return config();
    },
    getSettings: async () => {
      await siap;
      return { ...ST };
    },
    saveSettings: async p => {
      await siap;
      const n = { ...ST };
      for (const [k, v] of Object.entries(p || {})) {
        if (BATAS[k]) {
          const x = Math.round(Number(v));
          if (Number.isFinite(x)) n[k] = Math.min(BATAS[k][1], Math.max(BATAS[k][0], x));
        } else if (typeof ST_AWAL[k] === 'boolean' && typeof v === 'boolean') n[k] = v;
        else if (k === 'language' && ['id', 'en'].includes(v)) n[k] = v;
        else if (k === 'accent' && /^#[0-9a-f]{6}$/i.test(v)) n[k] = v;
      }
      if (p && p.camera && p.camera !== 'webcam') {
        pesanLayar('Kamera Sony hanya ada di aplikasi Mac. Demo memakai kamera HP.');
      }
      n.camera = 'webcam';
      if (!n.enableMessage && !n.enableQuiz && !n.enablePhoto)
        return { ...ST, error: 'At least one option must stay on the main menu.' };
      ST = n;
      await simpan('settings', ST);
      return { ...ST };
    },
    login: async (id, pw) => {
      await siap;
      return String(id).trim().toLowerCase() === 'leura' && String(pw) === '1234';
    },
    changeLogin: async () => ({ error: DEMO }),

    getCouples: async () => {
      await siap;
      return salinan(CP);
    },
    saveCouple: async c => {
      await siap;
      const q = (c.questions || [])
        .map(x =>
          String(x || '')
            .trim()
            .slice(0, 200),
        )
        .filter(Boolean)
        .slice(0, 10);
      const menu = {
        message: !!(c.menu && c.menu.message),
        quiz: !!(c.menu && c.menu.quiz),
        photo: !!(c.menu && c.menu.photo),
      };
      const nama = String(c.name || '')
        .trim()
        .slice(0, 80);
      if (!nama) return { error: "Please enter the couple's name." };
      if (!Object.values(menu).some(Boolean))
        return { error: 'At least one option must be on: Send a message, Quick quiz or Photo booth.' };
      if (menu.quiz && !q.length)
        return { error: 'Quick quiz is on: add at least 1 question, or turn Quick quiz off.' };
      const baru = {
        id: c.id || idBaru('c'),
        name: nama,
        welcome: String(c.welcome || '')
          .trim()
          .slice(0, 160),
        questions: q,
        menu,
      };
      const i = CP.couples.findIndex(x => x.id === baru.id);
      if (i < 0) CP.couples.push(baru);
      else CP.couples[i] = baru;
      if (!CP.activeId) CP.activeId = baru.id;
      await simpan('couples', CP);
      return { ok: true, couple: baru, data: salinan(CP) };
    },
    deleteCouple: async id => {
      await siap;
      if (CP.couples.length <= 1) return { error: 'There must be at least 1 couple.' };
      CP.couples = CP.couples.filter(c => c.id !== id);
      if (CP.activeId === id) CP.activeId = CP.couples[0].id;
      const n = TPL.filter(t => t.coupleId === id).length;
      TPL = TPL.filter(t => t.coupleId !== id);
      await simpan('couples', CP);
      await simpan('templates', TPL);
      return { ok: true, data: salinan(CP), templatesDeleted: n };
    },
    setActiveCouple: async id => {
      await siap;
      if (!CP.couples.find(c => c.id === id)) return { error: 'Couple not found.' };
      CP.activeId = id;
      await simpan('couples', CP);
      return { ok: true, data: salinan(CP) };
    },
    openFolder: async () => {
      pesanLayar(DEMO);
      return '';
    },
    openCoupleFolder: async () => 'In the demo, results can only be viewed in Session history.',

    templateSizes: async () => UKURAN,
    countTemplates: async () => {
      await siap;
      return TPL.reduce((n, t) => ((n[t.coupleId] = (n[t.coupleId] || 0) + 1), n), {});
    },
    listTemplates: async id => {
      await siap;
      return TPL.filter(t => !id || t.coupleId === id).map(t => ({ ...t }));
    },
    saveTemplate: async (input, gambar = {}) => {
      await siap;
      if (!input || !input.coupleId) return { error: 'No couple selected.' };
      const t = bersihkanTpl(input);
      const lama = TPL.find(x => x.id === t.id) || {};
      const baru = {
        ...t,
        created: lama.created || Date.now(),
        changed: Date.now(),
        backgroundUrl: lama.backgroundUrl || null,
        frameUrl: lama.frameUrl || null,
      };
      for (const dasar of ['background', 'frame']) {
        if (!(dasar in gambar)) continue;
        if (gambar[dasar] === null) {
          baru[dasar + 'Url'] = null;
          continue;
        }
        const b = new Uint8Array(gambar[dasar]);
        const png = b[0] === 0x89 && b[1] === 0x50,
          jpg = b[0] === 0xff && b[1] === 0xd8;
        if (!png && !jpg) return { error: 'The image must be a PNG or JPG.' };
        if (dasar === 'frame' && !png)
          return { error: 'The frame must be a PNG so the photo areas can be transparent.' };
        if (b.length > 15 * 1024 * 1024) return { error: 'The image is too large for the demo (max 15 MB).' };
        baru[dasar + 'Url'] = await keDataUrl(b);
      }
      const i = TPL.findIndex(x => x.id === t.id);
      if (i < 0) TPL.push(baru);
      else TPL[i] = baru;
      await simpan('templates', TPL);
      return { ok: true, template: { ...baru } };
    },
    deleteTemplate: async id => {
      await siap;
      TPL = TPL.filter(t => t.id !== id);
      await simpan('templates', TPL);
      return { ok: true };
    },

    // Filter foto (LUT .cube) — disimpan di HP ini
    listFilters: async () => ambil('filters', []),
    addFilter: async (nama, bytes) => {
      const daftar = await ambil('filters', []);
      if (!bytes || !bytes.length) return { error: 'The filter file is empty.' };
      if (bytes.length > 20 * 1024 * 1024) return { error: 'The filter file is too large (max 20 MB).' };
      if (daftar.length >= 20) return { error: 'The demo allows up to 20 filters.' };
      const teks = new TextDecoder().decode(bytes);
      let lut;
      try {
        lut = window.__leura.parseCube(teks);
      } catch (e) {
        return { error: "This file can't be used: " + e.message };
      }
      const item = {
        id: idBaru('lut'),
        name:
          String(nama || '')
            .replace(/\.cube$/i, '')
            .trim()
            .slice(0, 40) ||
          lut.title ||
          'Filter',
        size: lut.size,
        created: Date.now(),
      };
      daftar.push(item);
      await simpan('filter:' + item.id, teks);
      await simpan('filters', daftar);
      return { ok: true, filter: item, list: daftar };
    },
    getFilter: async id => {
      const item = (await ambil('filters', [])).find(x => x.id === id);
      const teks = item && (await ambil('filter:' + id, null));
      return teks ? { ...item, text: teks } : null;
    },
    renameFilter: async (id, nama) => {
      const d = await ambil('filters', []),
        item = d.find(x => x.id === id);
      if (!item) return { error: 'Filter not found.' };
      item.name =
        String(nama || '')
          .trim()
          .slice(0, 40) || item.name;
      await simpan('filters', d);
      return { ok: true, list: d };
    },
    deleteFilter: async id => {
      const d = await ambil('filters', []);
      if (!d.some(x => x.id === id)) return { error: 'Filter not found.' };
      const sisa = d.filter(x => x.id !== id);
      await simpan('filter:' + id, undefined);
      await simpan('filters', sisa);
      return { ok: true, list: sisa };
    },

    getOutDir: async () => ({
      dir: 'Memori HP ini (demo, maksimal ' + MAKS_SESI + ' sesi terakhir)',
      isDefault: true,
      ok: true,
    }),
    diskSpace: async () => ({ ok: false, unsupported: true }), // a phone has no storage folder to check
    chooseOutDir: async () => ({ error: DEMO }),
    resetOutDir: async () => ({}),

    getStartupInfo: async () => ({ recovered: 0 }),
    getSessions: async () => {
      await siap;
      return salinan(SESI);
    },
    sessionOpen: async id => {
      const s = SESI.find(x => x.id === id);
      const u = s && (await urlMedia(id));
      if (!u) return { error: 'File not found on this phone.' };
      putar(u, s.label === 'photo');
      return { ok: true };
    },
    sessionReveal: async () => ({ error: 'The demo has no Finder. Use "View photo" / "Play video".' }),
    sessionThumb: async id => {
      const s = SESI.find(x => x.id === id);
      return s && s.label === 'photo' ? urlMedia(id) : null;
    },
    sessionRetry: async () => ({ error: "This session doesn't need a retry." }),

    recStart: async (label, opsi) => {
      await siap;
      const id = ++nomor;
      rekam.set(id, { label, guest: opsi && opsi.guest, potongan: [], t0: Date.now() });
      catat(`Rekam mulai: ${label}`);
      return { id };
    },
    recChunk: (id, buf) => {
      const r = rekam.get(id);
      if (r) r.potongan.push(buf);
    },
    recEnd: async (id, detik, metaMasuk = {}) => {
      const { captions: kapsi, captionImages: kapsiGambar, ...meta } = metaMasuk || {}; // teks quiz di video hanya di aplikasi Mac (FFmpeg)
      const r = rekam.get(id);
      rekam.delete(id);
      if (!r) return { ok: false, error: 'Recording not found.' };
      if (meta.aborted || !r.potongan.length) return { ok: true };
      const jenis = (formatTerakhir || 'video/webm').split(';')[0];
      const ext = /mp4/.test(jenis) ? 'mp4' : 'webm';
      const tamu = namaFile(r.guest);
      const sesi = {
        id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
        time: new Date(r.t0).toISOString(),
        label: r.label,
        file: `${tamu || namaFile(coupleAktif().name) || 'Tamu'}_${r.label === 'message' ? 'pesan' : r.label}.${ext}`,
        dir: 'HP ini',
        couple: coupleAktif().name,
        ...(tamu ? { guest: tamu } : {}),
        seconds: detik,
        status: 'done',
        ...meta,
      };
      try {
        await tambahSesi(sesi, new Blob(r.potongan, { type: jenis }));
      } catch (e) {
        catat('Gagal simpan rekaman: ' + e.message, 'error');
        return { ok: false, error: 'Phone storage is full.' };
      }
      catat(`Rekam selesai (${detik} dtk): ${sesi.file}`);
      return { ok: true };
    },
    recAbort: async id => {
      rekam.delete(id);
    },
    onRecError: cb => {
      cbErrorRekam = cb;
    },

    savePhotos: async p => {
      await siap;
      const { originals = [], result, meta = {}, guest: t } = p || {};
      if (!result) return { ok: false, error: 'No photo data' };
      const tamu = namaFile(t);
      // QR sungguhan kalau demo dibuka dari internet (https); di komputer sendiri: halaman contoh
      const qrAsli = location.protocol === 'https:' || window.DEMO_QR_UJI === true; // DEMO_QR_UJI: dipakai tests/uji-demo.js
      const kode = qrAsli ? kodeBaru() : null;
      const link = qrAsli ? `${location.origin}/f/${kode}` : new URL('contoh-unduh.html', location.href).href;
      const sesi = {
        id: Date.now() * 1000 + Math.floor(Math.random() * 1000),
        time: new Date().toISOString(),
        label: 'photo',
        file: `${tamu || 'Tamu'}_hasil.jpg`,
        dir: 'HP ini',
        couple: coupleAktif().name,
        ...(tamu ? { guest: tamu } : {}),
        seconds: 0,
        status: 'photo',
        photos: originals.length,
        ...(qrAsli ? { code: kode, link, upload: 'queued' } : {}),
        ...meta,
      };
      try {
        await tambahSesi(sesi, new Blob([result], { type: 'image/jpeg' }));
      } catch {
        return { ok: false, error: 'Phone storage is full.' };
      }
      catat(`Foto tersimpan: ${sesi.file}`);
      if (qrAsli) unggahFoto(kode, result); // dikirim di belakang; halaman unduh menunggu sampai fotonya sampai
      return { ok: true, link };
    },

    appInfo: async () => ({ demo: true, version: 'demo', installed: true, licenses: false }),
    uploadStatus: async () => ({
      enabled: false,
      url: '',
      hasKey: false,
      video: false,
      videoQuality: '720',
      waiting: 0,
      waitingVideos: 0,
      sent: 0,
      lastError: '',
      hasSetupResult: false,
    }),
    saveUploadSettings: async () => ({
      enabled: false,
      url: '',
      hasKey: false,
      waiting: 0,
      sent: 0,
      lastError: '',
      error: 'QR download is set up in the Mac app. In the demo, QR is always on (photos kept for 1 day).',
    }),
    testUpload: async () => ({ error: DEMO }),
    uploadSetupResult: async () => null,
    retryUploadNow: async () => ({ enabled: false }),
    onUploadStatus: () => {},

    openLink: async u => {
      if (/^https:\/\//.test(u)) window.open(u, '_blank', 'noopener');
      return { ok: true };
    },
    copyText: async t => {
      try {
        await navigator.clipboard.writeText(t);
        return { ok: true };
      } catch {
        return { error: 'Could not copy.' };
      }
    },

    readLog: async () => ({ text: LOG.join('\n'), file: new Date().toISOString().slice(0, 10), days: [] }),
    saveLog: async () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([LOG.join('\n')], { type: 'text/plain' }));
      a.download = `Leura-demo-catatan-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      return { ok: true, file: a.download };
    },
    log: (p, t) => catat('[ui] ' + p, t),

    onQuitRequest: () => {},
    checkQuit: async () => ({ copying: 0, processing: 0, photos: 0 }),
    quitApp: async () => {
      setTimeout(() => location.reload(), 300);
      return { ok: true };
    },

    // Kamera Sony tidak ada di HP: selalu kamera HP
    sonyStatus: async () => ({ mode: 'webcam', connected: false, message: '' }),
    onSonyStatus: () => {},
    sonyReconnect: async () => ({ mode: 'webcam', connected: false, message: '' }),
    sonyLiveView: async () => null,
    sonyPhoto: async () => ({ ok: false, error: DEMO }),
    sonyMode: async j => ({ ok: true, kind: j, changed: false }),
  };
  void cbErrorRekam;

  /* ---------- Ukuran tampilan di HP landscape ----------
     Leura dirancang untuk layar booth (tinggi ±540–800 titik); HP landscape cuma ±390.
     Seluruh tampilan ada di dalam <div id="skala">: ditata seolah layarnya setinggi
     TINGGI_DASAR, lalu dikecilkan dengan transform supaya pas di layar HP.
     Ukuran vh/vw di CSS sudah diganti var(--vh)/var(--vw) oleh demo/bangun.js. */
  const TINGGI_DASAR = 580;
  const nyata = () => ({
    w: document.documentElement.clientWidth || screen.width,
    h: document.documentElement.clientHeight || screen.height,
  });
  let ukuran = nyata(),
    skala = 1;
  function aturSkala() {
    const { w, h } = nyata();
    skala = w > h && h < TINGGI_DASAR ? h / TINGGI_DASAR : 1;
    ukuran = { w: w / skala, h: h / skala };
    const r = document.documentElement.style;
    r.setProperty('--sk', skala);
    r.setProperty('--skW', ukuran.w + 'px');
    r.setProperty('--skH', ukuran.h + 'px');
    r.setProperty('--vw', ukuran.w / 100 + 'px');
    r.setProperty('--vh', ukuran.h / 100 + 'px');
    document.documentElement.classList.toggle('demo-small', skala < 1);
  }
  // Kode aplikasi yang membaca lebar/tinggi layar ikut memakai ukuran tampilan yang diperkecil
  try {
    Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => ukuran.w });
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => ukuran.h });
  } catch {
    /* browser lama: ukuran layar asli dipakai */
  }
  aturSkala();
  addEventListener('resize', aturSkala);
  addEventListener('orientationchange', () => setTimeout(aturSkala, 300));
  addEventListener('DOMContentLoaded', aturSkala);

  /* ---------- Tambahan khusus demo ---------- */
  // Layar HP tetap menyala selama presentasi
  let kunciLayar = null;
  async function jagaLayar() {
    try {
      if (navigator.wakeLock && !kunciLayar) {
        kunciLayar = await navigator.wakeLock.request('screen');
        kunciLayar.addEventListener('release', () => {
          kunciLayar = null;
        });
      }
    } catch {
      /* wake lock tidak didukung/ditolak: layar boleh redup */
    }
  }
  document.addEventListener('pointerdown', jagaLayar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') jagaLayar();
  });

  addEventListener('DOMContentLoaded', () => {
    document.documentElement.classList.add('demo');
    // Petunjuk login di layar Admin
    const login = document.getElementById('adminLogin');
    if (login) {
      const p = document.createElement('p');
      p.className = 'demo-petunjuk';
      p.textContent = 'Demo — ID: leura · Password: 1234';
      login.querySelector('.group').before(p);
    }
    // Tanda kecil "DEMO" di pojok
    const tanda = document.createElement('div');
    tanda.className = 'demo-tanda';
    tanda.textContent = 'DEMO';
    document.body.appendChild(tanda);
  });
})();
