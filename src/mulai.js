/* =====================================================================
   mulai.js — dijalankan paling akhir: memuat pengaturan & couple,
   memasang tombol setiap fitur, lalu membuka kamera
   ===================================================================== */
(async () => {
  cfg = await api.getConfig();
  cfg.quiz = cfg.quiz || [];
  cfg.quizSeconds = Number(cfg.quizSeconds) || 60;
  cfg.quizRounds = Number(cfg.quizRounds) || 3;
  if (cfg.colors) {
    const r = document.documentElement.style;
    if (cfg.colors.accent) r.setProperty('--accent', cfg.colors.accent);
  }
  applyCouples(await api.getCouples());
  buildQInputs();

  pasangNavigasi();
  pasangPesan();
  pasangQuiz();
  pasangAdmin();
  pasangPengaturan();
  pasangCouple();
  pasangRekaman();
  pasangPhotobooth();

  window.addEventListener('unhandledrejection', e => console.log('Error: ' + (e.reason && e.reason.message || e.reason)));
  document.addEventListener('pointerdown', resetIdle);
  document.addEventListener('keydown', resetIdle);
  document.addEventListener('contextmenu', e => e.preventDefault());
  document.querySelectorAll('video').forEach(v => { v.disableRemotePlayback = true; });
  ['dragover', 'drop'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));

  try { await initDevices(); } catch (err) { setNotice('Gagal membuka kamera/mic: ' + err.message); }
  try {
    const info = await api.getStartupInfo();
    if (info && info.recovered) setNotice(`${info.recovered} rekaman yang sempat terputus berhasil dipulihkan. Cek daftar sesi di Admin.`, 15000);
  } catch (err) {}
})();
