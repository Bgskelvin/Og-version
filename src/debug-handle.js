/* =====================================================================
   debug-handle.js — one small, read-mostly handle on the running app:
   window.__leura. Used by the UI tests (tests/uji-tampilan.js) and the
   phone demo's fake api (demo/api-demo.js) to look inside the page.
   The app itself never uses it — features import from each other.
   ===================================================================== */
import { state } from './state.js';
import { show } from './app.js';
import { setNotice } from './app.js';
import { setLanguage } from './language.js';
import { parseCube, sampleFilterPhoto } from './lut.js';
import { fillTemplateText } from './template-render.js';
import { loadSessions, sessionLink } from './session-history.js';
import { applySettings, applyMenu } from './settings.js';
import { te, openTemplateEditor } from './template-editor.js';
import { liveViewFrameCount } from './sony-camera.js';
import { refreshDiskSpace } from './disk-space.js';
import { openGuestQr } from './guest-qr.js';

window.__leura = Object.freeze({
  state,
  show,
  setNotice,
  setLanguage,
  parseCube,
  sampleFilterPhoto,
  fillTemplateText,
  loadSessions,
  sessionLink,
  applySettings,
  applyMenu,
  te,
  openTemplateEditor,
  liveViewFrameCount,
  refreshDiskSpace,
  openGuestQr,
});
