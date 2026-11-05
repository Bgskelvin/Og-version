/* =====================================================================
   admin.js — login Admin, kamera/mic, folder penyimpanan, daftar sesi
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
async function loadSessions() {
  const list = await api.getSessions();
  const today = list.filter(s => new Date(s.time).toDateString() === new Date().toDateString()).length;
  const forActive = activeCouple ? list.filter(s => s.couple === activeCouple.name).length : 0;
  $('stats').textContent = `Total sesi: ${list.length}  ·  Hari ini: ${today}  ·  ${activeCouple ? activeCouple.name : '-'}: ${forActive}`;
  const ol = $('sessList'); ol.innerHTML = '';
  if (!list.length) { const li = document.createElement('li'); li.textContent = 'Belum ada sesi.'; ol.appendChild(li); return; }
  list.map((s, i) => ({ s, n: i + 1 })).reverse().forEach(({ s, n }) => {
    const d = new Date(s.time);
    const jam = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const jenis = s.label === 'pesan' ? 'Pesan' : s.label === 'quiz' ? 'Quiz' : s.label === 'foto' ? 'Foto (' + (s.photos || 4) + ')' : 'Quiz #' + String(s.label).split('-')[1];
    const st = { photo: ' · foto tersimpan', processing: ' · memproses MP4', done: ' · MP4 siap', failed: ' · gagal konversi (.webm tersimpan)',
      transfer: ' · menyalin dari kamera', 'card-only': ' · ada di kartu SD kamera (belum tersalin' + (s.error ? ': ' + s.error : '') + ')',
      'write-error': ' · gagal disimpan (' + (s.error || 'error disk') + ')',
      recording: ' · sedang merekam', lost: ' · hilang (rekaman kosong)' }[s.status] || '';
    const rcv = s.recovered ? ' · dipulihkan' : '';
    const li = document.createElement('li');
    li.value = n;
    li.textContent = `${jam} · ${s.couple ? s.couple + ' · ' : ''}${jenis} · ${fmt(s.seconds || 0)}${st}${rcv}`;
    ol.appendChild(li);
  });
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
