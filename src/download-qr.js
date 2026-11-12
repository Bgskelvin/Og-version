/* =====================================================================
   download-qr.js — photo/video download QR on the Thank you page, and its
   settings in Admin → Photo booth settings → "Photo download via QR".
   The upload queue lives in main/upload.js, the server in cloud/worker.mjs.
   ===================================================================== */
import { drawQr } from './qr.js';
import { refreshHistory } from './session-history.js';
import { language, t } from './language.js';
import { $, state } from './state.js';
import { flash } from './app.js';

let uploadStatus = { enabled: false, waiting: 0, sent: 0, lastError: '' };

// Latest upload status (the server address is used for links in Session history)
export const getUploadStatus = () => uploadStatus;
export async function refreshUploadStatus() {
  uploadStatus = await api.uploadStatus();
  return uploadStatus;
}

// Show the QR + link on the Thank you page (the link exists even before the photo/video is uploaded)
// kind: 'photo' (photo booth) or 'video' (message / quiz)
export function showDownloadQr(link, kind = 'photo') {
  const url = link + (language === 'en' ? '?b=en' : '');
  try {
    drawQr($('qrCanvas'), url, 8);
    const [title, info] = $('thanksQR').querySelectorAll('b, small:not(.tk-link)');
    if (title) title.textContent = t(kind === 'video' ? 'tk.qrVideo' : 'tk.qrFoto');
    if (info) info.textContent = t(kind === 'video' ? 'tk.qrVideoInfo' : 'tk.qrFotoInfo');
    $('qrLink').textContent = url.replace(/^https:\/\//, '');
    $('thanksQR').style.display = '';
    $('thanks').classList.add('tk-ada-qr');
  } catch (e) {
    console.log('QR could not be created: ' + e.message);
    $('thanksQR').style.display = 'none';
    $('thanks').classList.remove('tk-ada-qr');
  }
}

/* ---------- Admin ---------- */
function renderUploadStatus() {
  if (!$('qrStatus')) return;
  const s = uploadStatus;
  let text, color;
  if (!s.enabled) {
    text = "QR is off. Guests don't see a QR code.";
    color = '';
  } else if (s.current && s.progress && s.progress.code === s.current) {
    text = `Sending video… part ${s.progress.n} of ${s.progress.total}${s.waitingVideos > 1 ? ` · ${s.waitingVideos} video(s) in queue` : ''}`;
    color = 'kuning';
  } else if (s.current) {
    text = `Sending… · ${s.waiting + (s.waitingVideos || 0)} in queue`;
    color = 'kuning';
  } else if (s.waiting) {
    text = `${s.waiting} photo(s) waiting to be sent${s.lastError ? ' · ' + s.lastError : ''}`;
    color = s.lastError ? 'merah' : 'kuning';
  } else if (s.waitingVideos && s.lastError && s.waitingVideos > (s.videosProcessing || 0)) {
    text = `All photos sent · ${s.waitingVideos} video(s) waiting · ${s.lastError}`;
    color = 'merah';
  } else {
    text =
      `On · all photos sent${s.sent ? ` (${s.sent} since the app opened)` : ''}${s.waitingSingles ? ` · ${s.waitingSingles} single shot(s) still uploading` : ''}` +
      (s.waitingVideos
        ? ` · ${s.waitingVideos} video(s) ${s.videosProcessing === s.waitingVideos ? 'being prepared' : 'uploading'}`
        : s.sentVideos
          ? ` · ${s.sentVideos} video(s) sent`
          : '');
    color = s.waitingVideos ? 'kuning' : 'hijau';
  }
  if (s.enabled && !s.video) text += ' · Video QR is off';
  $('qrStatus').textContent = text;
  $('qrDot').className = 'sony-dot ' + color;
  $('btnQrUlang').style.display =
    (s.waiting || s.waitingVideos > (s.videosProcessing || 0)) && !s.current ? '' : 'none';
  if ($('setQrVideo')) {
    $('setQrVideo').disabled = !s.enabled;
    $('setQrKualitas').disabled = !s.enabled || !s.video;
  }
}
export async function fillDownloadQrSettings() {
  try {
    await refreshUploadStatus();
  } catch {
    return; // no status (main process not ready): leave the fields as they are
  }
  $('setQrAktif').checked = uploadStatus.enabled;
  if ($('setQrVideo')) {
    $('setQrVideo').checked = uploadStatus.video !== false;
    $('setQrKualitas').value = uploadStatus.videoQuality === '1080' ? '1080' : '720';
  }
  $('setQrUrl').value = uploadStatus.url || '';
  $('setQrKunci').value = '';
  $('setQrKunci').placeholder = uploadStatus.hasKey ? '•••••••• (saved)' : 'From npm run cloud:pasang';
  $('btnQrPasang').style.display = uploadStatus.hasSetupResult ? '' : 'none';
  renderUploadStatus();
}
async function saveDownloadQr(patch, message) {
  const r = await api.saveUploadSettings(patch);
  uploadStatus = r;
  if (r.error) {
    flash('qrMsg', r.error, true);
    $('setQrAktif').checked = r.enabled;
    if ($('setQrVideo')) $('setQrVideo').checked = r.video !== false;
    return false;
  }
  $('setQrKunci').value = '';
  $('setQrKunci').placeholder = r.hasKey ? '•••••••• (saved)' : '';
  renderUploadStatus();
  if (message) flash('qrMsg', message);
  return true;
}

// Wire up this feature's buttons (called once from start.js)
export function setupDownloadQr() {
  api.onUploadStatus(s => {
    uploadStatus = s;
    renderUploadStatus();
    if (state.current === 'riwayat') refreshHistory();
  });
  $('setQrAktif').onchange = e =>
    saveDownloadQr(
      { enabled: e.target.checked },
      e.target.checked ? 'QR is on: photo booth guests will see a QR code on the Thank you page.' : 'QR turned off.',
    );
  if ($('setQrVideo')) {
    $('setQrVideo').onchange = e =>
      saveDownloadQr(
        { video: e.target.checked },
        e.target.checked
          ? 'Video QR is on: guests who record a message or quiz get a QR for their video.'
          : 'Video QR turned off. Photos still get a QR.',
      );
    $('setQrKualitas').onchange = e =>
      saveDownloadQr(
        { videoQuality: e.target.value },
        e.target.value === '1080'
          ? 'Phone videos: 1080p (sharper, about 2× larger to upload).'
          : 'Phone videos: 720p (lighter, uploads faster).',
      );
  }
  $('btnQrSimpan').onclick = () => {
    const patch = { url: $('setQrUrl').value };
    if ($('setQrKunci').value.trim()) patch.key = $('setQrKunci').value;
    saveDownloadQr(patch, 'Server settings saved.');
  };
  $('btnQrTes').onclick = async () => {
    $('qrMsg').textContent = 'Checking…';
    const r = await api.testUpload();
    if (r.error) flash('qrMsg', r.error, true);
    else flash('qrMsg', `Connected to the server. Photos are kept for ${r.days} days.`);
  };
  $('btnQrPasang').onclick = async () => {
    const h = await api.uploadSetupResult();
    if (h.error) return flash('qrMsg', h.error, true);
    $('setQrUrl').value = h.url;
    if (
      await saveDownloadQr(
        { url: h.url, key: h.key },
        'Address & key loaded from the setup. Press "Test connection", then turn the QR on.',
      )
    )
      $('setQrUrl').value = h.url;
  };
  $('btnQrUlang').onclick = async () => {
    uploadStatus = await api.retryUploadNow();
    renderUploadStatus();
  };
}
