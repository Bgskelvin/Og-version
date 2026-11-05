/* =====================================================================
   main.js — titik awal aplikasi (proses utama Electron)
   Isinya hanya urutan menyalakan aplikasi. Fitur-fiturnya ada di main/:
     penyimpanan.js  lokasi data, config.json, baca/tulis JSON yang aman
     pengaturan.js   pengaturan Admin, login, folder penyimpanan
     couple.js       data couple & couple aktif
     rekaman.js      perekaman video, MP4, pemulihan rekaman terputus
     foto.js         penyimpanan Photo Booth
     template.js     template desain foto per couple
     kamera-sony.js  kamera Sony lewat USB (program penghubung + simulasi)
     unggah.js       unduh foto lewat QR: antrean unggah ke Cloudflare
     jendela.js      jendela, menu, pengaman navigasi
   ===================================================================== */
const { app, session, systemPreferences, powerSaveBlocker } = require('electron');

// ---------- Hanya satu jendela aplikasi ----------
// Kalau ikon diklik lagi saat aplikasi sudah jalan, jendela yang ada dimunculkan,
// bukan membuka aplikasi kedua yang berebut kamera dan file data.
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
const DEV = process.argv.includes('--dev');   // npx electron main.js --dev  -> menu Reload & DevTools aktif

const rekaman = require('./main/rekaman');
const jendela = require('./main/jendela');
require('./main/pengaturan').daftarkan();
require('./main/couple').daftarkan();
require('./main/foto').daftarkan();
require('./main/template').daftarkan();
const kameraSony = require('./main/kamera-sony');
kameraSony.daftarkan();
const unggah = require('./main/unggah');
unggah.daftarkan();
rekaman.daftarkan();

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    await systemPreferences.askForMediaAccess('camera');
    await systemPreferences.askForMediaAccess('microphone');
  }
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media'));
  powerSaveBlocker.start('prevent-display-sleep'); // layar & PC tidak tidur selama aplikasi jalan

  rekaman.mulai();          // pulihkan rekaman terputus & lanjutkan konversi
  jendela.buatJendela(DEV);
  kameraSony.mulai();       // sambungkan kamera Sony kalau dipilih di Admin
  unggah.mulai();           // lanjutkan antrean unggah foto (QR) yang tersisa
});

app.on('second-instance', () => jendela.munculkan());
app.on('window-all-closed', () => app.quit());
// Saat keluar: tunggu kamera Sony diputus dengan rapi dulu (maks ±4 detik), baru aplikasi benar-benar tutup
let sudahBeres = false;
app.on('before-quit', e => {
  if (sudahBeres) return;
  e.preventDefault();
  rekaman.tutupSemua();
  Promise.resolve(kameraSony.matikan()).catch(() => {}).then(() => { sudahBeres = true; app.quit(); });
});
