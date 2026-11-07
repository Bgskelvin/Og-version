/* pesan-sony.js — penjelasan kode error sambungan kamera Sony (dipakai aplikasi & npm run uji:sony) */
// Penjelasan kode error sambungan dari SDK Sony (CrError_Connect_*)
const PESAN_SAMBUNG = {
  '0x8208': 'Camera found but not responding. Turn the camera off and on, unplug and replug the USB cable, and close other apps using the camera (Image Capture, Photos, Imaging Edge). If it still fails, restart the Mac.',
  '0x820a': 'The camera refused the connection. Check the camera MENU: PC Remote = On, and no phone connected to the camera.',
  '0x820b': 'The camera is in use by another program. Close other apps using the camera, or turn the camera off and on.',
  '0x8210': 'The camera is held by another program on the Mac (session already open). Close other apps using the camera; if it still fails, restart the Mac.',
};
const jelaskanSambung = r => (r.kode && PESAN_SAMBUNG[String(r.kode).toLowerCase()]) ? `${PESAN_SAMBUNG[String(r.kode).toLowerCase()]} (${r.kode})` : (r.error || 'The Sony camera is not connected yet') + (r.kode ? ` (${r.kode})` : '');
module.exports = { jelaskanSambung, PESAN_SAMBUNG };
