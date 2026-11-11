/* =====================================================================
   quiz.js — Quick quiz page (random questions, answer timer)
   - 3-second countdown before the first question. The camera is already
     recording from the start of the countdown, so camera lag (Sony ±0.5–1 s)
     doesn't cut off the first question.
   - The time each question is shown is recorded, and its text is drawn
     as a transparent PNG. The main process overlays it at the bottom of the
     video (main/olah-video.js); the original video without text is kept too.
   Shared session state (cfg, busy, sessionToken, cancelTimer, recT0) still
   lives in state.js as globals until that file becomes a module.
   ===================================================================== */
import { startRecording, countdown, finishSession, abortSession, needStream } from './recording.js';
import { $, fmt, sleep, state } from './state.js';
import { t } from './language.js';
import { resetIdle, show } from './app.js';

const QUIZ_COUNTDOWN = 3; // seconds of countdown before the first question

const quizRounds = () => Math.min(state.cfg.quizRounds, state.cfg.quiz.length);
function openQuiz() {
  $('btnQuizMulai').disabled = !state.cfg.quiz.length;
  if (!state.cfg.quiz.length) {
    $('quizInfo').textContent = t('quiz.kosong');
    $('quizPre').style.display = 'flex';
    $('quizRun').style.display = 'none';
    show('quiz');
    return;
  }
  $('quizInfo').textContent = t('quiz.info', { n: quizRounds(), s: state.cfg.quizSeconds });
  $('quizPre').style.display = 'flex';
  $('quizRun').style.display = 'none';
  show('quiz');
}
function pickQuestions(n) {
  const idx = state.cfg.quiz.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  const out = idx.slice(0, n);
  while (out.length < n) out.push(Math.floor(Math.random() * state.cfg.quiz.length));
  return out;
}
async function shuffleTo(qi) {
  const card = $('qCard');
  $('qBarWrap').style.visibility = 'hidden';
  $('qTime').style.visibility = 'hidden';
  $('btnNext').style.visibility = 'hidden';
  card.classList.remove('reveal');
  card.classList.add('shuffling');
  for (let d = 60; d < 320; d *= 1.15) {
    $('qText').textContent = state.cfg.quiz[Math.floor(Math.random() * state.cfg.quiz.length)];
    await sleep(d);
  }
  $('qText').textContent = state.cfg.quiz[qi];
  card.classList.remove('shuffling');
  void card.offsetWidth;
  card.classList.add('reveal');
  await sleep(500);
}
function answerTimer(isLast) {
  const secs = state.cfg.quizSeconds;
  $('qBarWrap').style.visibility = 'visible';
  $('qTime').style.visibility = 'visible';
  $('btnNext').style.visibility = 'visible';
  $('btnNext').textContent = isLast ? t('quiz.selesai') : t('quiz.lanjut');
  return new Promise(resolve => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const remain = Math.max(0, secs - (Date.now() - t0) / 1000);
      $('qBar').style.width = (remain / secs) * 100 + '%';
      $('qTime').textContent = t('quiz.sisa', { t: fmt(Math.ceil(remain)) });
      if (remain <= 0) done();
    }, 200);
    const done = () => {
      clearInterval(iv);
      $('btnNext').onclick = null;
      state.cancelTimer = null;
      resolve();
    };
    $('btnNext').onclick = done;
    state.cancelTimer = done;
  });
}

// Draw one question's text to overlay at the bottom of the video: transparent 1920 px PNG,
// soft dark band at the bottom, a "Question 1 of 3" label (accent color) and the question text.
// Exported for tests.
export function drawCaption(text, i, n) {
  const W = 1920,
    H = 380,
    MARGIN = 120,
    MAX_WIDTH = W - MARGIN * 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.38)');
  g.addColorStop(1, 'rgba(0,0,0,0.72)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif';
  // Break into at most 3 lines; the font shrinks for long questions
  let fontSize = 64,
    lines = [];
  for (; fontSize >= 38; fontSize -= 4) {
    x.font = `700 ${fontSize}px ${FONT}`;
    lines = [];
    let current = '';
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
      const attempt = current ? current + ' ' + word : word;
      if (x.measureText(attempt).width <= MAX_WIDTH || !current) current = attempt;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    if (lines.length <= 3 && lines.every(l => x.measureText(l).width <= MAX_WIDTH)) break;
  }
  if (lines.length > 3) {
    lines = lines.slice(0, 3);
    lines[2] = lines[2].replace(/\s*\S*$/, '') + '…';
  }
  const lineHeight = Math.round(fontSize * 1.22),
    bottom = H - 56;
  const textTop = bottom - lineHeight * lines.length;
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  x.shadowColor = 'rgba(0,0,0,0.55)';
  x.shadowBlur = 14;
  x.shadowOffsetY = 2;
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#B08D57';
  x.font = `700 30px ${FONT}`;
  x.fillStyle = accent;
  if (x.letterSpacing !== undefined) x.letterSpacing = '4px';
  x.fillText(t('quiz.ronde', { i: i + 1, n }).toUpperCase(), W / 2, textTop - 4);
  if (x.letterSpacing !== undefined) x.letterSpacing = '0px';
  x.font = `700 ${fontSize}px ${FONT}`;
  x.fillStyle = '#FFFFFF';
  lines.forEach((l, k) => x.fillText(l, W / 2, textTop + lineHeight * (k + 1) - Math.round(lineHeight * 0.18)));
  return new Promise(res =>
    c.toBlob(b => (b ? b.arrayBuffer().then(a => res(new Uint8Array(a))) : res(null)), 'image/png'),
  );
}
const recordingSeconds = () => Math.max(0, (Date.now() - state.recT0) / 1000);

async function startQuiz() {
  if (state.busy || !needStream() || !state.cfg.quiz.length) return;
  state.busy = true;
  resetIdle();
  const token = ++state.sessionToken;
  $('quizPre').style.display = 'none';
  try {
    await startRecording('quiz'); // record from the start of the countdown
    if (token !== state.sessionToken) return;
    await countdown(QUIZ_COUNTDOWN);
    if (token !== state.sessionToken) return;
    $('quizRun').style.display = 'flex';
    const picks = pickQuestions(quizRounds());
    // Caption timing for the main process; field names (a, b, judul, kapsi, kapsiGambar)
    // are shared with main/olah-video.js and renamed with it in refactor/main-english.
    const captions = [];
    for (let r = 0; r < picks.length; r++) {
      if (token !== state.sessionToken) return;
      $('qRound').textContent = t('quiz.ronde', { i: r + 1, n: picks.length });
      await shuffleTo(picks[r]);
      if (token !== state.sessionToken) return;
      const a = Math.max(0, recordingSeconds() - 0.5); // card stops & question shows (0.5 s before shuffleTo ends)
      await answerTimer(r === picks.length - 1);
      captions.push({ a, b: recordingSeconds(), judul: state.cfg.quiz[picks[r]] });
    }
    if (token !== state.sessionToken) return;
    let captionImages = [];
    try {
      captionImages = await Promise.all(captions.map((k, i) => drawCaption(k.judul, i, picks.length)));
    } catch (e) {
      console.log('Question text for the video could not be created: ' + e.message);
    }
    const complete = captionImages.length === captions.length && captionImages.every(Boolean);
    finishSession({
      questions: picks.map(i => state.cfg.quiz[i]),
      ...(complete ? { kapsi: captions, kapsiGambar: captionImages } : {}),
    });
  } catch (err) {
    console.log('Quiz could not run: ' + err.message);
    if (token === state.sessionToken) abortSession('Gagal memulai rekaman: ' + err.message);
  }
}

// Wire up this feature's buttons (called once from start.js)
export function setupQuiz() {
  $('btnToQuiz').onclick = openQuiz;
  $('btnQuizBack').onclick = () => show('utama');
  $('btnQuizMulai').onclick = startQuiz;
}
