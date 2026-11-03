/* =====================================================================
   kamera.js — membuka kamera & mic, memilih perangkat di Admin
   ===================================================================== */

async function openStream() {
  if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  mediaStream = null;
  const camId = store.get('camId'), micId = store.get('micId');
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  const audio = micId ? { deviceId: { exact: micId } } : true;
  const video = camId ? { deviceId: { exact: camId }, ...size } : size;
  let s = null;
  for (const c of [{ video, audio }, { video: true, audio: true }, { video: false, audio: true }]) {
    try { s = await navigator.mediaDevices.getUserMedia(c); break; } catch (e) { console.log('Gagal buka perangkat: ' + e.name); }
  }
  if (!s) { setNotice('Tidak ada kamera/mic yang bisa dipakai'); return; }
  noCam = s.getVideoTracks().length === 0;
  setNotice(noCam ? 'MODE TES: tanpa kamera (hanya suara)' : '');
  mediaStream = s;
  $('cam').srcObject = s;
  $('camPrev').srcObject = s;
}
async function initDevices() {
  await openStream();
  const devs = await navigator.mediaDevices.enumerateDevices();
  console.log('PERANGKAT TERDETEKSI:\n' + devs.filter(d => d.kind !== 'audiooutput').map(d => `  ${d.kind}: ${d.label}`).join('\n'));
  const byName = (kind, name) => name ? devs.find(d => d.kind === kind && d.label.toLowerCase().includes(name.toLowerCase())) : null;
  let changed = false;
  if (!store.get('camId')) { const c = byName('videoinput', cfg.cameraName); if (c) { store.set('camId', c.deviceId); changed = true; } }
  if (!store.get('micId')) { const m = byName('audioinput', cfg.micName); if (m) { store.set('micId', m.deviceId); changed = true; } }
  if (changed) await openStream();
}
async function fillDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const cur = kind => {
    const t = mediaStream && (kind === 'videoinput' ? mediaStream.getVideoTracks()[0] : mediaStream.getAudioTracks()[0]);
    return t ? t.getSettings().deviceId : '';
  };
  const fill = (sel, kind, name, emptyText) => {
    sel.innerHTML = '';
    const list = devs.filter(d => d.kind === kind);
    sel.disabled = !list.length;
    if (!list.length) { const o = document.createElement('option'); o.textContent = emptyText; sel.appendChild(o); return; }
    list.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId; o.textContent = d.label || `${name} ${i + 1}`;
      if (d.deviceId === cur(kind)) o.selected = true;
      sel.appendChild(o);
    });
  };
  fill($('camSel'), 'videoinput', 'Kamera', 'Tidak ada kamera terdeteksi');
  fill($('micSel'), 'audioinput', 'Mikrofon', 'Tidak ada mikrofon terdeteksi');
}
