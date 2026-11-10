/* =====================================================================
   keluar.js — menutup aplikasi dengan konfirmasi.
   Tombol "Tutup aplikasi" di Admin, tombol ✕ merah jendela, dan ⌘Q
   semuanya memunculkan dialog yang sama ("Tutup aplikasi?" + peringatan
   video/foto QR yang belum selesai). Baru setelah dipilih "Tutup aplikasi",
   aplikasi ditutup lewat jalur resmi (app.quit), sehingga di main.js
   rekaman ditutup dan kamera Sony diputus dengan rapi.
   Mac dimatikan / restart: langsung ditutup tanpa bertanya.
   ===================================================================== */
const { ipcMain, app } = require('electron');
const { readSessions } = require('./penyimpanan');
const { getWin } = require('./jendela-aktif');
const unggah = require('./unggah');

let dikonfirmasi = false;
const boleh = () => dikonfirmasi;

// Hal yang masih berjalan, untuk peringatan sebelum menutup
function cekSebelumTutup() {
  let salin = 0,
    proses = 0;
  try {
    for (const s of readSessions()) {
      if (s.status === 'transfer') salin++;
      else if (s.status === 'processing') proses++;
    }
  } catch {
    /* sessions.json tidak terbaca: dianggap tidak ada video yang diproses */
  }
  let foto = 0;
  try {
    foto = unggah.status().menunggu || 0;
  } catch {
    /* antrean QR belum dimuat: dianggap kosong */
  }
  return { salin, proses, foto };
}

// ✕ atau ⌘Q ditekan: minta tampilan memunculkan dialog konfirmasi.
// Kalau tampilan tidak ada / crash, tutup saja (jangan sampai aplikasi tidak bisa ditutup).
function minta(asal) {
  const win = getWin();
  const wc = win && !win.isDestroyed() ? win.webContents : null;
  if (!wc || (wc.isCrashed && wc.isCrashed())) {
    dikonfirmasi = true;
    app.quit();
    return;
  }
  require('./catatan').catat(`Tutup aplikasi diminta (${asal}) — menunggu konfirmasi`);
  wc.send('minta-tutup');
}

function daftarkan() {
  ipcMain.handle('cek-tutup', () => cekSebelumTutup());
  ipcMain.handle('tutup-aplikasi', () => {
    require('./catatan').catat('Tutup aplikasi dikonfirmasi');
    dikonfirmasi = true;
    setTimeout(() => app.quit(), 300);
    return { ok: true };
  });
  // Mac dimatikan / restart / logout: jangan menghalangi
  app.whenReady().then(() => {
    try {
      require('electron').powerMonitor.on('shutdown', () => {
        dikonfirmasi = true;
      });
    } catch {
      /* powerMonitor belum siap (sebelum app ready) */
    }
  });
}

module.exports = { daftarkan, cekSebelumTutup, boleh, minta };
