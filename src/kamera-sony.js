/* =====================================================================
   kamera-sony.js — kamera Sony di layar: pilihan sumber kamera di Admin,
   status kamera, dan live view sebagai latar belakang booth.
   Jepret & rekam dengan kamera Sony ada di photobooth.js & rekaman.js
   (lewat pakaiSony()). Penghubung kameranya ada di main/kamera-sony.js.
   ===================================================================== */

let sonySt = { mode: 'webcam', tersambung: false, pesan: '' }; // status terakhir dari proses utama
let lvJalan = false;
let lvTahan = false; // true = gambar kamera dibekukan (saat kamera berganti mode)
let lvNo = 0; // jumlah gambar live view yang sudah digambar
let gantiId = 0;

const pakaiSony = () => !!cfg && (cfg.kamera === 'sony' || cfg.kamera === 'sony-sim');

// Pasang sumber kamera sesuai pengaturan: webcam/HP atau Sony
async function terapkanKamera() {
  document.body.classList.toggle('sonyOn', pakaiSony());
  if (pakaiSony()) {
    // Webcam & mic komputer dilepas: gambar dan suara video datang dari kamera Sony
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
    noCam = false;
    $('cam').srcObject = null;
    $('camPrev').srcObject = null;
    jalankanLiveView();
  } else if (!mediaStream) {
    await openStream();
  }
}

/* ---------- Mode kamera mengikuti halaman ----------
   Kirim pesan / Quiz → VIDEO, Photo booth → FOTO. Dipanggil dari show() (app.js).
   Kamera pindah ±2 detik; rekam & jepret menunggu sampai modenya benar. */
// Transisi halus: selama kamera berganti mode, gambar kamera dibekukan + diberi kabut (blur
// lembut, sedikit memudar). Kabut hilang setelah gambar baru dengan bentuk yang benar masuk.
// Ringan: gambar yang dibekukan tidak digambar ulang, jadi blur hanya dihitung sekali.
function modeUntukLayar(name) {
  if (!pakaiSony() || !api.sonyMode) return;
  const jenis = { pesan: 'video', quiz: 'video', photo: 'foto' }[name];
  if (!jenis) return;
  const id = ++gantiId;
  const perluGanti = sonySt.tersambung && sonySt.jenisMode && sonySt.jenisMode !== jenis;
  if (perluGanti) {
    lvTahan = true;
    document.body.classList.add('lvGanti');
  }
  const selesai = async () => {
    if (id !== gantiId) return; // sudah ada pergantian lain yang lebih baru
    lvTahan = false;
    if (!document.body.classList.contains('lvGanti')) return;
    const n = lvNo,
      t0 = performance.now(); // tunggu 2 gambar baru (bentuk sudah benar), maks 1,5 dtk
    while (lvNo < n + 2 && performance.now() - t0 < 1500) await sleep(40);
    if (id === gantiId) document.body.classList.remove('lvGanti');
  };
  const pengaman = setTimeout(selesai, 6000); // jangan sampai kabut tertinggal
  api
    .sonyMode(jenis)
    .catch(() => {})
    .finally(() => {
      clearTimeout(pengaman);
      selesai();
    });
}

/* ---------- Live view ---------- */
// Hanya diambil saat dibutuhkan (halaman dengan kamera di belakang, atau Admin)
const butuhLiveView = () => document.body.classList.contains('camOn') || current === 'admin';
function gambarLv(c, bmp) {
  if (c.width !== bmp.width || c.height !== bmp.height) {
    c.width = bmp.width;
    c.height = bmp.height;
  }
  c.getContext('2d').drawImage(bmp, 0, 0);
}
async function jalankanLiveView() {
  if (lvJalan) return;
  lvJalan = true;
  try {
    while (pakaiSony()) {
      if (!butuhLiveView() || !sonySt.tersambung || document.hidden) {
        await sleep(250);
        continue;
      }
      const t0 = performance.now();
      let buf = null;
      try {
        buf = await api.sonyLiveView();
      } catch {
        /* gambar live view gagal diambil: dicoba lagi di putaran berikutnya */
      }
      if (buf) {
        try {
          const bmp = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }));
          if (!lvTahan) {
            gambarLv($('camLv'), bmp);
            lvNo++;
          }
          if (current === 'admin') gambarLv($('camPrevLv'), bmp);
          bmp.close();
        } catch {
          /* gambar live view rusak: dilewati */
        }
      } else await sleep(200);
      const sisa = 40 - (performance.now() - t0); // paling cepat ±25 gambar per detik
      if (sisa > 0) await sleep(sisa);
    }
  } finally {
    lvJalan = false;
  }
}

/* ---------- Status kamera di Admin ---------- */
function teksStatusSony(s) {
  if (s.tersambung) {
    const bagian = [`${s.model || 'Sony camera'} connected`];
    if (s.baterai >= 0) bagian.push(`battery ${s.baterai}%`);
    if (s.kartu > 0) bagian.push('⚠️ SD card problem / no card');
    else if (s.sisaDetik > 0)
      bagian.push(`±${Math.floor(s.sisaDetik / 3600)} h ${Math.floor((s.sisaDetik % 3600) / 60)} m recording left`);
    if (s.mengunduh) bagian.push('copying video');
    return bagian.join(' · ');
  }
  return s.pesan || 'Looking for the Sony camera…';
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
    ? "Video sound comes from the Sony camera: plug the mic into the camera's mic jack. Videos are recorded to the SD card and copied to the couple folder automatically. Use a dummy battery so the camera doesn't die mid-event."
    : 'Computer camera & mic, a USB webcam, or a phone used as a webcam.';
  tulisStatusSony();
}
function terimaStatusSony(s) {
  const dulu = sonySt.tersambung;
  sonySt = s || sonySt;
  tulisStatusSony();
  // Kamera terputus di tengah rekaman pesan/quiz: hentikan sesi dengan pesan yang jelas
  if (dulu && !sonySt.tersambung && rec && rec.sony)
    abortSession('The Sony camera disconnected while recording. What was recorded is still on the camera SD card.');
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
async function pasangKameraSony() {
  api.onSonyStatus(terimaStatusSony);
  try {
    sonySt = await api.sonyStatus();
  } catch {
    /* status kamera belum bisa dibaca: memakai status terakhir */
  }
  $('camSumber').onchange = async e => {
    const s = await api.saveSettings({ kamera: e.target.value });
    applySettings(s);
    await terapkanKamera();
    isiKameraAdmin();
    await fillDevices();
    const nama = { webcam: 'Webcam / phone', sony: 'Sony (USB)', 'sony-sim': 'Sony – simulation' }[cfg.kamera];
    flash('camMsg', `Camera source: ${nama}.`);
  };
  $('btnSonyUlang').onclick = async () => {
    $('sonyStatus').textContent = 'Looking for the Sony camera…';
    terimaStatusSony(await api.sonySambungUlang());
  };
}
