/* =====================================================================
   pesan.js — halaman Kirim pesan
   ===================================================================== */

function openPesan() {
  $('pesanPre').style.display = 'flex';
  $('pesanRec').style.display = 'none';
  show('pesan');
}
async function mulaiPesan() {
  if (busy || !needStream()) return;
  busy = true;
  resetIdle();
  const token = ++sessionToken;
  $('pesanPre').style.display = 'none';
  try {
    // Kamera Sony butuh ±0,5–1 detik sampai benar-benar merekam: mulai merekam di AWAL hitung mundur,
    // supaya kalimat pertama tamu tidak terpotong. Webcam langsung merekam, jadi mulai setelah hitung mundur.
    const awal = pakaiSony() && cfg.pesanCountdown > 0;
    if (awal) {
      await startRecording('pesan');
      if (token !== sessionToken) return;
    }
    await countdown(cfg.pesanCountdown);
    if (token !== sessionToken) return;
    if (!awal) await startRecording('pesan');
    if (token !== sessionToken) return;
    const t0 = Date.now();
    // Batas durasi (Pengaturan videobooth): rekaman berhenti sendiri kalau tamu lupa menekan Selesai
    const batas = cfg.pesanMaxSeconds;
    const tampil = () => {
      const s = Math.floor((Date.now() - t0) / 1000);
      $('pesanTime').textContent = batas > 0 ? `${fmt(Math.min(s, batas))} / ${fmt(batas)}` : fmt(s);
    };
    tampil();
    $('pesanRec').style.display = 'flex';
    recTick = setInterval(tampil, 250);
    if (batas > 0)
      pesanLimit = setTimeout(() => {
        if (token === sessionToken) finishSession();
      }, batas * 1000);
  } catch (err) {
    console.log('Gagal memulai pesan: ' + err.message);
    if (token === sessionToken) abortSession('Gagal memulai rekaman: ' + err.message);
  }
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
function pasangPesan() {
  $('btnToPesan').onclick = openPesan;
  $('btnPesanBack').onclick = () => show('utama');
  $('btnPesanMulai').onclick = mulaiPesan;
  $('btnFinish').onclick = () => finishSession();
}
