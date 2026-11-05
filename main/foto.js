/* =====================================================================
   foto.js — menyimpan hasil Photo Booth (4 foto asli + 1 hasil edit)
   ===================================================================== */
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { defaultDir, readSessions, writeSessions, getOutDir, usableDir, safeName, coupleDir, stamp } = require('./penyimpanan');
const { activeCoupleName } = require('./couple');
const unggah = require('./unggah');

function daftarkan() {
  // ---------- Photo Booth: simpan 4 foto asli + 1 hasil edit ----------
  // Lokasi: <folder penyimpanan>/<nama couple>/Foto/
  ipcMain.handle('save-photos', async (e, payload) => {
    try {
      const { originals = [], result, meta = {} } = payload || {};
      if (!result || !originals.length) return { ok: false, error: 'Data foto kosong' };
      const name = activeCoupleName();
      let base = getOutDir();
      if (!usableDir(base)) { base = defaultDir; if (!usableDir(base)) return { ok: false, error: 'Folder penyimpanan tidak bisa ditulisi.' }; }
      const dir = path.join(coupleDir(base, name), 'Foto');
      if (!usableDir(dir)) return { ok: false, error: 'Folder foto tidak bisa dibuat.' };
      const prefix = (safeName(name) ? safeName(name) + '_' : '') + stamp();
      let tag = '', n = 2;
      while (fs.existsSync(path.join(dir, `${prefix}${tag}_hasil.jpg`))) tag = '_' + n++;
      const files = [];
      for (let i = 0; i < originals.length; i++) {
        const f = `${prefix}${tag}_foto-${i + 1}.jpg`;
        await fs.promises.writeFile(path.join(dir, f), Buffer.from(originals[i]));
        files.push(f);
      }
      const hasil = `${prefix}${tag}_hasil.jpg`;
      await fs.promises.writeFile(path.join(dir, hasil), Buffer.from(result));
      // Unduh lewat QR (kalau dinyalakan di Admin): kode & link langsung ada, unggahnya menyusul di belakang
      const sid = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      let qr = null;
      try {
        const list = readSessions();
        qr = unggah.daftarkanFoto(path.join(dir, hasil), sid);
        list.push({ id: sid, time: new Date().toISOString(), label: 'foto', file: hasil, dir, couple: name, seconds: 0, status: 'photo',
          photos: originals.length, originalFiles: files, ...(qr ? { kode: qr.kode, unggah: 'antre' } : {}), ...meta });
        writeSessions(list);
      } catch (err) { console.log('Gagal mencatat sesi foto: ' + err.message); }
      return { ok: true, file: path.join(dir, hasil), link: qr ? qr.link : null };
    } catch (err) {
      console.log('Gagal menyimpan foto: ' + err.message);
      return { ok: false, error: err.message };
    }
  });
}

module.exports = { daftarkan };
