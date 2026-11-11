/* =====================================================================
   start.js — the app's entry module (<script type="module"> in index.html).
   Runs after all plain scripts: loads settings & couples, wires up every
   feature's buttons, then opens the camera.
   ===================================================================== */
import './bridge.js'; // TEMPORARY: exposes module functions to the remaining plain scripts
import { setupAdmin } from './admin.js';
import { setupBoothSettings } from './booth-settings.js';
import { setupDownloadQr } from './download-qr.js';
import { setupMessage } from './message.js';
import { setupPhotobooth } from './photobooth.js';
import { setupQuiz } from './quiz.js';
import { setupHistory } from './session-history.js';
import { setupTemplateEditor } from './template-editor.js';

(async () => {
  cfg = await api.getConfig();
  cfg.quiz = cfg.quiz || [];
  normalisasiCfg(cfg);
  setBahasa(cfg.bahasa); // bahasa layar tamu (diatur di Admin)
  if (cfg.colors) {
    const r = document.documentElement.style;
    if (cfg.colors.accent) r.setProperty('--accent', cfg.colors.accent);
  }
  applyCouples(await api.getCouples());
  buildQInputs();

  pasangNavigasi();
  pasangNama();
  setupMessage();
  setupQuiz();
  setupAdmin();
  setupHistory();
  setupDownloadQr();
  pasangPengaturan();
  setupBoothSettings();
  terapkanMenu();
  pasangCouple();
  pasangRekaman();
  setupPhotobooth();
  await pasangKameraSony();
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

  if (pakaiSony())
    await terapkanKamera(); // kamera Sony: webcam & mic komputer tidak dibuka
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
