/* =====================================================================
   download-qr.js — photo/video download QR on the Thank you page, and its
   settings in Admin → Photo booth settings → "Photo download via QR".
   The upload queue lives in main/unggah.js, the server in cloud/worker.mjs.
   The status fields (aktif, menunggu, …) come from the main process and are
   renamed together with it in refactor/main-english.
   ===================================================================== */
import { drawQr } from './qr.js';
import { refreshHistory } from './session-history.js';
import { language, t } from './language.js';
import { $, state } from './state.js';
import { flash } from './app.js';

let uploadStatus = { aktif: false, menunggu: 0, terkirim: 0, errorTerakhir: '' };

// Latest upload status (the server address is used for links in Session history)
export const getUploadStatus = () => uploadStatus;
export async function refreshUploadStatus() {
  uploadStatus = await api.unggahStatus();
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
  if (!s.aktif) {
    text = "QR is off. Guests don't see a QR code.";
    color = '';
  } else if (s.sedang && s.progres && s.progres.kode === s.sedang) {
    text = `Sending video… part ${s.progres.n} of ${s.progres.total}${s.menungguVideo > 1 ? ` · ${s.menungguVideo} video(s) in queue` : ''}`;
    color = 'kuning';
  } else if (s.sedang) {
    text = `Sending… · ${s.menunggu + (s.menungguVideo || 0)} in queue`;
    color = 'kuning';
  } else if (s.menunggu) {
    text = `${s.menunggu} photo(s) waiting to be sent${s.errorTerakhir ? ' · ' + s.errorTerakhir : ''}`;
    color = s.errorTerakhir ? 'merah' : 'kuning';
  } else if (s.menungguVideo && s.errorTerakhir && s.menungguVideo > (s.videoDiolah || 0)) {
    text = `All photos sent · ${s.menungguVideo} video(s) waiting · ${s.errorTerakhir}`;
    color = 'merah';
  } else {
    text =
      `On · all photos sent${s.terkirim ? ` (${s.terkirim} since the app opened)` : ''}${s.menungguSatuan ? ` · ${s.menungguSatuan} single shot(s) still uploading` : ''}` +
      (s.menungguVideo
        ? ` · ${s.menungguVideo} video(s) ${s.videoDiolah === s.menungguVideo ? 'being prepared' : 'uploading'}`
        : s.terkirimVideo
          ? ` · ${s.terkirimVideo} video(s) sent`
          : '');
    color = s.menungguVideo ? 'kuning' : 'hijau';
  }
  if (s.aktif && !s.video) text += ' · Video QR is off';
  $('qrStatus').textContent = text;
  $('qrDot').className = 'sony-dot ' + color;
  $('btnQrUlang').style.display = (s.menunggu || s.menungguVideo > (s.videoDiolah || 0)) && !s.sedang ? '' : 'none';
  if ($('setQrVideo')) {
    $('setQrVideo').disabled = !s.aktif;
    $('setQrKualitas').disabled = !s.aktif || !s.video;
  }
}
export async function fillDownloadQrSettings() {
  try {
    await refreshUploadStatus();
  } catch {
    return; // no status (main process not ready): leave the fields as they are
  }
  $('setQrAktif').checked = uploadStatus.aktif;
  if ($('setQrVideo')) {
    $('setQrVideo').checked = uploadStatus.video !== false;
    $('setQrKualitas').value = uploadStatus.videoKualitas === '1080' ? '1080' : '720';
  }
  $('setQrUrl').value = uploadStatus.url || '';
  $('setQrKunci').value = '';
  $('setQrKunci').placeholder = uploadStatus.adaKunci ? '•••••••• (saved)' : 'From npm run cloud:pasang';
  $('btnQrPasang').style.display = uploadStatus.adaHasilPasang ? '' : 'none';
  renderUploadStatus();
}
async function saveDownloadQr(patch, message) {
  const r = await api.unggahSimpan(patch);
  uploadStatus = r;
  if (r.error) {
    flash('qrMsg', r.error, true);
    $('setQrAktif').checked = r.aktif;
    if ($('setQrVideo')) $('setQrVideo').checked = r.video !== false;
    return false;
  }
  $('setQrKunci').value = '';
  $('setQrKunci').placeholder = r.adaKunci ? '•••••••• (saved)' : '';
  renderUploadStatus();
  if (message) flash('qrMsg', message);
  return true;
}

// Wire up this feature's buttons (called once from start.js)
export function setupDownloadQr() {
  api.onUnggahStatus(s => {
    uploadStatus = s;
    renderUploadStatus();
    if (state.current === 'riwayat') refreshHistory();
  });
  $('setQrAktif').onchange = e =>
    saveDownloadQr(
      { aktif: e.target.checked },
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
        { videoKualitas: e.target.value },
        e.target.value === '1080'
          ? 'Phone videos: 1080p (sharper, about 2× larger to upload).'
          : 'Phone videos: 720p (lighter, uploads faster).',
      );
  }
  $('btnQrSimpan').onclick = () => {
    const patch = { url: $('setQrUrl').value };
    if ($('setQrKunci').value.trim()) patch.kunci = $('setQrKunci').value;
    saveDownloadQr(patch, 'Server settings saved.');
  };
  $('btnQrTes').onclick = async () => {
    $('qrMsg').textContent = 'Checking…';
    const r = await api.unggahTes();
    if (r.error) flash('qrMsg', r.error, true);
    else flash('qrMsg', `Connected to the server. Photos are kept for ${r.hari} days.`);
  };
  $('btnQrPasang').onclick = async () => {
    const h = await api.unggahHasilPasang();
    if (h.error) return flash('qrMsg', h.error, true);
    $('setQrUrl').value = h.url;
    if (
      await saveDownloadQr(
        { url: h.url, kunci: h.kunci },
        'Address & key loaded from the setup. Press "Test connection", then turn the QR on.',
      )
    )
      $('setQrUrl').value = h.url;
  };
  $('btnQrUlang').onclick = async () => {
    uploadStatus = await api.unggahCobaSekarang();
    renderUploadStatus();
  };
}
