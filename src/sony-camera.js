/* =====================================================================
   sony-camera.js — the Sony camera on screen: camera source choice in Admin,
   camera status, and live view as the booth background.
   Shooting & recording with the Sony camera happen in photobooth.js and
   recording.js (via usingSony()). The camera bridge is main/kamera-sony.js.
   Status fields (tersambung, jenisMode, baterai, kartu, …) come from the main
   process and are renamed with it in refactor/main-english.
   ===================================================================== */
import { openStream, fillDevices } from './camera.js';
import { applySettings } from './settings.js';
import { abortSession } from './recording.js';
import { $, sleep, state } from './state.js';
import { flash } from './app.js';

// Latest status from the main process (a live binding: importers always see the current value)
export let sonyState = { mode: 'webcam', tersambung: false, pesan: '' };
let liveViewRunning = false;
let liveViewFrozen = false; // true = camera image frozen (while the camera switches mode)
let liveViewFrames = 0; // number of live-view frames drawn so far
let modeSwitchId = 0;
export const liveViewFrameCount = () => liveViewFrames; // for the UI tests

export const usingSony = () => !!state.cfg && (state.cfg.kamera === 'sony' || state.cfg.kamera === 'sony-sim');

// Set up the camera source from the settings: webcam/phone or Sony
export async function applyCameraSource() {
  document.body.classList.toggle('sonyOn', usingSony());
  if (usingSony()) {
    // Computer webcam & mic released: video picture and sound come from the Sony camera
    if (state.mediaStream) state.mediaStream.getTracks().forEach(t => t.stop());
    state.mediaStream = null;
    state.noCam = false;
    $('cam').srcObject = null;
    $('camPrev').srcObject = null;
    runLiveView();
  } else if (!state.mediaStream) {
    await openStream();
  }
}

/* ---------- Camera mode follows the page ----------
   Send a message / Quiz → VIDEO, Photo booth → PHOTO. Called from show() (app.js).
   The camera takes ±2 s to switch; recording & shooting wait until the mode is right. */
// Smooth transition: while the camera switches mode, the camera image is frozen + fogged (soft
// blur, slightly faded). The fog clears once a new frame with the right shape arrives.
// Light: the frozen image isn't redrawn, so the blur is only computed once.
export function cameraModeForScreen(name) {
  if (!usingSony() || !api.sonyMode) return;
  const kind = { pesan: 'video', quiz: 'video', photo: 'foto' }[name];
  if (!kind) return;
  const id = ++modeSwitchId;
  const needsSwitch = sonyState.tersambung && sonyState.jenisMode && sonyState.jenisMode !== kind;
  if (needsSwitch) {
    liveViewFrozen = true;
    document.body.classList.add('lvGanti');
  }
  const finish = async () => {
    if (id !== modeSwitchId) return; // a newer switch already started
    liveViewFrozen = false;
    if (!document.body.classList.contains('lvGanti')) return;
    const n = liveViewFrames,
      t0 = performance.now(); // wait for 2 new frames (right shape), max 1.5 s
    while (liveViewFrames < n + 2 && performance.now() - t0 < 1500) await sleep(40);
    if (id === modeSwitchId) document.body.classList.remove('lvGanti');
  };
  const safetyTimer = setTimeout(finish, 6000); // make sure the fog never stays
  api
    .sonyMode(kind)
    .catch(e => console.warn('Sony camera mode could not be set: ' + e.message))
    .finally(() => {
      clearTimeout(safetyTimer);
      finish();
    });
}

/* ---------- Live view ---------- */
// Only fetched when needed (pages with the camera behind them, or Admin)
const liveViewNeeded = () => document.body.classList.contains('camOn') || state.current === 'admin';
function drawLiveView(c, bmp) {
  if (c.width !== bmp.width || c.height !== bmp.height) {
    c.width = bmp.width;
    c.height = bmp.height;
  }
  c.getContext('2d').drawImage(bmp, 0, 0);
}
async function runLiveView() {
  if (liveViewRunning) return;
  liveViewRunning = true;
  try {
    while (usingSony()) {
      if (!liveViewNeeded() || !sonyState.tersambung || document.hidden) {
        await sleep(250);
        continue;
      }
      const t0 = performance.now();
      let buf = null;
      try {
        buf = await api.sonyLiveView();
      } catch {
        /* live-view frame could not be fetched: tried again on the next round */
      }
      if (buf) {
        try {
          const bmp = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }));
          if (!liveViewFrozen) {
            drawLiveView($('camLv'), bmp);
            liveViewFrames++;
          }
          if (state.current === 'admin') drawLiveView($('camPrevLv'), bmp);
          bmp.close();
        } catch {
          /* broken live-view frame: skipped */
        }
      } else await sleep(200);
      const remaining = 40 - (performance.now() - t0); // at most ±25 frames per second
      if (remaining > 0) await sleep(remaining);
    }
  } finally {
    liveViewRunning = false;
  }
}

/* ---------- Camera status in Admin ---------- */
function sonyStatusText(s) {
  if (s.tersambung) {
    const parts = [`${s.model || 'Sony camera'} connected`];
    if (s.baterai >= 0) parts.push(`battery ${s.baterai}%`);
    if (s.kartu > 0) parts.push('⚠️ SD card problem / no card');
    else if (s.sisaDetik > 0)
      parts.push(`±${Math.floor(s.sisaDetik / 3600)} h ${Math.floor((s.sisaDetik % 3600) / 60)} m recording left`);
    if (s.mengunduh) parts.push('copying video');
    return parts.join(' · ');
  }
  return s.pesan || 'Looking for the Sony camera…';
}
function renderSonyStatus() {
  if (!$('sonyStatus')) return;
  $('sonyStatus').textContent = sonyStatusText(sonyState);
  $('sonyDot').className = 'sony-dot ' + (sonyState.tersambung ? (sonyState.kartu > 0 ? 'kuning' : 'hijau') : 'merah');
}
export function fillAdminCamera() {
  const sony = usingSony();
  $('camSumber').value = state.cfg.kamera || 'webcam';
  $('camSelRow').style.display = $('micSelRow').style.display = sony ? 'none' : '';
  $('sonyRow').style.display = sony ? '' : 'none';
  $('camHint').textContent = sony
    ? "Video sound comes from the Sony camera: plug the mic into the camera's mic jack. Videos are recorded to the SD card and copied to the couple folder automatically. Use a dummy battery so the camera doesn't die mid-event."
    : 'Computer camera & mic, a USB webcam, or a phone used as a webcam.';
  renderSonyStatus();
}
function receiveSonyStatus(s) {
  const wasConnected = sonyState.tersambung;
  sonyState = s || sonyState;
  renderSonyStatus();
  // Camera disconnected during a message/quiz recording: stop the session with a clear message
  if (wasConnected && !sonyState.tersambung && state.rec && state.rec.sony)
    abortSession('The Sony camera disconnected while recording. What was recorded is still on the camera SD card.');
}

// Wire up this feature's buttons (called once from start.js)
export async function setupSonyCamera() {
  api.onSonyStatus(receiveSonyStatus);
  try {
    sonyState = await api.sonyStatus();
  } catch {
    /* camera status not readable yet: keep the last status */
  }
  $('camSumber').onchange = async e => {
    const s = await api.saveSettings({ kamera: e.target.value });
    applySettings(s);
    await applyCameraSource();
    fillAdminCamera();
    await fillDevices();
    const label = { webcam: 'Webcam / phone', sony: 'Sony (USB)', 'sony-sim': 'Sony – simulation' }[state.cfg.kamera];
    flash('camMsg', `Camera source: ${label}.`);
  };
  $('btnSonyUlang').onclick = async () => {
    $('sonyStatus').textContent = 'Looking for the Sony camera…';
    receiveSonyStatus(await api.sonyReconnect());
  };
}
