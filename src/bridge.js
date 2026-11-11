/* =====================================================================
   bridge.js — TEMPORARY: makes functions from ES modules available to the
   files in src/ that are still plain scripts (shared global variables),
   and to the UI tests / phone demo that call them inside the page.
   Each line is removed as soon as its users become modules;
   this whole file is deleted at the end of refactor/renderer-modules.
   (One `window.name = name` per line: eslint.config.mjs reads these lines
   to know which globals the plain scripts may use.)
   ===================================================================== */
import { parseCube, sampleFilterPhoto } from './lut.js';
import { showDownloadQr } from './download-qr.js';
import { setTemplateCoupleName, fillTemplateText } from './template-render.js';
import { loadSessions, sessionLink } from './session-history.js';
import { applySettings, applyMenu } from './settings.js';
import { te, openTemplateEditor, getTemplateCouple } from './template-editor.js';

// lut.js — parseCube: test/demo fake api; sampleFilterPhoto: tests
window.parseCube = parseCube;
window.sampleFilterPhoto = sampleFilterPhoto;
// download-qr.js — used by rekaman.js
window.showDownloadQr = showDownloadQr;
// template-render.js — setTemplateCoupleName: app.js; fillTemplateText: tests
window.setTemplateCoupleName = setTemplateCoupleName;
window.fillTemplateText = fillTemplateText;
// session-history.js — loadSessions, sessionLink: tests
window.loadSessions = loadSessions;
window.sessionLink = sessionLink;
// template-editor.js — getTemplateCouple: app.js; te, openTemplateEditor: tests
window.te = te;
window.openTemplateEditor = openTemplateEditor;
window.getTemplateCouple = getTemplateCouple;
// settings.js — applySettings: kamera-sony.js and tests; applyMenu: tests
window.applySettings = applySettings;
window.applyMenu = applyMenu;
