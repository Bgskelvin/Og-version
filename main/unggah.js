/* =====================================================================
   unggah.js — unduh foto lewat QR: kode, link, dan antrean unggah.
   - Setiap sesi photobooth mendapat kode acak; link & QR langsung ada,
     walau internet sedang putus.
   - Foto hasil masuk antrean yang tersimpan di disk (antrean-unggah.json),
     diunggah satu per satu ke server Cloudflare (cloud/worker.mjs), dan
     dicoba lagi otomatis kalau gagal — juga setelah aplikasi dibuka lagi.
   ===================================================================== */
const { ipcMain, shell, clipboard } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { userData, readJSON, writeJSON, readSettings, writeSettings, updateSession } = require('./penyimpanan');
const { getWin } = require('./jendela-aktif');

const FILE_ANTREAN = path.join(userData, 'antrean-unggah.json');
const HASIL_PASANG = path.join(__dirname, '..', 'cloud', '.hasil-pasang.json');
const HURUF = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';   // tanpa huruf yang mirip (0/O, 1/l/I)

let antrean = [];
let berjalan = false, timer = null;
const st = { terkirim: 0, errorTerakhir: '', sedang: null };

const pengaturan = () => { const u = readSettings().unggah || {}; return { aktif: !!u.aktif, url: u.url || '', kunci: u.kunci || '' }; };
const siap = () => { const p = pengaturan(); return p.aktif && !!p.url && !!p.kunci; };
const alamat = url => String(url || '').trim().replace(/\/+$/, '');
const kodeBaru = () => Array.from({ length: 10 }, () => HURUF[crypto.randomInt(HURUF.length)]).join('');
const linkFoto = kode => alamat(pengaturan().url) + '/f/' + kode;

function simpanAntrean() { try { writeJSON(FILE_ANTREAN, antrean); } catch (e) { console.log('Gagal menyimpan antrean unggah: ' + e.message); } }
function status() {
  const p = pengaturan();
  return { aktif: p.aktif, url: p.url, adaKunci: !!p.kunci, menunggu: antrean.length, terkirim: st.terkirim,
           errorTerakhir: st.errorTerakhir, sedang: st.sedang, adaHasilPasang: fs.existsSync(HASIL_PASANG) };
}
function kabarkan() {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('unggah-status', status());
}

// Kirim satu foto. Kembali: '' kalau berhasil, atau teks error.
async function kirim(item, p) {
  let data;
  try { data = fs.readFileSync(item.file); }
  catch (e) { return 'HILANG'; }
  const ctrl = new AbortController();
  const batas = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(`${alamat(p.url)}/u/${item.kode}`, {
      method: 'PUT', body: data, signal: ctrl.signal,
      headers: { authorization: 'Bearer ' + p.kunci, 'content-type': 'image/jpeg' },
    });
    if (r.ok) return '';
    let pesan = '';
    try { pesan = (await r.json()).error || ''; } catch (e) {}
    return `Server menolak (${r.status}${pesan ? ': ' + pesan : ''})`;
  } catch (e) {
    return e.name === 'AbortError' ? 'Unggah terlalu lama (internet lambat?)' : 'Tidak ada internet / server tidak terjangkau';
  } finally { clearTimeout(batas); }
}

// Jalankan antrean: satu per satu, yang gagal dicoba lagi dengan jeda makin lama (maks 1 menit)
async function jalankan() {
  clearTimeout(timer);
  if (berjalan) return;
  berjalan = true;
  try {
    while (antrean.length && siap()) {
      const sekarang = Date.now();
      const item = antrean.find(x => (x.berikut || 0) <= sekarang);
      if (!item) break;
      st.sedang = item.kode; kabarkan();
      const err = await kirim(item, pengaturan());
      st.sedang = null;
      if (!err || err === 'HILANG') {
        antrean = antrean.filter(x => x !== item);
        if (item.sid) updateSession(item.sid, { unggah: err ? 'hilang' : 'terkirim' });
        if (!err) { st.terkirim++; st.errorTerakhir = ''; }
      } else {
        item.coba = (item.coba || 0) + 1;
        item.berikut = Date.now() + Math.min(60000, 3000 * 2 ** Math.min(item.coba, 5));
        st.errorTerakhir = err;
        if (item.sid) updateSession(item.sid, { unggah: 'menunggu' });
      }
      simpanAntrean(); kabarkan();
    }
  } finally {
    berjalan = false;
    if (antrean.length && siap()) {
      const tunggu = Math.max(500, Math.min(...antrean.map(x => (x.berikut || 0) - Date.now())));
      timer = setTimeout(jalankan, tunggu);
    }
  }
}

// Dipanggil saat foto photobooth disimpan. Kembali: { kode, link } atau null kalau QR mati.
function daftarkanFoto(file, sid) {
  if (!siap()) return null;
  const kode = kodeBaru();
  antrean.push({ kode, file, sid, coba: 0, berikut: 0, dibuat: Date.now() });
  simpanAntrean();
  setImmediate(jalankan);
  return { kode, link: linkFoto(kode) };
}

async function tesSambungan(p = pengaturan()) {
  if (!p.url || !p.kunci) return { error: 'Isi alamat server dan kunci booth dulu.' };
  try {
    const r = await fetch(`${alamat(p.url)}/ping`, { headers: { authorization: 'Bearer ' + p.kunci }, signal: AbortSignal.timeout(10000) });
    if (r.status === 401) return { error: 'Kunci booth salah.' };
    if (!r.ok) return { error: `Server menjawab ${r.status}. Cek alamat server.` };
    const j = await r.json();
    return j.ok ? { ok: true, hari: j.hari } : { error: 'Jawaban server tidak dikenal.' };
  } catch (e) { return { error: 'Server tidak terjangkau. Cek internet dan alamat server.' }; }
}

function daftarkan() {
  ipcMain.handle('unggah-status', () => status());
  ipcMain.handle('unggah-simpan', (e, masuk) => {
    const s = readSettings(), lama = s.unggah || {};
    const url = alamat(masuk.url != null ? masuk.url : lama.url);
    // https wajib; http hanya untuk server uji di komputer ini
    if (url && !/^https:\/\/[^\s/]+/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) return { ...status(), error: 'Alamat server harus diawali https://' };
    const kunci = masuk.kunci != null ? String(masuk.kunci).trim() : lama.kunci || '';
    const aktif = masuk.aktif != null ? !!masuk.aktif : !!lama.aktif;
    if (aktif && (!url || !kunci)) return { ...status(), error: 'Isi alamat server dan kunci booth sebelum menyalakan QR.' };
    s.unggah = { aktif, url, kunci };
    writeSettings(s);
    setImmediate(jalankan);
    return status();
  });
  ipcMain.handle('unggah-tes', () => tesSambungan());
  // Isi alamat & kunci dari hasil "npm run cloud:pasang"
  ipcMain.handle('unggah-hasil-pasang', () => {
    const h = readJSON(HASIL_PASANG, null);
    if (!h || !h.url || !h.kunci) return { error: 'Belum ada hasil pemasangan. Jalankan dulu: npm run cloud:pasang' };
    return { url: h.url, kunci: h.kunci };
  });
  // Dari Riwayat sesi: buka link foto di browser / salin link
  ipcMain.handle('buka-link', (e, url) => {
    if (!/^https:\/\/[^\s]+$/.test(String(url || ''))) return { error: 'Link tidak valid.' };
    shell.openExternal(url); return { ok: true };
  });
  ipcMain.handle('salin-teks', (e, teks) => { clipboard.writeText(String(teks || '')); return { ok: true }; });
  ipcMain.handle('unggah-coba-sekarang', () => { antrean.forEach(x => { x.berikut = 0; }); simpanAntrean(); jalankan(); return status(); });
}
// Saat aplikasi dibuka: lanjutkan antrean yang tersisa
function mulai() {
  antrean = readJSON(FILE_ANTREAN, []);
  if (!Array.isArray(antrean)) antrean = [];
  antrean.forEach(x => { x.berikut = 0; });
  setTimeout(jalankan, 2000);
}

module.exports = { daftarkan, mulai, daftarkanFoto, status, kodeBaru };
