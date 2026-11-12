/* =====================================================================
   message.js — "Send a message" page (guest records a video message)
   Shared session state (cfg, busy, sessionToken, recTick, messageLimit) lives
   in state.js.
   ===================================================================== */
import { usingSony } from './sony-camera.js';
import { startRecording, countdown, finishSession, abortSession, needStream } from './recording.js';
import { $, fmt, state } from './state.js';
import { resetIdle, show } from './app.js';

function openMessage() {
  $('messagePre').style.display = 'flex';
  $('messageRec').style.display = 'none';
  show('message');
}
async function startMessage() {
  if (state.busy || !needStream()) return;
  state.busy = true;
  resetIdle();
  const token = ++state.sessionToken;
  $('messagePre').style.display = 'none';
  try {
    // A Sony camera needs ±0.5–1 s before it really records: start recording at the START of the countdown,
    // so the guest's first sentence isn't cut off. A webcam records immediately, so start after the countdown.
    const recordEarly = usingSony() && state.cfg.messageCountdown > 0;
    if (recordEarly) {
      await startRecording('message');
      if (token !== state.sessionToken) return;
    }
    await countdown(state.cfg.messageCountdown);
    if (token !== state.sessionToken) return;
    if (!recordEarly) await startRecording('message');
    if (token !== state.sessionToken) return;
    const t0 = Date.now();
    // Length limit (Videobooth settings): recording stops by itself if the guest forgets to press Done
    const limit = state.cfg.messageMaxSeconds;
    const showTime = () => {
      const s = Math.floor((Date.now() - t0) / 1000);
      $('messageTime').textContent = limit > 0 ? `${fmt(Math.min(s, limit))} / ${fmt(limit)}` : fmt(s);
    };
    showTime();
    $('messageRec').style.display = 'flex';
    state.recTick = setInterval(showTime, 250);
    if (limit > 0)
      state.messageLimit = setTimeout(() => {
        if (token === state.sessionToken) finishSession();
      }, limit * 1000);
  } catch (err) {
    console.log('Message could not start: ' + err.message);
    if (token === state.sessionToken) abortSession('Could not start the recording: ' + err.message);
  }
}

// Wire up this feature's buttons (called once from start.js)
export function setupMessage() {
  $('btnToMessage').onclick = openMessage;
  $('btnMessageBack').onclick = () => show('home');
  $('btnMessageStart').onclick = startMessage;
  $('btnFinish').onclick = () => finishSession();
}
