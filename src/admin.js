/* =====================================================================
   admin.js — login Admin, kamera/mic, folder penyimpanan
   (daftar sesi ada di riwayat.js)
   ===================================================================== */

// Login Admin cukup sekali selama aplikasi terbuka. Disimpan di memori saja (bukan di disk),
// jadi setelah aplikasi ditutup lalu dibuka lagi, Admin harus login lagi.
let adminMasuk = false;

async function bukaPanelAdmin() {
  $('adminLogin').style.display = 'none';
  $('adminPanel').style.display = 'flex';
  show('admin');
  await refreshAdmin();
}
function openAdmin() {
  if (adminMasuk) return bukaPanelAdmin();
  $('adminLogin').style.display = 'block';
  $('adminPanel').style.display = 'none';
  $('uid').value = ''; $('pw').value = ''; $('loginErr').textContent = '';
  show('admin');
  setTimeout(() => $('uid').focus(), 50);
}
async function doLogin() {
  if (await api.login($('uid').value.trim(), $('pw').value)) {
    adminMasuk = true;
    $('pw').value = '';
    await bukaPanelAdmin();
  } else { $('loginErr').textContent = 'ID atau password salah'; $('pw').value = ''; }
}
async function loadOutDir() {
  const r = await api.getOutDir();
  $('outDir').textContent = r.dir + (r.isDefault ? '  (default)' : '');
  $('dirMsg').textContent = r.ok ? '' : 'Folder ini tidak tersedia. Rekaman akan disimpan di folder default.';
}
async function refreshAdmin() {
  applyCouples(await api.getCouples()); fillCoupleSel();
  await loadSettings();
  await fillDevices(); isiKameraAdmin(); await loadOutDir(); await loadSessions();
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
function pasangAdmin() {
  $('btnAdminOpen').onclick = openAdmin;
  $('btnLogin').onclick = doLogin;
  $('btnLoginBack').onclick = () => show('utama');
  $('pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('uid').addEventListener('keydown', e => { if (e.key === 'Enter') $('pw').focus(); });
  $('btnAdminBack').onclick = () => show('utama');
  $('btnTutupApp').onclick = konfirmasiTutup;
  $('btnLihatCatatan').onclick = lihatCatatan;
  $('btnSimpanCatatan').onclick = simpanCatatan;
  // Kunci Admin lagi (mis. booth ditinggal tanpa operator): berikutnya harus login
  $('btnKunciAdmin').onclick = () => { adminMasuk = false; show('utama'); };
  $('camSel').onchange = async e => { store.set('camId', e.target.value); await openStream(); await fillDevices(); };
  $('micSel').onchange = async e => { store.set('micId', e.target.value); await openStream(); await fillDevices(); };
  $('btnChooseDir').onclick = async () => {
    const r = await api.chooseOutDir();
    if (r.error) $('dirMsg').textContent = r.error; else if (!r.canceled) await loadOutDir();
  };
  $('btnResetDir').onclick = async () => { await api.resetOutDir(); await loadOutDir(); };
  $('btnFolder').onclick = () => api.openFolder();
  $('btnRefresh').onclick = async () => { if (!pakaiSony()) await openStream(); await refreshAdmin(); };
}

/* ---------- Tutup aplikasi (dari Admin) ---------- */
async function konfirmasiTutup() {
  let c = { salin: 0, proses: 0, foto: 0 };
  try { c = await api.cekTutup(); } catch (e) {}
  const catatan = [];
  if (c.salin) catatan.push(`${c.salin} video masih disalin dari kamera Sony. File aslinya aman di kartu kamera; bisa disalin lagi lewat Riwayat sesi.`);
  if (c.proses) catatan.push(`${c.proses} video masih diproses. Prosesnya dilanjutkan otomatis saat aplikasi dibuka lagi.`);
  if (c.foto) catatan.push(`${c.foto} foto QR belum terkirim. Pengirimannya dilanjutkan otomatis saat aplikasi dibuka lagi (perlu internet).`);
  const lapis = document.createElement('div'); lapis.className = 'dialog-lapis'; lapis.id = 'dlgTutup';
  lapis.innerHTML = `<div class="dialog-kartu"><h2>Tutup aplikasi?</h2><p></p><ul></ul>
    <div class="dialog-aksi"><button class="btn sm tint" id="dlgTutupBatal">Batal</button><button class="btn sm primary" id="dlgTutupYa">Tutup aplikasi</button></div></div>`;
  lapis.querySelector('p').textContent = 'Kamera Sony akan diputus dengan rapi, lalu aplikasi tertutup.';
  const ul = lapis.querySelector('ul');
  if (catatan.length) catatan.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
  else ul.remove();
  document.body.appendChild(lapis);
  lapis.querySelector('#dlgTutupBatal').onclick = () => lapis.remove();
  lapis.onclick = e => { if (e.target === lapis) lapis.remove(); };
  lapis.querySelector('#dlgTutupYa').onclick = async () => {
    lapis.querySelector('.dialog-kartu').innerHTML = '<div class="spinner"></div><h2>Menutup aplikasi…</h2><p>Memutus kamera dengan rapi. Tunggu sebentar.</p>';
    lapis.onclick = null;
    await api.tutupAplikasi();
  };
}

/* ---------- Catatan aplikasi (log) ---------- */
async function lihatCatatan() {
  let r = { teks: '', file: '' };
  try { r = await api.catatanBaca(); } catch (e) {}
  const lapis = document.createElement('div'); lapis.className = 'dialog-lapis'; lapis.id = 'dlgCatatan';
  lapis.innerHTML = `<div class="dialog-kartu catatan-kartu"><h2></h2><p></p><pre class="catatan-isi"></pre>
    <div class="dialog-aksi"><button class="btn sm tint" id="dlgCatatanSimpan">Simpan untuk dikirim</button><button class="btn sm primary" id="dlgCatatanTutup">Tutup</button></div></div>`;
  lapis.querySelector('h2').textContent = 'Catatan aplikasi' + (r.file ? ' · ' + r.file : '');
  lapis.querySelector('p').textContent = r.teks ? '✗ = error, ⚠ = peringatan. Yang terbaru ada di bawah.' : 'Belum ada catatan.';
  const pre = lapis.querySelector('pre');
  pre.textContent = r.teks || '';
  if (!r.teks) pre.remove();
  document.body.appendChild(lapis);
  if (r.teks) pre.scrollTop = pre.scrollHeight;
  const tutup = () => lapis.remove();
  lapis.onclick = e => { if (e.target === lapis) tutup(); };
  lapis.querySelector('#dlgCatatanTutup').onclick = tutup;
  lapis.querySelector('#dlgCatatanSimpan').onclick = async () => { tutup(); await simpanCatatan(); };
}
async function simpanCatatan() {
  const r = await api.catatanSimpan();
  if (r.batal) return;
  if (r.error) setNotice(r.error, 5000);
  else setNotice('Catatan tersimpan: ' + r.file.split('/').pop() + ' (ditunjukkan di Finder)', 5000);
}
