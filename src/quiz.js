/* =====================================================================
   quiz.js — halaman Quick quiz (acak pertanyaan, timer jawaban)
   - Hitung mundur 3 detik sebelum pertanyaan pertama. Kamera sudah merekam
     sejak awal hitung mundur, jadi jeda kamera (Sony ±0,5–1 dtk) tidak
     memotong pertanyaan pertama.
   - Waktu tampil tiap pertanyaan dicatat, dan teks pertanyaannya digambar
     sebagai PNG transparan. Proses utama menempelkannya ke bagian bawah
     video (main/olah-video.js); video asli tanpa teks tetap disimpan.
   ===================================================================== */

const QUIZ_HITUNG = 3;      // detik hitung mundur sebelum pertanyaan pertama

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
// Gambar teks satu pertanyaan untuk ditempel di bawah video: PNG transparan 1920 px,
// pita gelap lembut di bawah, label "Question 1 of 3" (warna aksen) dan teks pertanyaannya.
function gambarKapsi(teks, i, n) {
  const W = 1920, H = 380, PINGGIR = 120, LEBAR = W - PINGGIR * 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.35, 'rgba(0,0,0,0.38)'); g.addColorStop(1, 'rgba(0,0,0,0.72)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif';
  // Pecah jadi paling banyak 3 baris; huruf mengecil kalau pertanyaannya panjang
  let ukuran = 64, baris = [];
  for (; ukuran >= 38; ukuran -= 4) {
    x.font = `700 ${ukuran}px ${FONT}`;
    baris = []; let kini = '';
    for (const kata of String(teks).split(/\s+/).filter(Boolean)) {
      const coba = kini ? kini + ' ' + kata : kata;
      if (x.measureText(coba).width <= LEBAR || !kini) kini = coba; else { baris.push(kini); kini = kata; }
    }
    if (kini) baris.push(kini);
    if (baris.length <= 3 && baris.every(b => x.measureText(b).width <= LEBAR)) break;
  }
  if (baris.length > 3) { baris = baris.slice(0, 3); baris[2] = baris[2].replace(/\s*\S*$/, '') + '…'; }
  const tinggiBaris = Math.round(ukuran * 1.22), bawah = H - 56;
  const atasTeks = bawah - tinggiBaris * baris.length;
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.shadowColor = 'rgba(0,0,0,0.55)'; x.shadowBlur = 14; x.shadowOffsetY = 2;
  const aksen = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#B08D57';
  x.font = `700 30px ${FONT}`; x.fillStyle = aksen;
  if (x.letterSpacing !== undefined) x.letterSpacing = '4px';
  x.fillText(t('quiz.ronde', { i: i + 1, n }).toUpperCase(), W / 2, atasTeks - 4);
  if (x.letterSpacing !== undefined) x.letterSpacing = '0px';
  x.font = `700 ${ukuran}px ${FONT}`; x.fillStyle = '#FFFFFF';
  baris.forEach((b, k) => x.fillText(b, W / 2, atasTeks + tinggiBaris * (k + 1) - Math.round(tinggiBaris * 0.18)));
  return new Promise(res => c.toBlob(b => (b ? b.arrayBuffer().then(a => res(new Uint8Array(a))) : res(null)), 'image/png'));
}
const detikRekam = () => Math.max(0, (Date.now() - recT0) / 1000);

async function mulaiQuiz() {
  if (busy || !needStream() || !cfg.quiz.length) return;
  busy = true; resetIdle();
  const token = ++sessionToken;
  $('quizPre').style.display = 'none';
  try {
    await startRecording('quiz');                 // rekam sejak awal hitung mundur
    if (token !== sessionToken) return;
    await countdown(QUIZ_HITUNG);
    if (token !== sessionToken) return;
    $('quizRun').style.display = 'flex';
    const picks = pickQuestions(quizRounds());
    const kapsi = [];
    for (let r = 0; r < picks.length; r++) {
      if (token !== sessionToken) return;
      $('qRound').textContent = t('quiz.ronde', { i: r + 1, n: picks.length });
      await shuffleTo(picks[r]);
      if (token !== sessionToken) return;
      const a = Math.max(0, detikRekam() - 0.5);         // kartu berhenti & pertanyaan tampil (0,5 dtk sebelum shuffleTo selesai)
      await answerTimer(r === picks.length - 1);
      kapsi.push({ a, b: detikRekam(), judul: cfg.quiz[picks[r]] });
    }
    if (token !== sessionToken) return;
    let kapsiGambar = [];
    try { kapsiGambar = await Promise.all(kapsi.map((k, i) => gambarKapsi(k.judul, i, picks.length))); }
    catch (e) { console.log('Teks pertanyaan untuk video gagal dibuat: ' + e.message); }
    const lengkap = kapsiGambar.length === kapsi.length && kapsiGambar.every(Boolean);
    finishSession({ questions: picks.map(i => cfg.quiz[i]), ...(lengkap ? { kapsi, kapsiGambar } : {}) });
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
