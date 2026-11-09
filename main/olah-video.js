/* =====================================================================
   olah-video.js — pengolahan video dengan FFmpeg (satu per satu, di belakang layar)
   - Teks pertanyaan quiz ditempel ke video (bagian bawah), hanya selama
     pertanyaan itu berlangsung. Video asli TANPA teks tetap disimpan di
     <folder couple>/original/<nama>_original.mp4. Video juga diberi bab
     per pertanyaan (QuickTime/VLC bisa lompat ke pertanyaan berikutnya).
   - "Versi HP" untuk unduh lewat QR: MP4 ringan 720p (atau 1080p, diatur di
     Admin) + gambar sampul, disimpan sementara di <folder data>/qr-video/
     lalu diserahkan ke antrean unggah (unggah.js).
   Urutan per sesi:  (webm → MP4)  →  tempel teks (quiz)  →  versi HP (kalau QR video aktif)
   Semua langkah dicatat di sessions.json, jadi kalau aplikasi ditutup di
   tengah jalan, pekerjaannya dilanjutkan saat aplikasi dibuka lagi.
   ===================================================================== */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { userData, defaultDir, readSessions, updateSession } = require('./penyimpanan');
const catatan = require('./catatan');

/* ---------- FFmpeg ---------- */
let ffmpegPath = null;
try {
  // LEURA_UJI_FFMPEG hanya dipakai uji otomatis (FFmpeg sungguhan di komputer uji)
  ffmpegPath = process.env.LEURA_UJI_FFMPEG || require('ffmpeg-static');
  if (ffmpegPath) ffmpegPath = ffmpegPath.replace('app.asar', 'app.asar.unpacked');
} catch {
  console.log('ffmpeg-static belum terpasang: rekaman tetap disimpan sebagai .webm');
}
const ada = () => !!ffmpegPath;

const FOLDER_KAPSI = path.join(userData, 'kapsi'); // gambar teks pertanyaan (PNG) dari tampilan
const FOLDER_HP = path.join(userData, 'qr-video'); // versi HP sementara, dihapus setelah terunggah
const MAKS_KAPSI = 20;

// Satu pekerjaan FFmpeg pada satu waktu (komputer booth tetap lancar untuk tamu berikutnya)
let rantai = Promise.resolve();
function antre(kerja) {
  const p = rantai.then(kerja).catch(e => catatan.error('Pengolahan video gagal: ' + e.message));
  rantai = p;
  return p;
}

function jalankan(args, batasMs = 60 * 60000) {
  return new Promise(resolve => {
    let galat = '';
    const p = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    const waktu = setTimeout(() => {
      try {
        p.kill('SIGKILL');
      } catch {
        /* FFmpeg sudah berhenti sendiri */
      }
    }, batasMs);
    p.stderr.on('data', d => {
      galat = (galat + d).slice(-4000);
    });
    p.on('error', err => {
      clearTimeout(waktu);
      resolve({ ok: false, galat: err.message });
    });
    p.on('close', code => {
      clearTimeout(waktu);
      resolve({ ok: code === 0, galat });
    });
  });
}
// Ukuran gambar video (memperhitungkan video yang diputar, mis. kamera tegak)
async function ukuran(file) {
  const r = await jalankan(['-i', file], 30000); // selalu "gagal" (tanpa output), yang dibaca keterangannya
  const baris = (r.galat.match(/Stream #\d+:\d+[^\n]*Video:[^\n]*/) || [''])[0];
  const m = baris.match(/[ ,](\d{2,5})x(\d{2,5})[ ,[]/);
  if (!m) return null;
  let w = Number(m[1]),
    h = Number(m[2]);
  if (/rotation of -?90/.test(r.galat)) [w, h] = [h, w];
  const kbps = Number((r.galat.match(/bitrate: (\d+) kb\/s/) || [])[1]) || 0;
  return { w, h, kbps };
}
// Pengode video: di Mac memakai chip video (cepat, hemat), selain itu libx264
const pengodeMac = kbps => [
  '-c:v',
  'h264_videotoolbox',
  '-b:v',
  Math.max(2500, Math.min(kbps || 12000, 60000)) + 'k',
  '-allow_sw',
  '1',
];
const pengodeUmum = crf => ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf)];
async function kode(argsDepan, argsBelakang, keluar, { kbps, crf = 20 } = {}) {
  if (process.platform === 'darwin') {
    const r = await jalankan([...argsDepan, ...pengodeMac(kbps), '-pix_fmt', 'yuv420p', ...argsBelakang, keluar]);
    if (r.ok) return r;
    catatan.peringatan('Pengode video Mac gagal, memakai libx264: ' + r.galat.split('\n').filter(Boolean).slice(-1)[0]);
  }
  return jalankan([...argsDepan, ...pengodeUmum(crf), '-pix_fmt', 'yuv420p', ...argsBelakang, keluar]);
}
const hapus = f => {
  try {
    fs.unlinkSync(f);
  } catch {
    /* file sementara sudah tidak ada */
  }
};
const lokasi = s => path.join(s.dir || defaultDir, s.file || '');
const cariSesi = sid => readSessions().find(s => s.id === sid);

/* ---------- Gambar teks pertanyaan (dibuat di tampilan, disimpan di sini) ---------- */
// kapsi: [{ a, b }] detik mulai & selesai tiap pertanyaan; gambar: PNG (Uint8Array) per pertanyaan
function simpanKapsi(sid, kapsi, gambar) {
  if (!Array.isArray(kapsi) || !Array.isArray(gambar) || !kapsi.length) return null;
  const bersih = [];
  try {
    fs.mkdirSync(FOLDER_KAPSI, { recursive: true });
    for (let i = 0; i < Math.min(kapsi.length, gambar.length, MAKS_KAPSI); i++) {
      const a = Number(kapsi[i] && kapsi[i].a),
        b = Number(kapsi[i] && kapsi[i].b);
      const u = gambar[i] instanceof Uint8Array ? gambar[i] : new Uint8Array(gambar[i] || []);
      if (!(a >= 0) || !(b > a) || u.length < 8 || u.length > 4 * 1024 * 1024 || u[0] !== 0x89 || u[1] !== 0x50)
        continue;
      fs.writeFileSync(path.join(FOLDER_KAPSI, `${sid}-${bersih.length + 1}.png`), Buffer.from(u));
      bersih.push({
        a: Math.round(a * 100) / 100,
        b: Math.round(b * 100) / 100,
        ...(kapsi[i].judul ? { judul: String(kapsi[i].judul).slice(0, 300) } : {}),
      });
    }
  } catch (e) {
    catatan.peringatan('Teks pertanyaan quiz gagal disimpan: ' + e.message);
    return null;
  }
  return bersih.length ? bersih : null;
}
const fileKapsi = (sid, i) => path.join(FOLDER_KAPSI, `${sid}-${i + 1}.png`);
const hapusKapsi = s => (s.kapsi || []).forEach((_, i) => hapus(fileKapsi(s.id, i)));

// Bab per pertanyaan (format FFMETADATA)
function teksBab(kapsi, durasiAkhir) {
  const esc = t => String(t).replace(/([=;#\\\n])/g, '\\$1');
  return (
    ';FFMETADATA1\n' +
    kapsi
      .map((k, i) => {
        const akhir = i + 1 < kapsi.length ? kapsi[i + 1].a : Math.max(k.b, durasiAkhir || k.b);
        return `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(i ? k.a * 1000 : 0)}\nEND=${Math.round(akhir * 1000)}\ntitle=${esc(`${i + 1}. ${k.judul || ''}`.trim())}\n`;
      })
      .join('')
  );
}

// Tempel teks pertanyaan ke video quiz. Video asli tanpa teks → original/<nama>_original.mp4
async function tempelTeks(sid) {
  const s = cariSesi(sid);
  if (!s || !s.kapsi || !s.kapsi.length || !s.file) return;
  const utama = lokasi(s);
  const folderAsli = path.join(path.dirname(utama), 'original');
  const asli = path.join(folderAsli, s.file.replace(/\.mp4$/i, '') + '_original.mp4');
  const sementara = path.join(path.dirname(utama), '.' + s.file.replace(/\.mp4$/i, '') + '.teks.mp4');
  const sumber = fs.existsSync(asli) ? asli : utama; // kalau diulang: mulai lagi dari video asli
  if (!fs.existsSync(sumber)) {
    updateSession(sid, { status: 'done', teks: 'gagal', error: 'Video file not found for adding the questions' });
    return;
  }
  const gambar = s.kapsi.map((_, i) => fileKapsi(sid, i));
  if (gambar.some(g => !fs.existsSync(g))) {
    updateSession(sid, { status: 'done', teks: 'gagal', error: 'Question text images are missing' });
    return;
  }
  updateSession(sid, { status: 'teks', teks: 'proses' });
  const uk = await ukuran(sumber);
  if (!uk) {
    updateSession(sid, { status: 'done', teks: 'gagal', error: 'Could not read the video size' });
    return;
  }
  // Gambar teks dirancang selebar 1920 piksel; disesuaikan ke lebar video, menempel di bawah
  const filter = [];
  let akhir = '0:v';
  gambar.forEach((_, i) => {
    const k = s.kapsi[i];
    filter.push(`[${i + 1}:v]scale=${uk.w}:-2[k${i}]`);
    filter.push(`[${akhir}][k${i}]overlay=0:H-h:enable='between(t,${k.a},${k.b})'[v${i}]`);
    akhir = `v${i}`;
  });
  const fileBab = path.join(FOLDER_KAPSI, `${sid}-bab.txt`);
  fs.writeFileSync(fileBab, teksBab(s.kapsi, s.seconds));
  const masuk = ['-i', sumber, ...gambar.flatMap(g => ['-i', g]), '-f', 'ffmetadata', '-i', fileBab];
  const r = await kode(
    masuk,
    [
      '-filter_complex',
      filter.join(';'),
      '-map',
      `[${akhir}]`,
      '-map',
      '0:a?',
      '-map_chapters',
      String(gambar.length + 1),
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
    ],
    sementara,
    { kbps: uk.kbps, crf: 20 },
  );
  hapus(fileBab);
  if (!r.ok || !fs.existsSync(sementara)) {
    hapus(sementara);
    catatan.error(
      `Teks pertanyaan gagal ditempel (${s.file}): ${r.galat.split('\n').filter(Boolean).slice(-1)[0] || 'FFmpeg error'}`,
    );
    updateSession(sid, { status: 'done', teks: 'gagal' });
    return;
  }
  try {
    if (sumber === utama) {
      fs.mkdirSync(folderAsli, { recursive: true });
      fs.renameSync(utama, asli);
    }
    fs.renameSync(sementara, utama);
  } catch (e) {
    hapus(sementara);
    catatan.error(`Teks pertanyaan gagal disimpan (${s.file}): ${e.message}`);
    updateSession(sid, { status: 'done', teks: 'gagal' });
    return;
  }
  hapusKapsi(s);
  updateSession(sid, {
    status: 'done',
    teks: 'selesai',
    fileAsli: path.relative(path.dirname(utama), asli),
    error: undefined,
  });
  catatan.catat(`Teks pertanyaan ditempel: ${s.file} (asli: original/${path.basename(asli)})`);
}

/* ---------- Versi HP untuk unduh lewat QR ---------- */
const fileHp = sid => path.join(FOLDER_HP, `${sid}.mp4`);
const filePoster = sid => path.join(FOLDER_HP, `${sid}.jpg`);
async function versiHp(sid, kualitas) {
  const s = cariSesi(sid);
  if (!s || !s.kode) return null;
  const sumber = lokasi(s);
  if (!s.file || !fs.existsSync(sumber)) return { error: 'Video file not found' };
  fs.mkdirSync(FOLDER_HP, { recursive: true });
  const p = kualitas === '1080' ? 1080 : 720;
  // Sisi pendek video = 720 (atau 1080); video yang lebih kecil tidak diperbesar
  const skala = `scale=w='if(gt(iw\\,ih)\\,-2\\,min(${p}\\,iw))':h='if(gt(iw\\,ih)\\,min(${p}\\,ih)\\,-2)'`;
  const keluar = fileHp(sid),
    poster = filePoster(sid);
  const r = await kode(
    ['-i', sumber],
    [
      '-vf',
      skala,
      '-r',
      '30',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      ...(process.platform === 'darwin'
        ? []
        : ['-maxrate', p === 1080 ? '6000k' : '3000k', '-bufsize', p === 1080 ? '12000k' : '6000k']),
    ],
    keluar,
    { kbps: p === 1080 ? 6000 : 3000, crf: p === 1080 ? 23 : 26 },
  );
  if (!r.ok || !fs.existsSync(keluar)) {
    hapus(keluar);
    return { error: r.galat.split('\n').filter(Boolean).slice(-1)[0] || 'FFmpeg error' };
  }
  const g = await jalankan(
    ['-ss', s.seconds > 2 ? '1' : '0', '-i', keluar, '-frames:v', '1', '-q:v', '4', poster],
    60000,
  );
  return { file: keluar, poster: g.ok && fs.existsSync(poster) ? poster : null };
}

/* ---------- Jalur lengkap setelah video MP4 siap ---------- */
let unggah = null; // diisi dari rekaman.js (menghindari require melingkar)
function pakaiUnggah(u) {
  unggah = u;
}
async function lanjutkan(sid) {
  let s = cariSesi(sid);
  if (!s || !['done', 'teks'].includes(s.status) || !ada()) return;
  if (s.kapsi && s.kapsi.length && s.teks !== 'selesai' && s.teks !== 'gagal') {
    await tempelTeks(sid);
    s = cariSesi(sid);
  }
  if (s && s.kode && s.unggah === 'olah' && unggah) {
    const h = await versiHp(sid, unggah.kualitasVideo());
    if (!h || h.error) {
      catatan.error(`Versi HP untuk QR gagal dibuat (${s.file}): ${h ? h.error : '-'}`);
      updateSession(sid, { unggah: 'gagal' });
      unggah.videoGagal(s.kode);
      return;
    }
    updateSession(sid, { unggah: 'antre' });
    unggah.videoSiap(s.kode, h.file, h.poster);
    catatan.catat(`Versi HP siap untuk QR ${s.kode}: ${(fs.statSync(h.file).size / 1048576).toFixed(1)} MB`);
  }
}
const lanjutkanNanti = sid => antre(() => lanjutkan(sid));

// Saat aplikasi dibuka: lanjutkan pekerjaan yang terputus
function mulai() {
  if (!ada()) return;
  for (const s of readSessions()) {
    if (s.status === 'teks') {
      updateSession(s.id, { status: 'done', teks: undefined });
      lanjutkanNanti(s.id);
    } else if (s.status === 'done' && ((s.kapsi && s.kapsi.length && !s.teks) || s.unggah === 'olah'))
      lanjutkanNanti(s.id);
  }
  // Bersihkan file sementara yang tertinggal
  try {
    for (const f of fs.readdirSync(FOLDER_KAPSI)) if (f.endsWith('-bab.txt')) hapus(path.join(FOLDER_KAPSI, f));
  } catch {
    /* folder gambar teks belum ada */
  }
}

module.exports = {
  ada,
  path: () => ffmpegPath,
  antre,
  jalankan,
  simpanKapsi,
  lanjutkanNanti,
  mulai,
  pakaiUnggah,
  fileHp,
  filePoster,
  FOLDER_HP,
};
