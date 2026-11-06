/* =====================================================================
   rekaman.js — perekaman video, hitung mundur, layar Menyimpan,
   halaman Terima kasih, dan pembatalan saat ada error
   ===================================================================== */

// Setiap rekaman punya objek & ID sendiri, jadi rekaman baru tidak bisa menimpa yang sedang disimpan.
async function startRecording(label) {
  // tunggu rekaman sebelumnya selesai disimpan, paling lama 15 detik supaya layar tidak pernah tertahan
  await Promise.race([lastSave.catch(() => {}), sleep(15000)]);
  const sony = pakaiSony();
  const r = await api.recStart(label, { sony, tamu: namaTamu });
  if (!r || r.error) throw new Error((r && r.error) || 'Gagal memulai rekaman');
  if (r.fallback) setNotice('Folder pilihan tidak tersedia, rekaman disimpan di folder default', 8000);
  const cur = { id: r.id, t0: Date.now(), pending: Promise.resolve(), recorder: null, sony };
  if (sony) { rec = cur; recT0 = cur.t0; return; }   // kamera Sony merekam sendiri ke kartu SD
  try {
    cur.recorder = new MediaRecorder(mediaStream, noCam ? { mimeType: 'audio/webm;codecs=opus' }
      : { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 5000000 });
  } catch (err) {
    await api.recAbort(r.id);
    throw err;
  }
  cur.recorder.ondataavailable = e => {
    if (!e.data.size) return;
    cur.pending = cur.pending
      .then(async () => api.recChunk(cur.id, new Uint8Array(await e.data.arrayBuffer())))
      .catch(err => console.log('Gagal mengirim potongan rekaman: ' + err.message));
  };
  cur.recorder.onerror = ev => {
    if (rec === cur) abortSession('Perekaman berhenti karena kamera/mic bermasalah. Cek perangkat di Admin.');
  };
  cur.recorder.start(1000);
  rec = cur;
  recT0 = cur.t0;
}
function stopRecording(meta) {
  const cur = rec;
  rec = null;
  if (!cur) return Promise.resolve(false);
  const seconds = Math.round((Date.now() - cur.t0) / 1000);
  const info = { couple: activeCouple ? activeCouple.name : '', ...(meta || {}) };
  const p = new Promise(resolve => {
    const finish = async () => {
      let ok = false;
      try {
        await cur.pending;
        const res = await api.recEnd(cur.id, seconds, info);
        ok = !!(res && res.ok);
        if (res && !res.ok) setNotice('Rekaman terakhir gagal disimpan: ' + res.error, 15000);
      } catch (err) { setNotice('Rekaman terakhir gagal disimpan: ' + err.message, 15000); }
      resolve(ok);
    };
    if (!cur.recorder || cur.recorder.state === 'inactive') finish();
    else { cur.recorder.onstop = finish; cur.recorder.stop(); }
  });
  lastSave = p;
  return p;
}
// Hitung mundur sebelum merekam pesan (lamanya diatur di Pengaturan videobooth; 0 = langsung)
async function countdown(detik = 3) {
  if (detik <= 0) return;
  $('countOverlay').style.display = 'flex';
  for (let i = detik; i >= 1; i--) { $('countNum').textContent = i; await sleep(1000); }
  $('countOverlay').style.display = 'none';
}
// Setelah pesan/quiz: layar "Menyimpan" minimal 3 detik, dan sampai rekaman benar-benar tersimpan.
// Tamu tidak bisa menekan apa pun di layar ini, jadi tidak bisa langsung "Coba Lagi".
const SAVE_MIN_MS = 3000, SAVE_MAX_MS = 15000;
let finishing = false;
// Pesan di Halaman Terima kasih mengikuti hasil penyimpanan yang sebenarnya
function setThanks(result) {
  const ok = result === true, slow = result === 'slow';
  // Pratinjau foto hanya untuk Photo Booth; photobooth.js menampilkannya setelah memanggil fungsi ini
  $('thanks').classList.remove('tk-foto', 'tk-ada-qr');
  $('thanksNama').textContent = namaTamu || '';
  $('thanksPhoto').style.display = 'none';
  $('thanksQR').style.display = 'none';
  $('thanksBadge').style.display = '';
  $('thanksBadge').style.background = ok || slow ? '' : 'var(--orange)';
  $('thanksBadge').innerHTML = ok || slow ? '<svg class="i"><use href="#i-check"/></svg>' : '<span style="font-size:52px;font-weight:700">!</span>';
  $('thanksMsg').textContent = ok ? t('tk.ok') : slow ? t('tk.lambat') : t('tk.gagal');
}
async function finishSession(meta) {
  if (finishing) return;                       // cegah tombol Finish tertekan dua kali
  finishing = true;
  sessionToken++;
  clearInterval(recTick); clearTimeout(pesanLimit);
  const bar = $('saveBar');
  bar.classList.remove('run'); void bar.offsetWidth; bar.classList.add('run');
  $('savingTitle').textContent = t('simpan.rekaman');
  show('saving');
  const saved = stopRecording(meta);
  // Batas atas 15 detik supaya layar tidak pernah tertahan; penyimpanan tetap lanjut di belakang
  const [, result] = await Promise.all([sleep(SAVE_MIN_MS), Promise.race([saved, sleep(SAVE_MAX_MS).then(() => 'slow')])]);
  finishing = false;
  busy = false;
  setThanks(result);
  show('thanks');
}
// Dipanggil kalau sesuatu gagal: simpan yang sempat terekam, lalu kembali ke Halaman Utama.
// Aplikasi tidak pernah tertahan di layar tanpa tombol.
async function abortSession(msg) {
  sessionToken++;
  clearInterval(recTick); clearTimeout(pesanLimit);
  if (cancelTimer) cancelTimer();
  $('countOverlay').style.display = 'none';
  const saving = stopRecording({ aborted: true });
  busy = false;
  setNotice(msg, 15000);
  show('utama');
  await saving;
}
function needStream() {
  if (pakaiSony()) {
    if (sonySt.tersambung) return true;
    setNotice('Kamera Sony belum tersambung. Cek kabel USB & kamera, atau lihat di Admin.', 8000);
    return false;
  }
  if (mediaStream) return true;
  setNotice('Tidak ada kamera/mic. Atur di halaman Admin.', 8000);
  return false;
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
function pasangRekaman() {
  // Penyimpanan gagal di tengah rekaman (disk penuh / SSD tercabut)
  api.onRecError((id, msg) => {
    if (rec && rec.id === id) abortSession('Rekaman gagal disimpan: ' + msg + '. Cek ruang disk / folder penyimpanan di Admin.');
    else setNotice('Rekaman gagal disimpan: ' + msg, 15000);
  });
}
