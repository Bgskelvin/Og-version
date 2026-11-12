/* sony-messages.js — explanations for Sony camera connection error codes (used by the app & npm run uji:sony) */
// Explanations of connection error codes from the Sony SDK (CrError_Connect_*)
const CONNECT_ERRORS = {
  '0x8208':
    'Camera found but not responding. Turn the camera off and on, unplug and replug the USB cable, and close other apps using the camera (Image Capture, Photos, Imaging Edge). If it still fails, restart the Mac.',
  '0x820a':
    'The camera refused the connection. Check the camera MENU: PC Remote = On, and no phone connected to the camera.',
  '0x820b':
    'The camera is in use by another program. Close other apps using the camera, or turn the camera off and on.',
  '0x8210':
    'The camera is held by another program on the Mac (session already open). Close other apps using the camera; if it still fails, restart the Mac.',
};
// r: the helper's answer to "sambung" ({ error, kode })
const explainConnectError = r =>
  r.kode && CONNECT_ERRORS[String(r.kode).toLowerCase()]
    ? `${CONNECT_ERRORS[String(r.kode).toLowerCase()]} (${r.kode})`
    : (r.error || 'The Sony camera is not connected yet') + (r.kode ? ` (${r.kode})` : '');
module.exports = { explainConnectError, CONNECT_ERRORS };
