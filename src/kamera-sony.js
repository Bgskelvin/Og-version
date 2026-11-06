/* =====================================================================
   kamera-sony.js — kamera Sony di layar: pilihan sumber kamera di Admin,
   status kamera, dan live view sebagai latar belakang booth.
   Jepret & rekam dengan kamera Sony ada di photobooth.js & rekaman.js
   (lewat pakaiSony()). Penghubung kameranya ada di main/kamera-sony.js.
   ===================================================================== */

let sonySt = { mode: 'webcam', tersambung: false, pesan: '' };   // status terakhir dari proses utama
let lvJalan = false;

const pakaiSony = () => !!cfg && (cfg.kamera === 'sony' || cfg.kamera === 'sony-sim');

// Pasang sumber kamera sesuai pengaturan: webcam/HP atau Sony
async function terapkanKamera() {
  document.body.classList.toggle('sonyOn', pakaiSony());
  if (pakaiSony()) {
    // Webcam & mic komputer dilepas: gambar dan suara video datang dari kamera Sony
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null; noCam = false;
    $('cam').srcObject = null; $('camPrev').srcObject = null;
    jalankanLiveView();
  } else if (!mediaStream) {
    await openStream();
  }
}

/* ---------- Mode kamera mengikuti halaman ----------
   Kirim pesan / Quiz → VIDEO, Photo booth → FOTO. Dipanggil dari show() (app.js).
   Kamera pindah ±2 detik; rekam & jepret menunggu sampai modenya benar. */
function modeUntukLayar(name) {
  if (!pakaiSony() || !api.sonyMode) return;
  const jenis = { pesan: 'video', quiz: 'video', photo: 'foto' }[name];
  if (jenis) api.sonyMode(jenis).catch(() => {});
}

/* ---------- Live view ---------- */
// Hanya diambil saat dibutuhkan (halaman dengan kamera di belakang, atau Admin)
const butuhLiveView = () => document.body.classList.contains('camOn') || current === 'admin';
function gambarLv(c, bmp) {
  if (c.width !== bmp.width || c.height !== bmp.height) { c.width = bmp.width; c.height = bmp.height; }
  c.getContext('2d').drawImage(bmp, 0, 0);
}
async function jalankanLiveView() {
  if (lvJalan) return;
  lvJalan = true;
  try {
    while (pakaiSony()) {
      if (!butuhLiveView() || !sonySt.tersambung || document.hidden) { await sleep(250); continue; }
      const t0 = performance.now();
      let buf = null;
      try { buf = await api.sonyLiveView(); } catch (e) {}
      if (buf) {
        try {
          const bmp = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }));
          gambarLv($('camLv'), bmp);
          if (current === 'admin') gambarLv($('camPrevLv'), bmp);
          bmp.close();
        } catch (e) {}
      } else await sleep(200);
      const sisa = 40 - (performance.now() - t0);           // paling cepat ±25 gambar per detik
      if (sisa > 0) await sleep(sisa);
    }
  } finally { lvJalan = false; }
}

/* ---------- Status kamera di Admin ---------- */
function teksStatusSony(s) {
  if (s.tersambung) {
    const bagian = [`${s.model || 'Kamera Sony'} tersambung`];
    if (s.baterai >= 0) bagian.push(`baterai ${s.baterai}%`);
    if (s.kartu > 0) bagian.push('⚠️ kartu SD bermasalah / tidak ada');
    else if (s.sisaDetik > 0) bagian.push(`sisa rekam ±${Math.floor(s.sisaDetik / 3600)} j ${Math.floor(s.sisaDetik % 3600 / 60)} m`);
    if (s.mengunduh) bagian.push('sedang menyalin video');
    return bagian.join(' · ');
  }
  return s.pesan || 'Mencari kamera Sony…';
}
function tulisStatusSony() {
  if (!$('sonyStatus')) return;
  $('sonyStatus').textContent = teksStatusSony(sonySt);
  $('sonyDot').className = 'sony-dot ' + (sonySt.tersambung ? (sonySt.kartu > 0 ? 'kuning' : 'hijau') : 'merah');
}
function isiKameraAdmin() {
  const sony = pakaiSony();
  $('camSumber').value = cfg.kamera || 'webcam';
  $('camSelRow').style.display = $('micSelRow').style.display = sony ? 'none' : '';
  $('sonyRow').style.display = sony ? '' : 'none';
  $('camHint').textContent = sony
    ? 'Suara video berasal dari kamera Sony: colokkan mic ke jack mic kamera. Video direkam ke kartu SD lalu otomatis disalin ke folder couple. Pakai dummy battery supaya kamera tidak mati di tengah acara.'
    : 'Kamera & mic komputer, webcam USB, atau HP sebagai webcam.';
  tulisStatusSony();
}
function terimaStatusSony(s) {
  const dulu = sonySt.tersambung;
  sonySt = s || sonySt;
  tulisStatusSony();
  // Kamera terputus di tengah rekaman pesan/quiz: hentikan sesi dengan pesan yang jelas
  if (dulu && !sonySt.tersambung && rec && rec.sony)
    abortSession('Kamera Sony terputus saat merekam. Video yang sempat terekam tetap ada di kartu SD kamera.');
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
async function pasangKameraSony() {
  api.onSonyStatus(terimaStatusSony);
  try { sonySt = await api.sonyStatus(); } catch (e) {}
  $('camSumber').onchange = async e => {
    const s = await api.saveSettings({ kamera: e.target.value });
    applySettings(s);
    await terapkanKamera();
    isiKameraAdmin();
    await fillDevices();
    const nama = { webcam: 'Webcam / HP', sony: 'Sony (USB)', 'sony-sim': 'Sony – simulasi' }[cfg.kamera];
    flash('camMsg', `Sumber kamera: ${nama}.`);
  };
  $('btnSonyUlang').onclick = async () => {
    $('sonyStatus').textContent = 'Mencari kamera Sony…';
    terimaStatusSony(await api.sonySambungUlang());
  };
}
