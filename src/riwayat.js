/* =====================================================================
   riwayat.js — halaman "Riwayat sesi" (dibuka dari Admin)
   Daftar pesan, quiz, dan foto per hari, dengan status berwarna,
   peringatan sesi bermasalah, dan aksi per sesi (putar, Finder, coba lagi).
   Status diperbarui otomatis setiap 3 detik selama halaman terbuka.
   Supaya tetap ringan walau sesinya ribuan:
   - daftar ditampilkan per 60 sesi (tombol "Tampilkan lebih banyak");
   - gambar kecil foto hanya dimuat untuk baris yang terlihat di layar,
     dan dipasang langsung ke barisnya tanpa menggambar ulang daftar.
   ===================================================================== */

// status → [label, warna, perlu perhatian?, keterangan]
const STATUS_SESI = {
  done:          ['Ready', 'hijau', false, 'MP4 video is ready in the couple folder.'],
  photo:         ['Saved', 'hijau', false, ''],
  processing:    ['Processing', 'biru', false, 'Converting to MP4. One moment.'],
  transfer:      ['Copying from camera', 'biru', false, 'Copying from the camera SD card to the couple folder.'],
  recording:     ['Recording', 'biru', false, 'Recording in progress.'],
  webm:          ['Not MP4 yet', 'oranye', true, 'Saved as WebM because FFmpeg is not installed. It plays in VLC or Chrome.'],
  'card-only':   ['On SD card', 'oranye', true, 'The video is safe on the camera SD card but has not been copied to the computer.'],
  failed:        ['MP4 failed', 'merah', true, 'The video could not be converted to MP4. The original file is still in the "original" folder.'],
  'write-error': ['Not saved', 'merah', true, 'The recording could not be written to disk.'],
  lost:          ['Lost', 'merah', true, 'Empty recording: the app stopped before it could record.'],
};
const BISA_ULANG = ['failed', 'webm', 'card-only'];
const JENIS_SESI = [['semua', 'All'], ['pesan', 'Messages'], ['quiz', 'Quiz'], ['foto', 'Photos'], ['perhatian', 'Needs attention']];

const PER_HALAMAN = 60;
const rw = { couple: null, jenis: 'semua', buka: null, data: [], jejak: '', timer: null, thumb: new Map(), batas: PER_HALAMAN, amati: null };

// Gambar kecil dimuat saat barisnya mendekati layar (bukan semua sekaligus)
function pengamatThumb() {
  if (rw.amati || typeof IntersectionObserver === 'undefined') return rw.amati;
  rw.amati = new IntersectionObserver(entri => {
    for (const en of entri) {
      if (!en.isIntersecting) continue;
      rw.amati.unobserve(en.target);
      muatThumb(Number(en.target.dataset.id));
    }
  }, { root: $('riwayat').querySelector('.sheet-body'), rootMargin: '300px 0px' });
  return rw.amati;
}
function muatThumb(id) {
  if (rw.thumb.has(id)) return;
  rw.thumb.set(id, null);
  api.sessionThumb(id).then(url => {
    if (!url) return;
    rw.thumb.set(id, url);
    const el = document.querySelector(`#rwList .rw-row[data-id="${id}"] .rw-ikon`);   // pasang langsung ke barisnya
    if (el) el.innerHTML = `<img alt="" src="${url}">`;
  }).catch(() => {});
}

const jenisSesi = s => (s.label === 'foto' ? 'foto' : /^quiz/.test(s.label) ? 'quiz' : 'pesan');
const infoStatus = s => STATUS_SESI[s.status] || ['—', 'abu', false, ''];
const perluPerhatian = s => infoStatus(s)[2];
const terlaluPendek = s => jenisSesi(s) !== 'foto' && (s.seconds || 0) < 3 && ['done', 'webm', 'failed'].includes(s.status);
const idSesi = (s, i) => (s.id != null ? s.id : 'i' + i);
function namaHari(d) {
  const hari = new Date(d); hari.setHours(0, 0, 0, 0);
  const ini = new Date(); ini.setHours(0, 0, 0, 0);
  const selisih = Math.round((ini - hari) / 86400000);
  const tgl = hari.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return selisih === 0 ? 'Today · ' + tgl : selisih === 1 ? 'Yesterday · ' + tgl : tgl;
}
const jamSesi = t => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/* ---------- Ringkasan di halaman utama Admin ---------- */
function ringkasSesi(list, couple) {
  const milik = couple ? list.filter(s => s.couple === couple) : list;
  const hariIni = new Date().toDateString();
  return {
    hariIni: milik.filter(s => new Date(s.time).toDateString() === hariIni).length,
    total: milik.length,
    perhatian: milik.filter(perluPerhatian).length,
  };
}
async function loadSessions() {
  const list = await api.getSessions();
  const nama = activeCouple ? activeCouple.name : null;
  const r = ringkasSesi(list, nama);
  $('riwayatRingkas').textContent = `${nama || 'All couples'}: ${r.hariIni} today · ${r.total} total`;
  $('riwayatBadge').textContent = r.perhatian ? `⚠️ ${r.perhatian}` : '';
  $('riwayatBadge').style.display = r.perhatian ? '' : 'none';
}

/* ---------- Halaman Riwayat sesi ---------- */
async function bukaRiwayat() {
  rw.couple = activeCouple ? activeCouple.name : '';
  rw.jenis = 'semua'; rw.buka = null; rw.jejak = ''; rw.batas = PER_HALAMAN;
  show('riwayat');
  $('riwayat').querySelector('.sheet-body').scrollTop = 0;
  try { unggahSt = await api.unggahStatus(); } catch (e) {}   // untuk menyusun link QR sesi lama
  await segarkanRiwayat(true);
  clearInterval(rw.timer);
  rw.timer = setInterval(() => { if (current === 'riwayat') segarkanRiwayat(); else clearInterval(rw.timer); }, 3000);
}
async function segarkanRiwayat(paksa = false) {
  let list = [];
  try { list = await api.getSessions(); } catch (e) {}
  const jejak = JSON.stringify(list);
  if (!paksa && jejak === rw.jejak) return;          // tidak ada perubahan: jangan gambar ulang
  rw.jejak = jejak; rw.data = list;
  gambarRiwayat();
}

function gambarRiwayat() {
  const semua = rw.data.map((s, i) => ({ ...s, _id: idSesi(s, i) }));
  // Pilihan couple
  const nama = [...new Set([...(couplesData ? couplesData.couples.map(c => c.name) : []), ...semua.map(s => s.couple).filter(Boolean)])];
  const sel = $('rwCouple');
  sel.innerHTML = '';
  for (const [v, t] of [['', 'All couples'], ...nama.map(n => [n, n])]) {
    const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === rw.couple) o.selected = true; sel.appendChild(o);
  }
  const milik = rw.couple ? semua.filter(s => s.couple === rw.couple) : semua;

  // Ringkasan
  const hitung = j => milik.filter(s => jenisSesi(s) === j).length;
  const menit = Math.round(milik.filter(s => jenisSesi(s) !== 'foto').reduce((t, s) => t + (s.seconds || 0), 0) / 60);
  $('rwRingkas').innerHTML = [['Messages', hitung('pesan')], ['Quiz', hitung('quiz')], ['Photos', hitung('foto')], ['Video minutes', menit]]
    .map(([t, n]) => `<div><b>${n}</b><span>${t}</span></div>`).join('');

  // Peringatan
  const masalah = milik.filter(perluPerhatian).length;
  const banner = $('rwBanner');
  banner.style.display = masalah || rw.jenis === 'perhatian' ? '' : 'none';
  banner.className = 'rw-banner' + (rw.jenis === 'perhatian' ? ' aktif' : '');
  banner.textContent = rw.jenis === 'perhatian'
    ? (masalah ? `Showing ${masalah} session(s) that need attention · Show all` : 'No sessions with problems · Show all')
    : `⚠️ ${masalah} session(s) need attention · tap to view`;

  // Pilihan jenis
  const chips = $('rwJenis'); chips.innerHTML = '';
  for (const [k, t] of JENIS_SESI) {
    const b = document.createElement('button');
    b.className = 'rw-chip' + (rw.jenis === k ? ' on' : '');
    b.textContent = t + (k === 'perhatian' && masalah ? ` (${masalah})` : '');
    b.onclick = () => { rw.jenis = k; rw.buka = null; rw.batas = PER_HALAMAN; gambarRiwayat(); };
    chips.appendChild(b);
  }

  // Daftar per hari, terbaru di atas
  const tampil = milik.filter(s => rw.jenis === 'semua' ? true : rw.jenis === 'perhatian' ? perluPerhatian(s) : jenisSesi(s) === rw.jenis)
    .sort((a, b) => new Date(b.time) - new Date(a.time));
  const box = $('rwList'); box.innerHTML = '';
  if (!tampil.length) {
    const k = document.createElement('div'); k.className = 'group'; k.innerHTML = '<div class="item muted">No sessions here yet.</div>';
    box.appendChild(k); return;
  }
  if (rw.amati) rw.amati.disconnect();
  let hari = null, grup = null;
  for (const s of tampil.slice(0, rw.batas)) {
    const h = new Date(s.time).toDateString();
    if (h !== hari) {
      hari = h;
      const judul = document.createElement('div'); judul.className = 'group-title'; judul.textContent = namaHari(s.time);
      grup = document.createElement('div'); grup.className = 'group';
      box.append(judul, grup);
    }
    grup.appendChild(barisSesi(s));
    if (rw.buka === s._id) grup.appendChild(detailSesi(s));
  }
  if (tampil.length > rw.batas) {
    const lagi = document.createElement('button');
    lagi.className = 'btn sm tint rw-lagi'; lagi.id = 'rwLagi';
    lagi.textContent = `Show more (${tampil.length - rw.batas} more sessions)`;
    lagi.onclick = () => { rw.batas += PER_HALAMAN; gambarRiwayat(); };
    box.appendChild(lagi);
  }
}

function barisSesi(s) {
  const [label, warna] = infoStatus(s), jenis = jenisSesi(s);
  const b = document.createElement('button');
  b.className = 'item rw-row' + (rw.buka === s._id ? ' buka' : '');
  b.dataset.id = s._id;
  const ikon = { pesan: 'i-mic', quiz: 'i-spark', foto: 'i-camera' }[jenis];
  const nama = { pesan: 'Message', quiz: 'Quiz', foto: 'Photo' }[jenis];
  const sub = jenis === 'foto' ? `${s.photos || 4} photos${s.template ? ' · ' + s.template : ''}` : fmt(s.seconds || 0) + (s.kamera === 'sony' ? ' · Sony camera' : '');
  b.innerHTML = `<span class="rw-ikon"></span><span class="rw-teks"><b></b><small></small></span><span class="rw-tag"></span><em class="rw-status ${warna}"></em>`;
  if (jenis === 'foto' && rw.thumb.get(s._id)) b.querySelector('.rw-ikon').innerHTML = `<img alt="" src="${rw.thumb.get(s._id)}">`;
  else {
    b.querySelector('.rw-ikon').innerHTML = `<svg class="i"><use href="#${ikon}"/></svg>`;
    if (jenis === 'foto' && !rw.thumb.has(s._id) && typeof s._id === 'number') {
      const o = pengamatThumb();
      if (o) o.observe(b); else muatThumb(s._id);
    }
  }
  b.querySelector('b').textContent = `${jamSesi(s.time)} · ${nama}${s.tamu ? ' · ' + s.tamu : ''}`;
  b.querySelector('small').textContent = (rw.couple ? '' : (s.couple || '-') + ' · ') + sub;
  b.querySelector('.rw-tag').textContent = terlaluPendek(s) ? 'Too short' : s.recovered ? 'Recovered' : '';
  b.querySelector('.rw-status').textContent = label;
  b.onclick = () => {
    rw.buka = rw.buka === s._id ? null : s._id;
    gambarRiwayat();
    const d = document.querySelector('#rwList .rw-detail');
    if (d) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  return b;
}

function detailSesi(s) {
  const d = document.createElement('div'); d.className = 'item rw-detail';
  const ket = infoStatus(s)[3] || (s.label === 'foto' ? `${s.photos || 4} original photos + 1 template photo.` : '');
  const p = document.createElement('p'); p.textContent = ket + (s.error ? ` (${s.error})` : '') + (s.kartu ? ` File on card: ${s.kartu}.` : '');
  d.appendChild(p);
  if (Array.isArray(s.questions) && s.questions.length) {
    const ol = document.createElement('ol');
    s.questions.forEach(q => { const li = document.createElement('li'); li.textContent = q; ol.appendChild(li); });
    const t = document.createElement('div'); t.className = 'muted'; t.textContent = 'Questions:';
    d.append(t, ol);
  }
  const link = linkSesi(s);
  if (s.kode) {          // unduh lewat QR
    const q = document.createElement('div'); q.className = 'muted';
    q.textContent = 'QR: ' + ({ terkirim: '✓ guests can download the photos', antre: 'waiting to be sent to the server', menunggu: 'waiting for internet / server', hilang: 'photo file missing, cannot be sent' }[s.unggah] || s.unggah || '-');
    d.appendChild(q);
    if (link) { const l = document.createElement('div'); l.className = 'rw-link'; l.textContent = link; d.appendChild(l); }
  }
  if (s.file) { const f = document.createElement('div'); f.className = 'muted rw-file'; f.textContent = s.file; d.appendChild(f); }
  const aksi = document.createElement('div'); aksi.className = 'item actions'; aksi.style.padding = '10px 0 0'; aksi.style.border = '0';
  const tombol = (teks, fn, kelas = 'btn sm tint') => { const b = document.createElement('button'); b.className = kelas; b.textContent = teks; b.onclick = fn; aksi.appendChild(b); };
  const hasil = r => { if (r && r.error) flash('rwMsg', r.error, true); };
  if (typeof s._id === 'number') {
    if (['done', 'photo', 'webm'].includes(s.status)) tombol(s.label === 'foto' ? 'View photo' : 'Play video', async () => hasil(await api.sessionOpen(s._id)));
    tombol('Show in Finder', async () => hasil(await api.sessionReveal(s._id)));
    if (link) {
      tombol('Show QR', () => tampilkanQRSesi(s, link));
      tombol('Copy link', async () => { await api.salinTeks(link); flash('rwMsg', 'Link copied. Paste it (⌘V) into WhatsApp or another message.'); });
      tombol('Open link', async () => hasil(await api.bukaLink(link)));
    }
    if (BISA_ULANG.includes(s.status)) tombol(s.status === 'card-only' ? 'Copy from camera again' : 'Process again', async () => {
      const r = await api.sessionRetry(s._id);
      if (r && r.error) return flash('rwMsg', r.error, true);
      flash('rwMsg', 'Trying again…');
      segarkanRiwayat(true);
    }, 'btn sm primary');
  }
  d.appendChild(aksi);
  return d;
}

// Link unduh foto sesi ini. Sesi lama hanya menyimpan kode → link disusun dari alamat server sekarang.
function linkSesi(s) {
  if (!s.kode) return '';
  if (s.link) return s.link;
  const url = String((typeof unggahSt !== 'undefined' && unggahSt.url) || '').replace(/\/+$/, '');
  return url ? `${url}/f/${s.kode}` : '';
}
// QR besar untuk sesi lama (misalnya tamu tadi lupa memindai)
function tampilkanQRSesi(s, link) {
  const url = link + (bahasa === 'en' ? '?b=en' : '');
  const lapis = document.createElement('div'); lapis.className = 'rw-qr-lapis'; lapis.id = 'rwQR';
  lapis.innerHTML = `<div class="rw-qr-kartu"><b></b><canvas></canvas><small></small><button class="btn sm primary">Close</button></div>`;
  lapis.querySelector('b').textContent = `Photo ${jamSesi(s.time)}${s.couple ? ' · ' + s.couple : ''}`;
  lapis.querySelector('small').textContent = url.replace(/^https:\/\//, '');
  try { gambarQR(lapis.querySelector('canvas'), url, 8); } catch (e) { return flash('rwMsg', 'Could not create the QR code.', true); }
  const tutup = () => lapis.remove();
  lapis.onclick = e => { if (e.target === lapis) tutup(); };
  lapis.querySelector('button').onclick = tutup;
  document.body.appendChild(lapis);
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
function pasangRiwayat() {
  $('btnRiwayat').onclick = bukaRiwayat;
  $('rwBack').onclick = () => { clearInterval(rw.timer); show('admin'); loadSessions(); };
  $('rwSegar').onclick = () => segarkanRiwayat(true);
  $('rwCouple').onchange = e => { rw.couple = e.target.value; rw.buka = null; gambarRiwayat(); };
  $('rwBanner').onclick = () => { rw.jenis = rw.jenis === 'perhatian' ? 'semua' : 'perhatian'; rw.buka = null; gambarRiwayat(); };
}
