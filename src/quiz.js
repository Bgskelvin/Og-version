/* =====================================================================
   quiz.js — halaman Quick quiz (acak pertanyaan, timer jawaban)
   ===================================================================== */

const quizRounds = () => Math.min(cfg.quizRounds, cfg.quiz.length);
function openQuiz() {
  $('btnQuizMulai').disabled = !cfg.quiz.length;
  if (!cfg.quiz.length) {
    $('quizInfo').textContent = t('quiz.kosong');
    $('quizPre').style.display = 'flex'; $('quizRun').style.display = 'none'; show('quiz'); return;
  }
  $('quizInfo').textContent = t('quiz.info', { n: quizRounds(), s: cfg.quizSeconds });
  $('quizPre').style.display = 'flex';
  $('quizRun').style.display = 'none';
  show('quiz');
}
function pickQuestions(n) {
  const idx = cfg.quiz.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const out = idx.slice(0, n);
  while (out.length < n) out.push(Math.floor(Math.random() * cfg.quiz.length));
  return out;
}
async function shuffleTo(qi) {
  const card = $('qCard');
  $('qBarWrap').style.visibility = 'hidden'; $('qTime').style.visibility = 'hidden'; $('btnNext').style.visibility = 'hidden';
  card.classList.remove('reveal'); card.classList.add('shuffling');
  for (let d = 60; d < 320; d *= 1.15) {
    $('qText').textContent = cfg.quiz[Math.floor(Math.random() * cfg.quiz.length)];
    await sleep(d);
  }
  $('qText').textContent = cfg.quiz[qi];
  card.classList.remove('shuffling');
  void card.offsetWidth; card.classList.add('reveal');
  await sleep(500);
}
function answerTimer(isLast) {
  const secs = cfg.quizSeconds;
  $('qBarWrap').style.visibility = 'visible'; $('qTime').style.visibility = 'visible'; $('btnNext').style.visibility = 'visible';
  $('btnNext').textContent = isLast ? t('quiz.selesai') : t('quiz.lanjut');
  return new Promise(resolve => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const remain = Math.max(0, secs - (Date.now() - t0) / 1000);
      $('qBar').style.width = (remain / secs * 100) + '%';
      $('qTime').textContent = t('quiz.sisa', { t: fmt(Math.ceil(remain)) });
      if (remain <= 0) done();
    }, 200);
    const done = () => { clearInterval(iv); $('btnNext').onclick = null; cancelTimer = null; resolve(); };
    $('btnNext').onclick = done;
    cancelTimer = done;
  });
}
async function mulaiQuiz() {
  if (busy || !needStream() || !cfg.quiz.length) return;
  busy = true; resetIdle();
  const token = ++sessionToken;
  $('quizPre').style.display = 'none';
  $('quizRun').style.display = 'flex';
  try {
    await startRecording('quiz');
    const picks = pickQuestions(quizRounds());
    for (let r = 0; r < picks.length; r++) {
      if (token !== sessionToken) return;
      $('qRound').textContent = t('quiz.ronde', { i: r + 1, n: picks.length });
      await shuffleTo(picks[r]);
      if (token !== sessionToken) return;
      await answerTimer(r === picks.length - 1);
    }
    if (token !== sessionToken) return;
    finishSession({ questions: picks.map(i => cfg.quiz[i]) });
  } catch (err) {
    console.log('Gagal menjalankan quiz: ' + err.message);
    if (token === sessionToken) abortSession('Gagal memulai rekaman: ' + err.message);
  }
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
function pasangQuiz() {
  $('btnToQuiz').onclick = openQuiz;
  $('btnQuizBack').onclick = () => show('utama');
  $('btnQuizMulai').onclick = mulaiQuiz;
}
