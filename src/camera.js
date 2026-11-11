/* =====================================================================
   camera.js — opens the webcam/phone camera & mic, device choice in Admin
   Shared state (mediaStream, noCam, store, cfg) still lives in state.js as
   globals until that file becomes a module.
   ===================================================================== */
import { $, state, store } from './state.js';
import { setNotice } from './app.js';

export async function openStream() {
  if (state.mediaStream) state.mediaStream.getTracks().forEach(t => t.stop());
  state.mediaStream = null;
  const camId = store.get('camId'),
    micId = store.get('micId');
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const audio = micId ? { deviceId: { exact: micId } } : true;
  const video = camId ? { deviceId: { exact: camId }, ...size } : size;
  let s = null;
  for (const c of [
    { video, audio },
    { video: true, audio: true },
    { video: false, audio: true },
  ]) {
    try {
      s = await navigator.mediaDevices.getUserMedia(c);
      break;
    } catch (e) {
      console.log('Device could not be opened: ' + e.name);
    }
  }
  if (!s) {
    setNotice('No usable camera/microphone');
    return;
  }
  state.noCam = s.getVideoTracks().length === 0;
  setNotice(state.noCam ? 'TEST MODE: no camera (audio only)' : '');
  state.mediaStream = s;
  $('cam').srcObject = s;
  $('camPrev').srcObject = s;
}
export async function initDevices() {
  await openStream();
  const devs = await navigator.mediaDevices.enumerateDevices();
  console.log(
    'DEVICES FOUND:\n' +
      devs
        .filter(d => d.kind !== 'audiooutput')
        .map(d => `  ${d.kind}: ${d.label}`)
        .join('\n'),
  );
  const byName = (kind, name) =>
    name ? devs.find(d => d.kind === kind && d.label.toLowerCase().includes(name.toLowerCase())) : null;
  let changed = false;
  if (!store.get('camId')) {
    const c = byName('videoinput', state.cfg.cameraName);
    if (c) {
      store.set('camId', c.deviceId);
      changed = true;
    }
  }
  if (!store.get('micId')) {
    const m = byName('audioinput', state.cfg.micName);
    if (m) {
      store.set('micId', m.deviceId);
      changed = true;
    }
  }
  if (changed) await openStream();
}
export async function fillDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const cur = kind => {
    const t =
      state.mediaStream &&
      (kind === 'videoinput' ? state.mediaStream.getVideoTracks()[0] : state.mediaStream.getAudioTracks()[0]);
    return t ? t.getSettings().deviceId : '';
  };
  const fill = (sel, kind, name, emptyText) => {
    sel.innerHTML = '';
    const list = devs.filter(d => d.kind === kind);
    sel.disabled = !list.length;
    if (!list.length) {
      const o = document.createElement('option');
      o.textContent = emptyText;
      sel.appendChild(o);
      return;
    }
    list.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `${name} ${i + 1}`;
      if (d.deviceId === cur(kind)) o.selected = true;
      sel.appendChild(o);
    });
  };
  fill($('camSel'), 'videoinput', 'Camera', 'No camera detected');
  fill($('micSel'), 'audioinput', 'Microphone', 'No microphone detected');
}
