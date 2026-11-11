/* =====================================================================
   message.js — "Send a message" page (guest records a video message)
   Shared session state (cfg, busy, sessionToken, recTick, pesanLimit) still
   lives in state.js as globals until that file becomes a module.
   ===================================================================== */

function openMessage() {
  $('pesanPre').style.display = 'flex';
  $('pesanRec').style.display = 'none';
  show('pesan');
}
async function startMessage() {
  if (busy || !needStream()) return;
  busy = true;
  resetIdle();
  const token = ++sessionToken;
  $('pesanPre').style.display = 'none';
  try {
    // A Sony camera needs ±0.5–1 s before it really records: start recording at the START of the countdown,
    // so the guest's first sentence isn't cut off. A webcam records immediately, so start after the countdown.
    const recordEarly = pakaiSony() && cfg.pesanCountdown > 0;
    if (recordEarly) {
      await startRecording('pesan');
      if (token !== sessionToken) return;
    }
    await countdown(cfg.pesanCountdown);
    if (token !== sessionToken) return;
    if (!recordEarly) await startRecording('pesan');
    if (token !== sessionToken) return;
    const t0 = Date.now();
    // Length limit (Videobooth settings): recording stops by itself if the guest forgets to press Done
    const limit = cfg.pesanMaxSeconds;
    const showTime = () => {
      const s = Math.floor((Date.now() - t0) / 1000);
      $('pesanTime').textContent = limit > 0 ? `${fmt(Math.min(s, limit))} / ${fmt(limit)}` : fmt(s);
    };
    showTime();
    $('pesanRec').style.display = 'flex';
    recTick = setInterval(showTime, 250);
    if (limit > 0)
      pesanLimit = setTimeout(() => {
        if (token === sessionToken) finishSession();
      }, limit * 1000);
  } catch (err) {
    console.log('Message could not start: ' + err.message);
    if (token === sessionToken) abortSession('Gagal memulai rekaman: ' + err.message);
  }
}

// Wire up this feature's buttons (called once from start.js)
export function setupMessage() {
  $('btnToPesan').onclick = openMessage;
  $('btnPesanBack').onclick = () => show('utama');
  $('btnPesanMulai').onclick = startMessage;
  $('btnFinish').onclick = () => finishSession();
}
