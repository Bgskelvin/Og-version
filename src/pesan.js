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
  busy = true; resetIdle();
  const token = ++sessionToken;
  $('pesanPre').style.display = 'none';
  try {
    await countdown();
    if (token !== sessionToken) return;
    await startRecording('pesan');
    if (token !== sessionToken) return;
    $('pesanTime').textContent = '0:00';
    $('pesanRec').style.display = 'flex';
    recTick = setInterval(() => { $('pesanTime').textContent = fmt(Math.floor((Date.now() - recT0) / 1000)); }, 250);
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
