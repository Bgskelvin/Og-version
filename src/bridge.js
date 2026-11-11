/* =====================================================================
   bridge.js — TEMPORARY: makes functions from ES modules available to the
   files in src/ that are still plain scripts (shared global variables),
   and to the UI tests that call them inside the page.
   Each line is removed as soon as its users become modules;
   this whole file is deleted at the end of refactor/renderer-modules.
   (One `window.name = name` per line: eslint.config.mjs reads these lines
   to know which globals the plain scripts may use.)
   ===================================================================== */
import { parseCube, applyLut, sampleFilterPhoto, loadLut, forgetLut } from './lut.js';
import { showDownloadQr } from './download-qr.js';
import * as templateRender from './template-render.js';
import { loadSessions, sessionLink } from './session-history.js';

// lut.js — used by template-editor.js and the test/demo fake api
window.parseCube = parseCube;
window.applyLut = applyLut;
window.sampleFilterPhoto = sampleFilterPhoto;
window.loadLut = loadLut;
window.forgetLut = forgetLut;
// download-qr.js — used by rekaman.js
window.showDownloadQr = showDownloadQr;
// session-history.js — loadSessions used by couple.js and tests; sessionLink by tests
window.loadSessions = loadSessions;
window.sessionLink = sessionLink;
// template-render.js — used by app.js, template-editor.js; fillTemplateText also by tests
window.setTemplateCoupleName = templateRender.setTemplateCoupleName;
window.fillTemplateText = templateRender.fillTemplateText;
window.TEMPLATE_FONTS = templateRender.TEMPLATE_FONTS;
window.FONT_NAMES = templateRender.FONT_NAMES;
window.loadImage = templateRender.loadImage;
window.prepareTemplate = templateRender.prepareTemplate;
window.drawTemplate = templateRender.drawTemplate;
window.textWidth = templateRender.textWidth;
window.PHOTO_RATIOS = templateRender.PHOTO_RATIOS;
window.ratioValue = templateRender.ratioValue;
window.fitRatio = templateRender.fitRatio;
window.applyRatio = templateRender.applyRatio;
window.photoArrangement = templateRender.photoArrangement;
window.defaultTexts = templateRender.defaultTexts;
