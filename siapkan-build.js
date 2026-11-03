// Jalankan sekali: node siapkan-build.js
// Skrip ini mengisi package.json supaya aplikasi bisa dibuat menjadi installer.
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

pkg.name = 'videobooth';
pkg.productName = 'Videobooth';
pkg.version = pkg.version || '1.0.0';
pkg.description = 'Wedding videobooth';
pkg.author = pkg.author || 'Leura';
pkg.main = 'main.js';
pkg.scripts = { ...(pkg.scripts || {}), start: 'electron main.js', build: 'electron-builder',
  test: 'node tests/uji-utama.js && node tests/uji-tampilan.js', 'test:utama': 'node tests/uji-utama.js' };
pkg.build = {
  appId: 'com.leura.videobooth',
  productName: 'Videobooth',
  // Semua file aplikasi yang ikut ke installer. Tambahkan di sini kalau ada file baru.
  files: ['main.js', 'preload.js', 'index.html', 'config.json', 'package.json', 'main/**/*', 'src/**/*', 'styles/**/*'],
  asarUnpack: ['node_modules/ffmpeg-static/**/*'],
  win: { target: 'nsis' },
  nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
  mac: {
    target: 'dmg',
    // Tanpa akun Apple Developer: tanda tangan "ad-hoc".
    // Tanpa ini, Mac Apple Silicon (M1/M2/M3/M4) menyebut aplikasinya "rusak" dan menolak membukanya.
    identity: '-',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    extendInfo: {
      NSCameraUsageDescription: 'Videobooth memakai kamera untuk merekam tamu.',
      NSMicrophoneUsageDescription: 'Videobooth memakai mikrofon untuk merekam suara tamu.'
    }
  }
};

// ffmpeg-static harus ikut ke dalam aplikasi (bagian "dependencies"), electron tidak boleh
const deps = pkg.dependencies || {}, dev = pkg.devDependencies || {};
if (dev['ffmpeg-static'] && !deps['ffmpeg-static']) { deps['ffmpeg-static'] = dev['ffmpeg-static']; delete dev['ffmpeg-static']; }
if (deps.electron) { dev.electron = deps.electron; delete deps.electron; }
pkg.dependencies = deps; pkg.devDependencies = dev;

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));
console.log('package.json siap untuk build.');
if (!deps['ffmpeg-static']) console.log('Catatan: ffmpeg-static belum terpasang, aplikasi akan menyimpan rekaman sebagai .webm.');
console.log('Versi aplikasi: ' + pkg.version);
