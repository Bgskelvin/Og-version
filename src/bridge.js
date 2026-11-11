/* =====================================================================
   bridge.js — TEMPORARY: makes functions from ES modules available to the
   files in src/ that are still plain scripts (shared global variables).
   Each line is removed as soon as the files that use it become modules;
   this whole file is deleted at the end of refactor/renderer-modules.
   ===================================================================== */
import { drawQr } from './qr.js';
import { parseCube, applyLut, sampleFilterPhoto, loadLut, forgetLut } from './lut.js';
import { showDownloadQr, fillDownloadQrSettings, getUploadStatus, refreshUploadStatus } from './download-qr.js';

// qr.js — used by riwayat.js
window.drawQr = drawQr;
// lut.js — used by photobooth.js, template-editor.js and the test/demo fake api
window.parseCube = parseCube;
window.applyLut = applyLut;
window.sampleFilterPhoto = sampleFilterPhoto;
window.loadLut = loadLut;
window.forgetLut = forgetLut;
// download-qr.js — used by photobooth.js, rekaman.js, pengaturan-booth.js, riwayat.js
window.showDownloadQr = showDownloadQr;
window.fillDownloadQrSettings = fillDownloadQrSettings;
window.getUploadStatus = getUploadStatus;
window.refreshUploadStatus = refreshUploadStatus;
