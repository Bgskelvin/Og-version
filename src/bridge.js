/* =====================================================================
   bridge.js — TEMPORARY: makes functions from ES modules available to the
   files in src/ that are still plain scripts (shared global variables),
   and to the UI tests that call them inside the page.
   Each line is removed as soon as its users become modules;
   this whole file is deleted at the end of refactor/renderer-modules.
   (One `window.name = name` per line: eslint.config.mjs reads these lines
   to know which globals the plain scripts may use.)
   ===================================================================== */
import { drawQr } from './qr.js';
import { parseCube, applyLut, sampleFilterPhoto, loadLut, forgetLut } from './lut.js';
import { showDownloadQr, fillDownloadQrSettings, getUploadStatus, refreshUploadStatus } from './download-qr.js';
import * as templateRender from './template-render.js';

// qr.js — used by riwayat.js
window.drawQr = drawQr;
// lut.js — used by template-editor.js and the test/demo fake api
window.parseCube = parseCube;
window.applyLut = applyLut;
window.sampleFilterPhoto = sampleFilterPhoto;
window.loadLut = loadLut;
window.forgetLut = forgetLut;
// download-qr.js — used by rekaman.js, pengaturan-booth.js, riwayat.js
window.showDownloadQr = showDownloadQr;
window.fillDownloadQrSettings = fillDownloadQrSettings;
window.getUploadStatus = getUploadStatus;
window.refreshUploadStatus = refreshUploadStatus;
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
