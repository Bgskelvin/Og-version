/* =====================================================================
   main.js — titik awal aplikasi (proses utama Electron)
   Isinya hanya urutan menyalakan aplikasi. Fitur-fiturnya ada di main/:
     penyimpanan.js  lokasi data, config.json, baca/tulis JSON yang aman
     pengaturan.js   pengaturan Admin, login, folder penyimpanan
     couple.js       data couple & couple aktif
     rekaman.js      perekaman video, MP4, pemulihan rekaman terputus
     foto.js         penyimpanan Photo Booth
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
});

app.on('second-instance', () => jendela.munculkan());
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => rekaman.tutupSemua());
