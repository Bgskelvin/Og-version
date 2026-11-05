/* =====================================================================
   riwayat.js — halaman "Riwayat sesi" (dibuka dari Admin)
   Daftar pesan, quiz, dan foto per hari, dengan status berwarna,
   peringatan sesi bermasalah, dan aksi per sesi (putar, Finder, coba lagi).
   Status diperbarui otomatis setiap 3 detik selama halaman terbuka.
   ===================================================================== */

// status → [label, warna, perlu perhatian?, keterangan]
const STATUS_SESI = {
  done:          ['Siap', 'hijau', false, 'Video MP4 siap di folder couple.'],
  photo:         ['Tersimpan', 'hijau', false, ''],
  processing:    ['Memproses', 'biru', false, 'Sedang diubah ke MP4. Tunggu sebentar.'],
  transfer:      ['Menyalin dari kamera', 'biru', false, 'Sedang disalin dari kartu SD kamera ke folder couple.'],
  recording:     ['Merekam', 'biru', false, 'Rekaman sedang berjalan.'],
  webm:          ['Belum MP4', 'oranye', true, 'Video tersimpan sebagai WebM karena FFmpeg belum terpasang. Bisa diputar dengan VLC atau Chrome.'],
  'card-only':   ['Di kartu SD', 'oranye', true, 'Video aman di kartu SD kamera, tapi belum tersalin ke komputer.'],
  failed:        ['Gagal jadi MP4', 'merah', true, 'Video gagal diubah ke MP4. File aslinya tetap tersimpan di folder "original".'],
  'write-error': ['Gagal disimpan', 'merah', true, 'Rekaman gagal ditulis ke disk.'],
  lost:          ['Hilang', 'merah', true, 'Rekaman kosong: aplikasi berhenti sebelum sempat merekam.'],
};
const BISA_ULANG = ['failed', 'webm', 'card-only'];
const JENIS_SESI = [['semua', 'Semua'], ['pesan', 'Pesan'], ['quiz', 'Quiz'], ['foto', 'Foto'], ['perhatian', 'Perlu perhatian']];

const rw = { couple: null, jenis: 'semua', buka: null, data: [], jejak: '', timer: null, thumb: new Map() };

const jenisSesi = s => (s.label === 'foto' ? 'foto' : /^quiz/.test(s.label) ? 'quiz' : 'pesan');
const infoStatus = s => STATUS_SESI[s.status] || ['—', 'abu', false, ''];
const perluPerhatian = s => infoStatus(s)[2];
const terlaluPendek = s => jenisSesi(s) !== 'foto' && (s.seconds || 0) < 3 && ['done', 'webm', 'failed'].includes(s.status);
const idSesi = (s, i) => (s.id != null ? s.id : 'i' + i);
function namaHari(d) {
  const hari = new Date(d); hari.setHours(0, 0, 0, 0);
  const ini = new Date(); ini.setHours(0, 0, 0, 0);
  const selisih = Math.round((ini - hari) / 86400000);
  const tgl = hari.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return selisih === 0 ? 'Hari ini · ' + tgl : selisih === 1 ? 'Kemarin · ' + tgl : tgl;
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
  $('riwayatRingkas').textContent = `${nama || 'Semua couple'}: ${r.hariIni} hari ini · ${r.total} total`;
  $('riwayatBadge').textContent = r.perhatian ? `⚠️ ${r.perhatian}` : '';
  $('riwayatBadge').style.display = r.perhatian ? '' : 'none';
}

/* ---------- Halaman Riwayat sesi ---------- */
async function bukaRiwayat() {
  rw.couple = activeCouple ? activeCouple.name : '';
  rw.jenis = 'semua'; rw.buka = null; rw.jejak = '';
  show('riwayat');
  $('riwayat').querySelector('.sheet-body').scrollTop = 0;
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
  for (const [v, t] of [['', 'Semua couple'], ...nama.map(n => [n, n])]) {
    const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === rw.couple) o.selected = true; sel.appendChild(o);
  }
  const milik = rw.couple ? semua.filter(s => s.couple === rw.couple) : semua;

  // Ringkasan
  const hitung = j => milik.filter(s => jenisSesi(s) === j).length;
  const menit = Math.round(milik.filter(s => jenisSesi(s) !== 'foto').reduce((t, s) => t + (s.seconds || 0), 0) / 60);
  $('rwRingkas').innerHTML = [['Pesan', hitung('pesan')], ['Quiz', hitung('quiz')], ['Foto', hitung('foto')], ['Menit video', menit]]
    .map(([t, n]) => `<div><b>${n}</b><span>${t}</span></div>`).join('');

  // Peringatan
  const masalah = milik.filter(perluPerhatian).length;
  const banner = $('rwBanner');
  banner.style.display = masalah || rw.jenis === 'perhatian' ? '' : 'none';
  banner.className = 'rw-banner' + (rw.jenis === 'perhatian' ? ' aktif' : '');
  banner.textContent = rw.jenis === 'perhatian'
    ? (masalah ? `Menampilkan ${masalah} sesi yang perlu perhatian · Tampilkan semua` : 'Tidak ada sesi bermasalah · Tampilkan semua')
    : `⚠️ ${masalah} sesi perlu perhatian · ketuk untuk melihat`;

  // Pilihan jenis
  const chips = $('rwJenis'); chips.innerHTML = '';
  for (const [k, t] of JENIS_SESI) {
    const b = document.createElement('button');
    b.className = 'rw-chip' + (rw.jenis === k ? ' on' : '');
    b.textContent = t + (k === 'perhatian' && masalah ? ` (${masalah})` : '');
    b.onclick = () => { rw.jenis = k; rw.buka = null; gambarRiwayat(); };
    chips.appendChild(b);
  }

  // Daftar per hari, terbaru di atas
  const tampil = milik.filter(s => rw.jenis === 'semua' ? true : rw.jenis === 'perhatian' ? perluPerhatian(s) : jenisSesi(s) === rw.jenis)
    .sort((a, b) => new Date(b.time) - new Date(a.time));
  const box = $('rwList'); box.innerHTML = '';
  if (!tampil.length) {
    const k = document.createElement('div'); k.className = 'group'; k.innerHTML = '<div class="item muted">Belum ada sesi di sini.</div>';
    box.appendChild(k); return;
  }
  let hari = null, grup = null;
  for (const s of tampil) {
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
}

function barisSesi(s) {
  const [label, warna] = infoStatus(s), jenis = jenisSesi(s);
  const b = document.createElement('button');
  b.className = 'item rw-row' + (rw.buka === s._id ? ' buka' : '');
  b.dataset.id = s._id;
  const ikon = { pesan: 'i-mic', quiz: 'i-spark', foto: 'i-camera' }[jenis];
  const nama = { pesan: 'Pesan', quiz: 'Quiz', foto: 'Foto' }[jenis];
  const sub = jenis === 'foto' ? `${s.photos || 4} foto${s.template ? ' · ' + s.template : ''}` : fmt(s.seconds || 0) + (s.kamera === 'sony' ? ' · kamera Sony' : '');
  b.innerHTML = `<span class="rw-ikon"></span><span class="rw-teks"><b></b><small></small></span><span class="rw-tag"></span><em class="rw-status ${warna}"></em>`;
  if (jenis === 'foto' && rw.thumb.get(s._id)) b.querySelector('.rw-ikon').innerHTML = `<img alt="" src="${rw.thumb.get(s._id)}">`;
  else {
    b.querySelector('.rw-ikon').innerHTML = `<svg class="i"><use href="#${ikon}"/></svg>`;
    if (jenis === 'foto' && !rw.thumb.has(s._id) && typeof s._id === 'number') {
      rw.thumb.set(s._id, null);
      api.sessionThumb(s._id).then(url => { if (url) { rw.thumb.set(s._id, url); gambarRiwayat(); } }).catch(() => {});
    }
  }
  b.querySelector('b').textContent = `${jamSesi(s.time)} · ${nama}`;
  b.querySelector('small').textContent = (rw.couple ? '' : (s.couple || '-') + ' · ') + sub;
  b.querySelector('.rw-tag').textContent = terlaluPendek(s) ? 'Terlalu pendek' : s.recovered ? 'Dipulihkan' : '';
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
  const ket = infoStatus(s)[3] || (s.label === 'foto' ? `${s.photos || 4} foto asli + 1 hasil template.` : '');
  const p = document.createElement('p'); p.textContent = ket + (s.error ? ` (${s.error})` : '') + (s.kartu ? ` File di kartu: ${s.kartu}.` : '');
  d.appendChild(p);
  if (Array.isArray(s.questions) && s.questions.length) {
    const ol = document.createElement('ol');
    s.questions.forEach(q => { const li = document.createElement('li'); li.textContent = q; ol.appendChild(li); });
    const t = document.createElement('div'); t.className = 'muted'; t.textContent = 'Pertanyaan:';
    d.append(t, ol);
  }
  if (s.file) { const f = document.createElement('div'); f.className = 'muted rw-file'; f.textContent = s.file; d.appendChild(f); }
  const aksi = document.createElement('div'); aksi.className = 'item actions'; aksi.style.padding = '10px 0 0'; aksi.style.border = '0';
  const tombol = (teks, fn, kelas = 'btn sm tint') => { const b = document.createElement('button'); b.className = kelas; b.textContent = teks; b.onclick = fn; aksi.appendChild(b); };
  const hasil = r => { if (r && r.error) flash('rwMsg', r.error, true); };
  if (typeof s._id === 'number') {
    if (['done', 'photo', 'webm'].includes(s.status)) tombol(s.label === 'foto' ? 'Lihat foto' : 'Putar video', async () => hasil(await api.sessionOpen(s._id)));
    tombol('Tampilkan di Finder', async () => hasil(await api.sessionReveal(s._id)));
    if (BISA_ULANG.includes(s.status)) tombol(s.status === 'card-only' ? 'Coba salin lagi dari kamera' : 'Coba proses lagi', async () => {
      const r = await api.sessionRetry(s._id);
      if (r && r.error) return flash('rwMsg', r.error, true);
      flash('rwMsg', 'Sedang dicoba lagi…');
      segarkanRiwayat(true);
    }, 'btn sm primary');
  }
  d.appendChild(aksi);
  return d;
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
function pasangRiwayat() {
  $('btnRiwayat').onclick = bukaRiwayat;
  $('rwBack').onclick = () => { clearInterval(rw.timer); show('admin'); loadSessions(); };
  $('rwSegar').onclick = () => segarkanRiwayat(true);
  $('rwCouple').onchange = e => { rw.couple = e.target.value; rw.buka = null; gambarRiwayat(); };
  $('rwBanner').onclick = () => { rw.jenis = rw.jenis === 'perhatian' ? 'semua' : 'perhatian'; rw.buka = null; gambarRiwayat(); };
}
