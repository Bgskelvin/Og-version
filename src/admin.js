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
  $('uid').value = '';
  $('pw').value = '';
  $('loginErr').textContent = '';
  show('admin');
  setTimeout(() => $('uid').focus(), 50);
}
async function doLogin() {
  if (await api.login($('uid').value.trim(), $('pw').value)) {
    adminMasuk = true;
    $('pw').value = '';
    await bukaPanelAdmin();
  } else {
    $('loginErr').textContent = 'Wrong ID or password';
    $('pw').value = '';
  }
}
async function loadOutDir() {
  const r = await api.getOutDir();
  $('outDir').textContent = r.dir + (r.isDefault ? '  (default)' : '');
  $('dirMsg').textContent = r.ok ? '' : 'This folder is not available. Recordings will be saved to the default folder.';
}
async function refreshAdmin() {
  applyCouples(await api.getCouples());
  fillCoupleSel();
  await loadSettings();
  await fillDevices();
  isiKameraAdmin();
  await loadOutDir();
  await loadSessions();
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari start.js)
function pasangAdmin() {
  $('btnAdminOpen').onclick = openAdmin;
  $('btnLogin').onclick = doLogin;
  $('btnLoginBack').onclick = () => show('utama');
  $('pw').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  $('uid').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('pw').focus();
  });
  $('btnAdminBack').onclick = () => show('utama');
  $('btnTutupApp').onclick = konfirmasiTutup;
  // Tombol ✕ jendela / ⌘Q: dialog yang sama (sekali saja walau ditekan berulang)
  api.onMintaTutup(() => konfirmasiTutup());
  $('btnLihatCatatan').onclick = lihatCatatan;
  // About: versi (Leura.app) atau "development" + branch Git (npm start dari folder kode)
  if (api.appInfo)
    api
      .appInfo()
      .then(i => {
        if (!i) return;
        $('infoVersi').textContent = i.demo
          ? 'Leura Demo for phones (photos stay on this phone)'
          : `Version ${i.versi}` +
            (i.terpasang ? ' · installed app' : ` · development (npm start${i.branch ? ', branch ' + i.branch : ''})`);
        $('btnLisensi').style.display = i.lisensi ? '' : 'none';
      })
      .catch(() => {});
  $('btnLisensi').onclick = async () => {
    const r = await api.bukaLisensi();
    if (r && r.error) $('infoVersi').textContent = r.error;
  };
  $('btnSimpanCatatan').onclick = simpanCatatan;
  // Kunci Admin lagi (mis. booth ditinggal tanpa operator): berikutnya harus login
  $('btnKunciAdmin').onclick = () => {
    adminMasuk = false;
    show('utama');
  };
  $('camSel').onchange = async e => {
    store.set('camId', e.target.value);
    await openStream();
    await fillDevices();
  };
  $('micSel').onchange = async e => {
    store.set('micId', e.target.value);
    await openStream();
    await fillDevices();
  };
  $('btnChooseDir').onclick = async () => {
    const r = await api.chooseOutDir();
    if (r.error) $('dirMsg').textContent = r.error;
    else if (!r.canceled) await loadOutDir();
  };
  $('btnResetDir').onclick = async () => {
    await api.resetOutDir();
    await loadOutDir();
  };
  $('btnFolder').onclick = () => api.openFolder();
  $('btnRefresh').onclick = async () => {
    if (!pakaiSony()) await openStream();
    await refreshAdmin();
  };
}

/* ---------- Tutup aplikasi (dari Admin) ---------- */
let tutupDibuka = false; // cegah dua dialog kalau ✕ / tombol ditekan berulang
async function konfirmasiTutup() {
  if (tutupDibuka || $('dlgTutup')) return;
  tutupDibuka = true;
  let c = { salin: 0, proses: 0, foto: 0 };
  try {
    c = await api.cekTutup();
  } catch {
    /* info antrean tidak ada: dialog Tutup aplikasi tetap tampil */
  }
  tutupDibuka = false;
  const catatan = [];
  if (c.salin)
    catatan.push(
      `${c.salin} video(s) still copying from the Sony camera. The originals are safe on the camera card and can be copied again from Session history.`,
    );
  if (c.proses)
    catatan.push(
      `${c.proses} video(s) still processing. Processing continues automatically when the app is opened again.`,
    );
  if (c.foto)
    catatan.push(
      `${c.foto} QR photo(s) not sent yet. Sending continues automatically when the app is opened again (needs internet).`,
    );
  const lapis = document.createElement('div');
  lapis.className = 'dialog-lapis';
  lapis.id = 'dlgTutup';
  lapis.innerHTML = `<div class="dialog-kartu"><h2>Quit the app?</h2><p></p><ul></ul>
    <div class="dialog-aksi"><button class="btn sm tint" id="dlgTutupBatal">Cancel</button><button class="btn sm primary" id="dlgTutupYa">Quit app</button></div></div>`;
  lapis.querySelector('p').textContent = 'The Sony camera will be disconnected cleanly, then the app will close.';
  const ul = lapis.querySelector('ul');
  if (catatan.length)
    catatan.forEach(t => {
      const li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
    });
  else ul.remove();
  document.body.appendChild(lapis);
  lapis.querySelector('#dlgTutupBatal').onclick = () => lapis.remove();
  lapis.onclick = e => {
    if (e.target === lapis) lapis.remove();
  };
  lapis.querySelector('#dlgTutupYa').onclick = async () => {
    lapis.querySelector('.dialog-kartu').innerHTML =
      '<div class="spinner"></div><h2>Closing the app…</h2><p>Disconnecting the camera cleanly. One moment.</p>';
    lapis.onclick = null;
    await api.tutupAplikasi();
  };
}

/* ---------- Catatan aplikasi (log) ---------- */
async function lihatCatatan() {
  let r = { teks: '', file: '' };
  try {
    r = await api.catatanBaca();
  } catch (e) {
    console.warn('App log could not be read: ' + e.message);
  }
  const lapis = document.createElement('div');
  lapis.className = 'dialog-lapis';
  lapis.id = 'dlgCatatan';
  lapis.innerHTML = `<div class="dialog-kartu catatan-kartu"><h2></h2><p></p><pre class="catatan-isi"></pre>
    <div class="dialog-aksi"><button class="btn sm tint" id="dlgCatatanSimpan">Save to send</button><button class="btn sm primary" id="dlgCatatanTutup">Close</button></div></div>`;
  lapis.querySelector('h2').textContent = 'App log' + (r.file ? ' · ' + r.file : '');
  lapis.querySelector('p').textContent = r.teks
    ? '✗ = error, ⚠ = warning. Newest at the bottom.'
    : 'No log entries yet.';
  const pre = lapis.querySelector('pre');
  pre.textContent = r.teks || '';
  if (!r.teks) pre.remove();
  document.body.appendChild(lapis);
  if (r.teks) pre.scrollTop = pre.scrollHeight;
  const tutup = () => lapis.remove();
  lapis.onclick = e => {
    if (e.target === lapis) tutup();
  };
  lapis.querySelector('#dlgCatatanTutup').onclick = tutup;
  lapis.querySelector('#dlgCatatanSimpan').onclick = async () => {
    tutup();
    await simpanCatatan();
  };
}
async function simpanCatatan() {
  const r = await api.catatanSimpan();
  if (r.batal) return;
  if (r.error) setNotice(r.error, 5000);
  else setNotice('Log saved: ' + r.file.split('/').pop() + ' (shown in Finder)', 5000);
}
