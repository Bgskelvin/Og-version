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
