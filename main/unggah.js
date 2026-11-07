/* =====================================================================
   unggah.js — unduh foto lewat QR: kode, link, dan antrean unggah.
   - Setiap sesi photobooth mendapat kode acak; link & QR langsung ada,
     walau internet sedang putus.
   - Foto hasil masuk antrean yang tersimpan di disk (antrean-unggah.json),
     diunggah satu per satu ke server Cloudflare (cloud/worker.mjs), dan
     dicoba lagi otomatis kalau gagal — juga setelah aplikasi dibuka lagi.
   - Foto satuan (1-4, tanpa template) ikut diunggah SETELAH semua foto hasil
     terkirim, supaya setiap QR cepat bisa dibuka. Disimpan sementara di
     <folder data>/qr-satuan/ dan dihapus setelah terkirim.
   ===================================================================== */
const { ipcMain, shell, clipboard } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { userData, readJSON, writeJSON, readSettings, writeSettings, updateSession } = require('./penyimpanan');
const { getWin } = require('./jendela-aktif');
const catatan = require('./catatan');

const FILE_ANTREAN = path.join(userData, 'antrean-unggah.json');
const FOLDER_SATUAN = path.join(userData, 'qr-satuan');
const MAKS_SATUAN = 4;
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
  return { aktif: p.aktif, url: p.url, adaKunci: !!p.kunci, menunggu: antrean.filter(x => !x.hasilTerkirim).length,
           menungguSatuan: antrean.reduce((n, x) => n + sisaSatuan(x).length, 0), terkirim: st.terkirim,
           errorTerakhir: st.errorTerakhir, sedang: st.sedang, adaHasilPasang: fs.existsSync(HASIL_PASANG) };
}
function kabarkan() {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('unggah-status', status());
}

// Simpan foto satuan sementara (untuk diunggah). Kembali: daftar alamat file.
async function simpanSatuan(sid, satuan) {
  const out = [];
  if (!Array.isArray(satuan)) return out;
  try {
    for (const [i, b] of satuan.slice(0, MAKS_SATUAN).entries()) {
      const u = b instanceof Uint8Array ? b : new Uint8Array(b || []);
      if (u.length < 4 || u.length > 15 * 1024 * 1024 || u[0] !== 0xFF || u[1] !== 0xD8) continue;
      fs.mkdirSync(FOLDER_SATUAN, { recursive: true });
      const f = path.join(FOLDER_SATUAN, `${sid}-${i + 1}.jpg`);
      await fs.promises.writeFile(f, Buffer.from(u));
      out.push(f);
    }
  } catch (e) { catatan.peringatan('Foto satuan untuk QR gagal disimpan: ' + e.message); }
  return out;
}
const hapusFile = f => { try { fs.unlinkSync(f); } catch (e) {} };
const sisaSatuan = item => (item.satuan || []).map((f, i) => i + 1).filter(n => !(item.satuanTerkirim || []).includes(n));

// Server lama (sebelum ada foto satuan) akan MENIMPA foto hasil kalau diberi foto satuan.
// Jadi tanya dulu sekali: server baru menjawab /ping dengan satuan: true.
let dukungSatuan = null;
async function serverDukungSatuan(p) {
  if (dukungSatuan === null) {
    try {
      const r = await fetch(`${alamat(p.url)}/ping`, { headers: { authorization: 'Bearer ' + p.kunci }, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;                                       // belum tahu (internet?) — coba lagi nanti
      dukungSatuan = !!(await r.json()).satuan;
      if (!dukungSatuan) catatan.peringatan('Server QR versi lama: foto satuan tidak diunggah. Jalankan "npm run cloud:pasang" untuk memperbarui server.');
    } catch (e) { return null; }
  }
  return dukungSatuan;
}

// Kirim satu foto (n = 0: foto hasil, 1-4: foto satuan). Kembali: '' kalau berhasil, atau teks error.
async function kirim(item, p, n = 0) {
  let data;
  try { data = fs.readFileSync(n ? item.satuan[n - 1] : item.file); }
  catch (e) { return 'HILANG'; }
  const ctrl = new AbortController();
  const batas = setTimeout(() => ctrl.abort(), 60000);
  const headers = { authorization: 'Bearer ' + p.kunci, 'content-type': 'image/jpeg' };
  if (!n) {
    headers['x-leura-jumlah'] = String((item.satuan || []).length);
    if (item.couple) headers['x-leura-couple'] = encodeURIComponent(item.couple);
  }
  try {
    const r = await fetch(`${alamat(p.url)}/u/${item.kode}${n ? '/' + n : ''}`, { method: 'PUT', body: data, signal: ctrl.signal, headers });
    if (r.ok) return '';
    let pesan = '';
    try { pesan = (await r.json()).error || ''; } catch (e) {}
    return `Server refused (${r.status}${pesan ? ': ' + pesan : ''})`;
  } catch (e) {
    return e.name === 'AbortError' ? 'Upload took too long (slow internet?)' : 'No internet / server unreachable';
  } finally { clearTimeout(batas); }
}

// Selesai dengan satu item: keluarkan dari antrean & hapus foto satuan sementara
function selesaiItem(item) {
  antrean = antrean.filter(x => x !== item);
  (item.satuan || []).forEach(hapusFile);
}

// Jalankan antrean: satu per satu, yang gagal dicoba lagi dengan jeda makin lama (maks 1 menit).
// Urutan: semua foto hasil dulu (supaya QR cepat bisa dibuka), baru foto satuan.
async function jalankan() {
  clearTimeout(timer);
  if (berjalan) return;
  berjalan = true;
  try {
    while (antrean.length && siap()) {
      const sekarang = Date.now(), siapKirim = x => (x.berikut || 0) <= sekarang;
      let item = antrean.find(x => !x.hasilTerkirim && siapKirim(x)), n = 0;
      if (!item && !antrean.some(x => !x.hasilTerkirim)) {
        item = antrean.find(x => siapKirim(x) && sisaSatuan(x).length);
        if (item) {
          const dukung = await serverDukungSatuan(pengaturan());
          if (dukung === false) { antrean.filter(x => x.hasilTerkirim).forEach(selesaiItem); simpanAntrean(); kabarkan(); continue; }
          if (dukung === null) { item.berikut = Date.now() + 15000; simpanAntrean(); continue; }
          n = sisaSatuan(item)[0];
        }
      }
      if (!item) break;
      st.sedang = item.kode; kabarkan();
      const err = await kirim(item, pengaturan(), n);
      st.sedang = null;
      if (n && (!err || err === 'HILANG')) {                     // foto satuan
        item.satuanTerkirim = [...(item.satuanTerkirim || []), n];
        if (err) catatan.peringatan(`QR ${item.kode}: foto satuan ${n} hilang, dilewati`);
        item.coba = 0; st.errorTerakhir = err ? st.errorTerakhir : '';
        if (!sisaSatuan(item).length) { selesaiItem(item); catatan.catat(`QR ${item.kode}: ${item.satuan.length} foto satuan terkirim`); }
      } else if (!err || err === 'HILANG') {                    // foto hasil
        if (err) catatan.error(`QR ${item.kode}: file foto hilang, tidak bisa dikirim (${path.basename(item.file)})`);
        else catatan.catat(`QR ${item.kode}: foto terkirim${item.coba ? ` (setelah ${item.coba}x gagal)` : ''}`);
        item.hasilTerkirim = true; item.coba = 0;
        if (err || !sisaSatuan(item).length) selesaiItem(item);
        if (item.sid) updateSession(item.sid, { unggah: err ? 'hilang' : 'terkirim' });
        if (!err) { st.terkirim++; st.errorTerakhir = ''; }
      } else {
        item.coba = (item.coba || 0) + 1;
        if (err !== st.errorTerakhir) catatan.peringatan(`QR ${item.kode}: ${n ? 'foto satuan ' + n + ' ' : ''}belum terkirim — ${err} (dicoba lagi otomatis)`);
        item.berikut = Date.now() + Math.min(60000, 3000 * 2 ** Math.min(item.coba, 5));
        st.errorTerakhir = err;
        if (item.sid && !n) updateSession(item.sid, { unggah: 'menunggu' });
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
// opsi.satuan: file foto satuan (dari simpanSatuan); opsi.couple: nama couple untuk halaman unduh
function daftarkanFoto(file, sid, opsi = {}) {
  if (!siap()) { (opsi.satuan || []).forEach(hapusFile); return null; }
  const kode = kodeBaru();
  antrean.push({ kode, file, sid, satuan: (opsi.satuan || []).slice(0, MAKS_SATUAN), satuanTerkirim: [], couple: String(opsi.couple || '').slice(0, 80),
                 hasilTerkirim: false, coba: 0, berikut: 0, dibuat: Date.now() });
  simpanAntrean();
  setImmediate(jalankan);
  return { kode, link: linkFoto(kode) };
}

async function tesSambungan(p = pengaturan()) {
  if (!p.url || !p.kunci) return { error: 'Enter the server address and booth key first.' };
  try {
    const r = await fetch(`${alamat(p.url)}/ping`, { headers: { authorization: 'Bearer ' + p.kunci }, signal: AbortSignal.timeout(10000) });
    if (r.status === 401) return { error: 'Wrong booth key.' };
    if (!r.ok) return { error: `Server answered ${r.status}. Check the server address.` };
    const j = await r.json();
    return j.ok ? { ok: true, hari: j.hari } : { error: 'Unknown server response.' };
  } catch (e) { return { error: 'Server unreachable. Check the internet and the server address.' }; }
}

function daftarkan() {
  ipcMain.handle('unggah-status', () => status());
  ipcMain.handle('unggah-simpan', (e, masuk) => {
    const s = readSettings(), lama = s.unggah || {};
    const url = alamat(masuk.url != null ? masuk.url : lama.url);
    // https wajib; http hanya untuk server uji di komputer ini
    if (url && !/^https:\/\/[^\s/]+/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) return { ...status(), error: 'The server address must start with https://' };
    const kunci = masuk.kunci != null ? String(masuk.kunci).trim() : lama.kunci || '';
    const aktif = masuk.aktif != null ? !!masuk.aktif : !!lama.aktif;
    if (aktif && (!url || !kunci)) return { ...status(), error: 'Enter the server address and booth key before turning the QR on.' };
    s.unggah = { aktif, url, kunci };
    writeSettings(s);
    dukungSatuan = null;                     // server bisa berganti: tanya lagi
    catatan.catat(`Pengaturan QR disimpan: ${aktif ? 'aktif' : 'mati'}, server ${url || '-'}`);   // kunci tidak pernah dicatat
    setImmediate(jalankan);
    return status();
  });
  ipcMain.handle('unggah-tes', () => tesSambungan());
  // Isi alamat & kunci dari hasil "npm run cloud:pasang"
  ipcMain.handle('unggah-hasil-pasang', () => {
    const h = readJSON(HASIL_PASANG, null);
    if (!h || !h.url || !h.kunci) return { error: 'No setup result yet. Run first: npm run cloud:pasang' };
    return { url: h.url, kunci: h.kunci };
  });
  // Dari Riwayat sesi: buka link foto di browser / salin link
  ipcMain.handle('buka-link', (e, url) => {
    if (!/^https:\/\/[^\s]+$/.test(String(url || ''))) return { error: 'Invalid link.' };
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
  // Bersihkan foto satuan sementara yang tidak ada lagi di antrean
  try {
    const dipakai = new Set(antrean.flatMap(x => x.satuan || []));
    for (const f of fs.readdirSync(FOLDER_SATUAN)) { const p = path.join(FOLDER_SATUAN, f); if (!dipakai.has(p)) hapusFile(p); }
  } catch (e) {}
  setTimeout(jalankan, 2000);
}

module.exports = { daftarkan, mulai, daftarkanFoto, simpanSatuan, siap, status, kodeBaru };
