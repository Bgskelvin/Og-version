/* pesan-sony.js — penjelasan kode error sambungan kamera Sony (dipakai aplikasi & npm run uji:sony) */
// Penjelasan kode error sambungan dari SDK Sony (CrError_Connect_*)
const PESAN_SAMBUNG = {
  '0x8208': 'Kamera ditemukan tapi tidak menjawab. Matikan lalu nyalakan kamera, cabut-pasang kabel USB, dan tutup aplikasi lain yang memakai kamera (Image Capture, Foto, Imaging Edge). Kalau tetap gagal, restart Mac.',
  '0x820a': 'Kamera menolak sambungan. Cek MENU kamera: PC Remote = On, dan HP tidak sedang tersambung ke kamera.',
  '0x820b': 'Kamera sedang dipakai program lain. Tutup aplikasi lain yang memakai kamera, atau matikan-nyalakan kamera.',
  '0x8210': 'Kamera sedang dipegang program lain di Mac (sesi sudah terbuka). Tutup aplikasi lain yang memakai kamera; kalau tetap gagal, restart Mac.',
};
const jelaskanSambung = r => (r.kode && PESAN_SAMBUNG[String(r.kode).toLowerCase()]) ? `${PESAN_SAMBUNG[String(r.kode).toLowerCase()]} (${r.kode})` : (r.error || 'Kamera Sony belum tersambung') + (r.kode ? ` (${r.kode})` : '');
module.exports = { jelaskanSambung, PESAN_SAMBUNG };
