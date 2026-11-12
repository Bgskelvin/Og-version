/* =====================================================================
   start.js — the app's entry module (<script type="module"> in index.html).
   Runs after all plain scripts: loads settings & couples, wires up every
   feature's buttons, then opens the camera.
   ===================================================================== */
import './debug-handle.js'; // window.__leura for the UI tests and the phone demo
import { setupAdmin } from './admin.js';
import { setupBoothSettings } from './booth-settings.js';
import { initDevices } from './camera.js';
import { applyCouples, buildQInputs, setupCouples } from './couple.js';
import { setupDiskSpace } from './disk-space.js';
import { setupDownloadQr } from './download-qr.js';
import { setupMessage } from './message.js';
import { setupPhotobooth } from './photobooth.js';
import { setupQuiz } from './quiz.js';
import { setupRecording } from './recording.js';
import { normalizeConfig, applyMenu, setupSettings } from './settings.js';
import { usingSony, applyCameraSource, setupSonyCamera } from './sony-camera.js';
import { setupHistory } from './session-history.js';
import { setupTemplateEditor } from './template-editor.js';
import { setLanguage } from './language.js';
import { resetIdle, setNotice, setupNavigation } from './app.js';
import { setupGuestName } from './guest-name.js';
import { state } from './state.js';

(async () => {
  state.cfg = await api.getConfig();
  state.cfg.quiz = state.cfg.quiz || [];
  normalizeConfig(state.cfg);
  setLanguage(state.cfg.language); // bahasa layar tamu (diatur di Admin)
  if (state.cfg.colors) {
    const r = document.documentElement.style;
    if (state.cfg.colors.accent) r.setProperty('--accent', state.cfg.colors.accent);
  }
  applyCouples(await api.getCouples());
  buildQInputs();

  setupNavigation();
  setupGuestName();
  setupMessage();
  setupQuiz();
  setupAdmin();
  setupHistory();
  setupDownloadQr();
  setupDiskSpace();
  setupSettings();
  setupBoothSettings();
  applyMenu();
  setupCouples();
  setupRecording();
  setupPhotobooth();
  await setupSonyCamera();
  setupTemplateEditor();

  window.addEventListener('unhandledrejection', e =>
    console.log('Error: ' + ((e.reason && e.reason.message) || e.reason)),
  );
  document.addEventListener('pointerdown', resetIdle);
  document.addEventListener('keydown', resetIdle);
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.querySelectorAll('video').forEach(v => {
    v.disableRemotePlayback = true;
  });
  ['dragover', 'drop'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));

  if (usingSony())
    await applyCameraSource(); // kamera Sony: webcam & mic komputer tidak dibuka
  else
    try {
      await initDevices();
    } catch (err) {
      setNotice('Could not open the camera/mic: ' + err.message);
    }
  try {
    const info = await api.getStartupInfo();
    if (info && info.recovered)
      setNotice(`${info.recovered} interrupted recording(s) were recovered. Check Session history in Admin.`, 15000);
  } catch (e) {
    console.warn('Startup info could not be read: ' + e.message);
  }
})();
