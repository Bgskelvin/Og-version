/* =====================================================================
   admin.js — login Admin, kamera/mic, folder penyimpanan
   (daftar sesi ada di riwayat.js)
   ===================================================================== */

function openAdmin() {
  $('adminLogin').style.display = 'block';
  $('adminPanel').style.display = 'none';
  $('uid').value = ''; $('pw').value = ''; $('loginErr').textContent = '';
  show('admin');
  setTimeout(() => $('uid').focus(), 50);
}
async function doLogin() {
  if (await api.login($('uid').value.trim(), $('pw').value)) {
    $('adminLogin').style.display = 'none';
    $('adminPanel').style.display = 'flex';
    $('pw').value = '';
    await refreshAdmin();
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
