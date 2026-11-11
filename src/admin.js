/* =====================================================================
   admin.js — Admin login, camera/mic, storage folder, quit dialog, app log
   (the session list is in riwayat.js)
   ===================================================================== */

// Logging in to Admin is needed once while the app is open. Kept in memory only (not on disk),
// so after the app is closed and opened again, Admin must log in again.
let adminUnlocked = false;

async function openAdminPanel() {
  $('adminLogin').style.display = 'none';
  $('adminPanel').style.display = 'flex';
  show('admin');
  await refreshAdmin();
}
function openAdmin() {
  if (adminUnlocked) return openAdminPanel();
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
    adminUnlocked = true;
    $('pw').value = '';
    await openAdminPanel();
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

// Wire up this feature's buttons (called once from start.js)
export function setupAdmin() {
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
  $('btnTutupApp').onclick = confirmQuit;
  // Window ✕ button / ⌘Q: the same dialog (only once even if pressed repeatedly)
  api.onMintaTutup(() => confirmQuit());
  $('btnLihatCatatan').onclick = showAppLog;
  // About: version (Leura.app) or "development" + Git branch (npm start from the code folder)
  if (api.appInfo)
    api
      .appInfo()
      .then(info => {
        if (!info) return;
        $('infoVersi').textContent = info.demo
          ? 'Leura Demo for phones (photos stay on this phone)'
          : `Version ${info.versi}` +
            (info.terpasang
              ? ' · installed app'
              : ` · development (npm start${info.branch ? ', branch ' + info.branch : ''})`);
        $('btnLisensi').style.display = info.lisensi ? '' : 'none';
      })
      .catch(e => console.warn('App info could not be read: ' + e.message));
  $('btnLisensi').onclick = async () => {
    const r = await api.bukaLisensi();
    if (r && r.error) $('infoVersi').textContent = r.error;
  };
  $('btnSimpanCatatan').onclick = saveAppLog;
  // Lock Admin again (e.g. booth left without an operator): next time a login is needed
  $('btnKunciAdmin').onclick = () => {
    adminUnlocked = false;
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

/* ---------- Quit the app (from Admin) ---------- */
let quitDialogOpening = false; // prevents two dialogs when ✕ / the button is pressed repeatedly
async function confirmQuit() {
  if (quitDialogOpening || $('dlgTutup')) return;
  quitDialogOpening = true;
  let counts = { salin: 0, proses: 0, foto: 0 };
  try {
    counts = await api.cekTutup();
  } catch {
    /* no queue info: the Quit dialog still shows */
  }
  quitDialogOpening = false;
  const notes = [];
  if (counts.salin)
    notes.push(
      `${counts.salin} video(s) still copying from the Sony camera. The originals are safe on the camera card and can be copied again from Session history.`,
    );
  if (counts.proses)
    notes.push(
      `${counts.proses} video(s) still processing. Processing continues automatically when the app is opened again.`,
    );
  if (counts.foto)
    notes.push(
      `${counts.foto} QR photo(s) not sent yet. Sending continues automatically when the app is opened again (needs internet).`,
    );
  const overlay = document.createElement('div');
  overlay.className = 'dialog-lapis';
  overlay.id = 'dlgTutup';
  overlay.innerHTML = `<div class="dialog-kartu"><h2>Quit the app?</h2><p></p><ul></ul>
    <div class="dialog-aksi"><button class="btn sm tint" id="dlgTutupBatal">Cancel</button><button class="btn sm primary" id="dlgTutupYa">Quit app</button></div></div>`;
  overlay.querySelector('p').textContent = 'The Sony camera will be disconnected cleanly, then the app will close.';
  const ul = overlay.querySelector('ul');
  if (notes.length)
    notes.forEach(note => {
      const li = document.createElement('li');
      li.textContent = note;
      ul.appendChild(li);
    });
  else ul.remove();
  document.body.appendChild(overlay);
  overlay.querySelector('#dlgTutupBatal').onclick = () => overlay.remove();
  overlay.onclick = e => {
    if (e.target === overlay) overlay.remove();
  };
  overlay.querySelector('#dlgTutupYa').onclick = async () => {
    overlay.querySelector('.dialog-kartu').innerHTML =
      '<div class="spinner"></div><h2>Closing the app…</h2><p>Disconnecting the camera cleanly. One moment.</p>';
    overlay.onclick = null;
    await api.tutupAplikasi();
  };
}

/* ---------- App log ---------- */
async function showAppLog() {
  let r = { teks: '', file: '' };
  try {
    r = await api.catatanBaca();
  } catch (e) {
    console.warn('App log could not be read: ' + e.message);
  }
  const overlay = document.createElement('div');
  overlay.className = 'dialog-lapis';
  overlay.id = 'dlgCatatan';
  overlay.innerHTML = `<div class="dialog-kartu catatan-kartu"><h2></h2><p></p><pre class="catatan-isi"></pre>
    <div class="dialog-aksi"><button class="btn sm tint" id="dlgCatatanSimpan">Save to send</button><button class="btn sm primary" id="dlgCatatanTutup">Close</button></div></div>`;
  overlay.querySelector('h2').textContent = 'App log' + (r.file ? ' · ' + r.file : '');
  overlay.querySelector('p').textContent = r.teks
    ? '✗ = error, ⚠ = warning. Newest at the bottom.'
    : 'No log entries yet.';
  const pre = overlay.querySelector('pre');
  pre.textContent = r.teks || '';
  if (!r.teks) pre.remove();
  document.body.appendChild(overlay);
  if (r.teks) pre.scrollTop = pre.scrollHeight;
  const close = () => overlay.remove();
  overlay.onclick = e => {
    if (e.target === overlay) close();
  };
  overlay.querySelector('#dlgCatatanTutup').onclick = close;
  overlay.querySelector('#dlgCatatanSimpan').onclick = async () => {
    close();
    await saveAppLog();
  };
}
async function saveAppLog() {
  const r = await api.catatanSimpan();
  if (r.batal) return;
  if (r.error) setNotice(r.error, 5000);
  else setNotice('Log saved: ' + r.file.split('/').pop() + ' (shown in Finder)', 5000);
}
