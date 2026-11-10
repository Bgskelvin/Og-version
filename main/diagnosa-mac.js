/* =====================================================================
   diagnosa-mac.js — potret kondisi Mac saat kamera Sony tersambung / gagal.
   Ditulis ke catatan harian, supaya keadaan "berhasil" dan "gagal" bisa
   dibandingkan (mis. program macOS yang merebut kamera: ptpcamerad,
   mscamerad-xpc, icdd; atau kartu kamera yang muncul sebagai disk).
   Semua langkah diberi batas waktu dan tidak pernah membuat aplikasi gagal.
   ===================================================================== */
const { execFile } = require('child_process');
const fs = require('fs');

const POLA_PROSES =
  /ptpcamera|mscamera|icdd|sony-helper|Image Capture|Photos\.app|Imaging Edge|Remote Camera|cameracaptured/i;

const jalankan = (cmd, args, ms) =>
  new Promise(res => {
    execFile(cmd, args, { timeout: ms, maxBuffer: 8 * 1024 * 1024 }, (err, out) => res(err ? '' : String(out || '')));
  });

// Program terkait kamera: "nama (mulai jam)"
async function prosesKamera() {
  const out = await jalankan('ps', ['-axo', 'pid=,lstart=,comm='], 4000);
  return out
    .split('\n')
    .filter(l => POLA_PROSES.test(l))
    .map(l => {
      // "  512 Fri  6 Nov 16:05:13 2026 /usr/libexec/ptpcamerad" (urutan hari/bulan ikut bahasa Mac)
      const m = /^\s*(\d+)\s+(.*?(\d{1,2}:\d\d:\d\d)).*?\d{4}\s+(.*)$/.exec(l);
      return m ? `${m[4].split('/').pop()} (pid ${m[1]}, mulai ${m[3]})` : l.trim().split('/').pop();
    });
}
// Kamera Sony di daftar USB macOS (nama, kecepatan, nomor seri dipendekkan)
async function usbSony() {
  if (process.platform !== 'darwin') return [];
  // macOS baru memakai SPUSBHostDataType; macOS lama SPUSBDataType
  const out = await jalankan('system_profiler', ['SPUSBHostDataType', 'SPUSBDataType', '-detailLevel', 'mini'], 10000);
  const baris = out.split('\n'),
    hasil = [];
  baris.forEach((l, i) => {
    if (!/sony|ilce|054c/i.test(l)) return;
    const blok = baris
      .slice(i, i + 10)
      .map(x => x.trim())
      .filter(x => /:|^ILCE|Sony/i.test(x) && !/Serial Number/i.test(x));
    hasil.push(blok.slice(0, 6).join(' · '));
  });
  return [...new Set(hasil)].slice(0, 2);
}
// Disk yang terpasang (kartu kamera sebagai penyimpanan USB akan muncul di sini)
function diskTerpasang() {
  try {
    return fs.readdirSync('/Volumes').filter(v => !/^Macintosh HD|^com\.apple|^\./.test(v));
  } catch {
    return [];
  }
}

async function potret() {
  const [proses, usb] = await Promise.all([prosesKamera().catch(() => []), usbSony().catch(() => [])]);
  const disk = diskTerpasang();
  return [
    `proses kamera: ${proses.length ? proses.join('; ') : '(tidak ada)'}`,
    `USB: ${usb.length ? usb.join(' | ') : process.platform === 'darwin' ? '(kamera Sony tidak terlihat di USB)' : '(bukan Mac)'}`,
    `disk luar: ${disk.length ? disk.join(', ') : '(tidak ada)'}`,
  ];
}

module.exports = { potret, prosesKamera, diskTerpasang };
