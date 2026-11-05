/* =====================================================================
   rekaman.js — perekaman video: menulis file, konversi ke MP4 (FFmpeg),
   pencatatan sesi, dan pemulihan rekaman yang terputus.
   Dengan kamera Sony: kamera merekam ke kartu SD, lalu file MP4-nya
   disalin ke folder couple di belakang layar (lihat kamera-sony.js).
   ===================================================================== */
const { ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { defaultDir, readSessions, writeSessions, updateSession, getOutDir, usableDir, safeName, coupleDir, stamp } = require('./penyimpanan');
const { activeCoupleName } = require('./couple');
const { getWin } = require('./jendela-aktif');
const sony = require('./kamera-sony');

/* ---------- FFmpeg: .webm -> .mp4 ---------- */
let ffmpegPath = null;
try {
  ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
} catch (e) {
  console.log('ffmpeg-static belum terpasang: rekaman tetap disimpan sebagai .webm');
}

let convChain = Promise.resolve();
function convert(id, webmPath) {
  if (!ffmpegPath) { updateSession(id, { status: 'webm' }); return; }
  convChain = convChain.then(() => new Promise(resolve => {
    const mp4 = webmPath.replace(/\.webm$/i, '.mp4');
    const p = spawn(ffmpegPath, [
      '-y', '-fflags', '+genpts', '-i', webmPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', mp4
    ], { stdio: 'ignore' });
    p.on('error', () => { updateSession(id, { status: 'failed' }); resolve(); });
    p.on('close', code => {
      try {
        if (code === 0 && fs.existsSync(mp4)) {
          const od = path.join(path.dirname(webmPath), 'original');
          fs.mkdirSync(od, { recursive: true });
          fs.renameSync(webmPath, path.join(od, path.basename(webmPath)));
          updateSession(id, { file: path.basename(mp4), status: 'done' });
        } else updateSession(id, { status: 'failed' });
      } catch (e) { updateSession(id, { status: 'failed' }); }
      resolve();
    });
  }));
}

const recs = new Map();  // setiap rekaman punya ID sendiri, jadi dua rekaman tidak bisa tercampur
let recSeq = 0;

function closeStream(rec) {
  return new Promise(res => {
    if (!rec.stream) return res();
    if (rec.stream.destroyed || rec.stream.writableEnded) return res();
    rec.stream.end(() => res());
    rec.stream.once('error', () => res());
  });
}

// Pulihkan rekaman yang terputus (aplikasi ditutup paksa, crash, atau listrik mati saat merekam).
// Potongan rekaman sudah tertulis ke disk setiap detik, jadi isinya bisa diselamatkan.
function recoverInterrupted() {
  const list = readSessions();
  // Video kamera Sony yang belum sempat disalin: file aslinya aman di kartu SD kamera
  let sonyAda = false;
  for (const s of list) {
    if (s.kamera === 'sony' && (s.status === 'recording' || s.status === 'transfer')) {
      s.status = 'card-only'; s.recovered = true; sonyAda = true;
    }
  }
  const found = list.filter(s => s.status === 'recording');
  if (!found.length) { if (sonyAda) writeSessions(list); return 0; }
  let recovered = 0;
  for (const s of found) {
    const p = path.join(s.dir || defaultDir, s.file);
    let st = null;
    try { st = fs.statSync(p); } catch (e) {}
    if (!st || st.size < 1024) { s.status = 'lost'; continue; }   // file tidak ada / kosong
    s.recovered = true;
    s.seconds = Math.max(0, Math.round((st.mtimeMs - Date.parse(s.time)) / 1000));  // perkiraan durasi
    s.status = ffmpegPath ? 'processing' : 'webm';
    recovered++;
  }
  writeSessions(list);
  console.log(`Rekaman terputus dipulihkan: ${recovered} dari ${found.length}`);
  return recovered;
}
// Tutup rekaman yang masih terbuka dan selamatkan isinya (dipakai saat tampilan aplikasi crash)
async function rescueOpenRecordings() {
  for (const rec of [...recs.values()]) {
    recs.delete(rec.id);
    await closeStream(rec);
  }
  const n = recoverInterrupted();
  readSessions().filter(x => x.status === 'processing').forEach(x => {
    const p = path.join(x.dir || defaultDir, x.file);
    if (fs.existsSync(p)) convert(x.id, p);
  });
  return n;
}
let recoveredCount = 0;

// Saat aplikasi dibuka: pulihkan rekaman yang terputus, lalu lanjutkan konversi yang belum selesai
function mulai() {
  recoveredCount = recoverInterrupted();
  readSessions().filter(s => s.status === 'processing').forEach(s => {
    const p = path.join(s.dir || defaultDir, s.file);
    if (fs.existsSync(p)) convert(s.id, p);
  });
}
// Saat tampilan aplikasi crash: selamatkan rekaman yang sedang berjalan
async function selamatkan() { recoveredCount = await rescueOpenRecordings(); }
// Saat aplikasi ditutup: tutup semua file rekaman yang masih terbuka
function tutupSemua() { for (const rec of recs.values()) { try { if (rec.stream) rec.stream.end(); } catch (e) {} } }

// Salin video Sony dari kartu ke folder couple, lalu perbarui catatan sesi
function salinVideoSony(sid, info, file) {
  sony.unduh(info, file).then(h => {
    if (h.ok) updateSession(sid, { status: 'done', file: path.basename(file) });
    else updateSession(sid, { status: 'card-only', error: h.error });
  });
}

function daftarkan() {
  ipcMain.handle('get-sessions', () => readSessions());

  /* ---------- Aksi per sesi (halaman Riwayat sesi di Admin) ---------- */
  const cariSesi = id => readSessions().find(s => s.id === id);
  const lokasi = s => path.join(s.dir || defaultDir, s.file || '');
  ipcMain.handle('session-open', async (e, id) => {
    const s = cariSesi(id);
    if (!s || !s.file || !fs.existsSync(lokasi(s))) return { error: 'File tidak ditemukan di folder.' };
    const err = await shell.openPath(lokasi(s));
    return err ? { error: err } : { ok: true };
  });
  ipcMain.handle('session-reveal', (e, id) => {
    const s = cariSesi(id);
    if (!s) return { error: 'Sesi tidak ditemukan.' };
    if (s.file && fs.existsSync(lokasi(s))) { shell.showItemInFolder(lokasi(s)); return { ok: true }; }
    if (fs.existsSync(s.dir || '')) { shell.openPath(s.dir); return { ok: true }; }
    return { error: 'Folder tidak ditemukan.' };
  });
  // Gambar kecil hasil photobooth untuk daftar sesi
  const cacheThumb = new Map();
  ipcMain.handle('session-thumb', (e, id) => {
    if (cacheThumb.has(id)) return cacheThumb.get(id);
    const s = cariSesi(id);
    if (!s || s.label !== 'foto' || !fs.existsSync(lokasi(s))) return null;
    let url = null;
    try {
      const { nativeImage } = require('electron');
      if (nativeImage) url = nativeImage.createFromPath(lokasi(s)).resize({ height: 160 }).toDataURL();
      else if (fs.statSync(lokasi(s)).size < 3e6) url = 'data:image/jpeg;base64,' + fs.readFileSync(lokasi(s)).toString('base64');
    } catch (err) {}
    cacheThumb.set(id, url);
    return url;
  });
  // Coba lagi: ubah ke MP4 lagi, atau salin lagi video dari kartu SD kamera Sony
  ipcMain.handle('session-retry', (e, id) => {
    const s = cariSesi(id);
    if (!s) return { error: 'Sesi tidak ditemukan.' };
    if (s.status === 'failed' || s.status === 'webm') {
      if (!ffmpegPath) return { error: 'FFmpeg belum terpasang, video tidak bisa diubah ke MP4.' };
      const webm = path.join(s.dir || defaultDir, String(s.file).replace(/\.mp4$/i, '.webm'));
      if (!fs.existsSync(webm)) return { error: 'File rekaman aslinya tidak ditemukan.' };
      updateSession(id, { status: 'processing' });
      convert(id, webm);
      return { ok: true };
    }
    if (s.status === 'card-only') {
      if (!s.kartuInfo) return { error: `Video hanya ada di kartu SD kamera${s.kartu ? ' (' + s.kartu + ')' : ''}. Salin manual dari kartunya.` };
      if (!sony.siap()) return { error: 'Sambungkan kamera Sony dulu, lalu coba lagi.' };
      updateSession(id, { status: 'transfer', error: undefined });
      salinVideoSony(id, s.kartuInfo, lokasi(s));
      return { ok: true };
    }
    return { error: 'Sesi ini tidak perlu diulang.' };
  });
  ipcMain.handle('get-startup-info', () => { const r = { recovered: recoveredCount }; recoveredCount = 0; return r; });

  ipcMain.handle('rec-start', async (e, label, opsi) => {
    const pakaiSony = !!(opsi && opsi.sony);
    const name = activeCoupleName();
    let base = getOutDir(), fallback = false;
    if (!usableDir(base)) {
      base = defaultDir; fallback = true;
      console.log('Folder pilihan tidak tersedia, memakai folder default');
      if (!usableDir(base)) return { error: 'Folder penyimpanan tidak bisa ditulisi.' };
    }
    let dir = coupleDir(base, name);
    if (!usableDir(dir)) dir = base;
    const prefix = safeName(name) ? safeName(name) + '_' : '';
    const ext = pakaiSony ? 'mp4' : 'webm';
    let file = path.join(dir, `${prefix}${stamp()}_${label}.${ext}`);
    let n = 2;
    while (fs.existsSync(file)) file = path.join(dir, `${prefix}${stamp()}_${label}_${n++}.${ext}`);

    const id = ++recSeq;
    const sid = Date.now() * 1000 + (id % 1000);
    const rec = { id, sid, file, dir, label, error: null, stream: null, t0: Date.now(), sony: pakaiSony };
    if (pakaiSony) {
      const r = await sony.rekamMulai();
      if (r.error) return { error: r.error };
    } else {
      try { rec.stream = fs.createWriteStream(file); }
      catch (err) { return { error: 'Tidak bisa membuat file rekaman: ' + err.message }; }
    }
    // Catat sesi sejak awal dengan status "recording". Kalau aplikasi atau komputer mati di tengah
    // rekaman, sesi ini dikenali dan dipulihkan saat aplikasi dibuka lagi.
    try {
      const list = readSessions();
      list.push({ id: sid, time: new Date(rec.t0).toISOString(), label, file: path.basename(file), dir,
        couple: name, seconds: 0, status: 'recording', ...(pakaiSony ? { kamera: 'sony' } : {}) });
      writeSessions(list);
    } catch (err) { console.log('Gagal mencatat sesi: ' + err.message); }
    // Disk penuh / SSD tercabut: jangan crash, catat error dan beri tahu layar
    if (rec.stream) rec.stream.on('error', err => {
      if (rec.error) return;
      rec.error = err.message;
      console.log('Gagal menulis rekaman: ' + err.message);
      const win = getWin();
      if (win) win.webContents.send('rec-error', id, err.message);
    });
    recs.set(id, rec);
    return { id, file, fallback };
  });

  ipcMain.on('rec-chunk', (e, id, buf) => {
    const rec = recs.get(id);
    if (rec && !rec.error && rec.stream && rec.stream.writable) rec.stream.write(Buffer.from(buf));
  });


  ipcMain.handle('rec-end', async (e, id, seconds, meta) => {
    const rec = recs.get(id);
    if (!rec) return null;
    recs.delete(id);
    const sid = rec.sid;
    if (rec.sony) {
      // Hentikan rekaman di kamera. Tamu tidak perlu menunggu video disalin.
      const r = await sony.rekamStop();
      const patch = { seconds, ...(meta || {}), ...(r.error ? { status: 'card-only', error: r.error }
        : { status: 'transfer', kartu: r.nama, kartuInfo: { slot: r.slot, contentId: r.contentId, fileId: r.fileId } }) };
      updateSession(sid, patch);
      if (!r.error) salinVideoSony(sid, r, rec.file);
      return r.error ? { ok: false, error: r.error } : { ok: true, file: rec.file };
    }
    await closeStream(rec);
    const ok = !rec.error;
    const patch = { seconds, status: !ok ? 'write-error' : (ffmpegPath ? 'processing' : 'webm'),
      ...(rec.error ? { error: rec.error } : {}), ...(meta || {}) };
    try {
      const list = readSessions();
      const s = list.find(x => x.id === sid);
      if (s) Object.assign(s, patch);
      else list.push({ id: sid, time: new Date(rec.t0).toISOString(), label: rec.label, file: path.basename(rec.file), dir: rec.dir, ...patch });
      writeSessions(list);
    } catch (err) { console.log('Gagal mencatat sesi: ' + err.message); }
    if (ok) convert(sid, rec.file);
    return { ok, file: rec.file, error: rec.error };
  });

  // Batalkan rekaman yang gagal dimulai: tutup dan hapus file yang belum berisi
  ipcMain.handle('rec-abort', async (e, id) => {
    const rec = recs.get(id);
    if (!rec) return;
    recs.delete(id);
    if (rec.sony) await sony.rekamStop();
    await closeStream(rec);
    try { if (!rec.sony && fs.statSync(rec.file).size < 1024) fs.unlinkSync(rec.file); } catch (err) {}
    try { writeSessions(readSessions().filter(x => x.id !== rec.sid)); } catch (err) {}
  });
}

module.exports = { daftarkan, mulai, selamatkan, tutupSemua };
