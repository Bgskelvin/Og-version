/* =====================================================================
   recording.js — video recording, countdown, the Saving screen,
   the Thank you page, and aborting when something fails.
   Shared session state (rec, recT0, lastSave, busy, sessionToken, …) lives
   in state.js.
   ===================================================================== */
import { usingSony, sonyState } from './sony-camera.js';
import { showDownloadQr } from './download-qr.js';
import { $, sleep, state } from './state.js';
import { setNotice, show } from './app.js';
import { t } from './language.js';

// Each recording has its own object & ID, so a new recording can't overwrite one that's still saving.
export async function startRecording(label) {
  // wait for the previous recording to finish saving, at most 15 s so the screen never gets stuck
  // (a failed previous save was already reported when it happened)
  await Promise.race([state.lastSave.catch(() => false), sleep(15000)]);
  const sony = usingSony();
  const r = await api.recStart(label, { sony, guest: state.guestName });
  if (!r || r.error) throw new Error((r && r.error) || 'Could not start the recording');
  if (r.fallback) setNotice('The chosen folder is not available, the recording is saved in the default folder', 8000);
  const cur = { id: r.id, t0: Date.now(), pending: Promise.resolve(), recorder: null, sony };
  if (sony) {
    state.rec = cur;
    state.recT0 = cur.t0;
    return;
  } // the Sony camera records to its own SD card
  try {
    cur.recorder = new MediaRecorder(
      state.mediaStream,
      state.noCam
        ? { mimeType: 'audio/webm;codecs=opus' }
        : { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 5000000 },
    );
  } catch (err) {
    await api.recAbort(r.id);
    throw err;
  }
  cur.recorder.ondataavailable = e => {
    if (!e.data.size) return;
    cur.pending = cur.pending
      .then(async () => api.recChunk(cur.id, new Uint8Array(await e.data.arrayBuffer())))
      .catch(err => console.log('Recording chunk could not be sent: ' + err.message));
  };
  cur.recorder.onerror = () => {
    if (state.rec === cur)
      abortSession('Recording stopped because of a camera/mic problem. Check the devices in Admin.');
  };
  cur.recorder.start(1000);
  state.rec = cur;
  state.recT0 = cur.t0;
}
// QR download link for the last recording's video (set when the recording has been saved)
let lastVideoQrLink = null;
function stopRecording(meta) {
  const cur = state.rec;
  state.rec = null;
  lastVideoQrLink = null;
  if (!cur) return Promise.resolve(false);
  const seconds = Math.round((Date.now() - cur.t0) / 1000);
  const info = { couple: state.activeCouple ? state.activeCouple.name : '', ...(meta || {}) };
  const p = new Promise(resolve => {
    const finish = async () => {
      let ok = false;
      try {
        await cur.pending;
        const res = await api.recEnd(cur.id, seconds, info);
        ok = !!(res && res.ok);
        if (ok && res.link && !info.aborted) lastVideoQrLink = res.link;
        if (res && !res.ok) setNotice('The last recording could not be saved: ' + res.error, 15000);
      } catch (err) {
        setNotice('The last recording could not be saved: ' + err.message, 15000);
      }
      resolve(ok);
    };
    if (!cur.recorder || cur.recorder.state === 'inactive') finish();
    else {
      cur.recorder.onstop = finish;
      cur.recorder.stop();
    }
  });
  state.lastSave = p;
  return p;
}
// Countdown before recording (length set in Videobooth settings; 0 = start right away)
export async function countdown(seconds = 3) {
  if (seconds <= 0) return;
  $('countOverlay').style.display = 'flex';
  for (let i = seconds; i >= 1; i--) {
    $('countNum').textContent = i;
    await sleep(1000);
  }
  $('countOverlay').style.display = 'none';
}
// After a message/quiz: the "Saving" screen shows at least 3 s, and until the recording is really saved.
// Guests can't press anything on this screen, so they can't immediately "Try again".
const SAVE_MIN_MS = 3000,
  SAVE_MAX_MS = 15000;
let finishing = false;
// The Thank you message follows the real save result
export function setThanks(result) {
  const ok = result === true,
    slow = result === 'slow';
  // The photo preview is only for the photo booth; photobooth.js shows it after calling this
  $('thanks').classList.remove('thanks-photo', 'thanks-has-qr');
  $('thanksName').textContent = state.guestName || '';
  $('thanksPhoto').style.display = 'none';
  $('thanksQR').style.display = 'none';
  $('thanksBadge').style.display = '';
  $('thanksBadge').style.background = ok || slow ? '' : 'var(--orange)';
  $('thanksBadge').innerHTML =
    ok || slow
      ? '<svg class="i"><use href="#i-check"/></svg>'
      : '<span style="font-size:52px;font-weight:700">!</span>';
  $('thanksMsg').textContent = ok ? t('thanks.ok') : slow ? t('thanks.slow') : t('thanks.failed');
}
export async function finishSession(meta) {
  if (finishing) return; // prevents Finish being pressed twice
  finishing = true;
  state.sessionToken++;
  clearInterval(state.recTick);
  clearTimeout(state.messageLimit);
  const bar = $('saveBar');
  bar.classList.remove('run');
  void bar.offsetWidth;
  bar.classList.add('run');
  $('savingTitle').textContent = t('saving.recording');
  show('saving');
  const saved = stopRecording(meta);
  // 15 s upper limit so the screen never gets stuck; saving carries on in the background
  const [, result] = await Promise.all([
    sleep(SAVE_MIN_MS),
    Promise.race([saved, sleep(SAVE_MAX_MS).then(() => 'slow')]),
  ]);
  finishing = false;
  state.busy = false;
  setThanks(result);
  if (result === true && lastVideoQrLink) showDownloadQr(lastVideoQrLink, 'video');
  show('thanks');
}
// Called when something fails: save what was recorded, then go back to the main menu.
// The app never gets stuck on a screen without buttons.
export async function abortSession(msg) {
  state.sessionToken++;
  clearInterval(state.recTick);
  clearTimeout(state.messageLimit);
  if (state.cancelTimer) state.cancelTimer();
  $('countOverlay').style.display = 'none';
  const saving = stopRecording({ aborted: true });
  state.busy = false;
  setNotice(msg, 15000);
  show('home');
  await saving;
}
export function needStream() {
  if (usingSony()) {
    if (sonyState.connected) return true;
    setNotice('The Sony camera is not connected. Check the USB cable & camera, or look in Admin.', 8000);
    return false;
  }
  if (state.mediaStream) return true;
  setNotice('No camera/mic. Set it up in Admin.', 8000);
  return false;
}

// Wire up this feature's buttons (called once from start.js)
export function setupRecording() {
  // Saving failed mid-recording (disk full / SSD unplugged)
  api.onRecError((id, msg) => {
    if (state.rec && state.rec.id === id)
      abortSession('The recording could not be saved: ' + msg + '. Check the disk space / storage folder in Admin.');
    else setNotice('The recording could not be saved: ' + msg, 15000);
  });
}
