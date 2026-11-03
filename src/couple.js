/* =====================================================================
   couple.js — couple aktif (di Admin) dan halaman Tambah/Edit couple
   ===================================================================== */

function applyCouples(d) {
  couplesData = d;
  activeCouple = d.couples.find(c => c.id === d.activeId) || d.couples[0] || null;
  $('couple').textContent = activeCouple ? activeCouple.name : '';
  $('welcome').textContent = (activeCouple && activeCouple.welcome) || cfg.welcome || '';
  cfg.quiz = activeCouple ? activeCouple.questions.slice() : [];
}
function fillCoupleSel() {
  const sel = $('coupleSel'); sel.innerHTML = '';
  couplesData.couples.forEach(c => {
    const o = document.createElement('option');
    o.value = c.id; o.textContent = c.name;
    if (c.id === couplesData.activeId) o.selected = true;
    sel.appendChild(o);
  });
  const n = activeCouple ? activeCouple.questions.length : 0;
  $('coupleInfo').textContent = activeCouple
    ? `${n} pertanyaan · ${couplesData.couples.length} couple tersimpan`
    : 'Belum ada couple.';
  disarmDelete();
}
function flash(id, text, isErr) {
  const el = $(id);
  el.className = 'note ' + (isErr ? 'err' : 'ok');
  el.textContent = text;
  clearTimeout(el._t); el._t = setTimeout(() => { el.textContent = ''; }, 4000);
}
async function changeActive(id) {
  const r = await api.setActiveCouple(id);
  if (r.error) return flash('coupleMsg', r.error, true);
  applyCouples(r.data); fillCoupleSel(); await loadSessions();
  flash('coupleMsg', `Couple aktif sekarang: ${activeCouple.name}`);
}
function disarmDelete() {
  clearTimeout(delArmed); delArmed = null;
  $('delLabel').textContent = 'Hapus';
}
async function deleteCouple() {
  const target = couplesData.couples.find(c => c.id === $('coupleSel').value);
  if (!target) return;
  if (!delArmed) {  // tekan dua kali untuk konfirmasi
    $('delLabel').textContent = 'Yakin hapus?';
    delArmed = setTimeout(disarmDelete, 3000);
    return;
  }
  disarmDelete();
  const r = await api.deleteCouple(target.id);
  if (r.error) return flash('coupleMsg', r.error, true);
  applyCouples(r.data); fillCoupleSel(); await loadSessions();
  flash('coupleMsg', `"${target.name}" dihapus. Rekamannya tetap tersimpan.`);
}

/* ---------- Halaman Tambah ---------- */
function buildQInputs() {
  const box = $('qInputs'); box.innerHTML = '';
  for (let i = 0; i < MAX_Q; i++) {
    const row = document.createElement('div'); row.className = 'item split';
    const n = document.createElement('span'); n.className = 'qnum'; n.textContent = i + 1;
    const inp = document.createElement('input');
    inp.className = 'field qIn'; inp.maxLength = 200; inp.autocomplete = 'off';
    inp.placeholder = i === 0 ? 'Pertanyaan pertama (wajib)' : 'Opsional';
    inp.addEventListener('input', updateQCount);
    row.appendChild(n); row.appendChild(inp); box.appendChild(row);
  }
}
function updateQCount() {
  const n = [...document.querySelectorAll('.qIn')].filter(i => i.value.trim()).length;
  $('qCount').textContent = `(${n}/${MAX_Q} terisi)`;
}
function openTambah(c) {
  editingId = c ? c.id : null;
  $('tambahTitle').textContent = c ? 'Edit couple' : 'Tambah couple';
  $('fName').value = c ? c.name : '';
  $('fWelcome').value = c ? (c.welcome || '') : '';
  const qs = c ? c.questions : [];
  document.querySelectorAll('.qIn').forEach((inp, i) => { inp.value = qs[i] || ''; });
  $('fActive').checked = c ? c.id === couplesData.activeId : true;
  $('tambahErr').textContent = '';
  updateQCount();
  show('tambah');
  setTimeout(() => $('fName').focus(), 50);
}
async function saveTambah() {
  const data = {
    id: editingId || undefined,
    name: $('fName').value,
    welcome: $('fWelcome').value,
    questions: [...document.querySelectorAll('.qIn')].map(i => i.value)
  };
  const r = await api.saveCouple(data);
  if (r.error) { $('tambahErr').textContent = r.error; return; }
  let d = r.data;
  if ($('fActive').checked && d.activeId !== r.couple.id) d = (await api.setActiveCouple(r.couple.id)).data;
  applyCouples(d);
  show('admin');
  fillCoupleSel(); await loadSessions();
  flash('coupleMsg', `"${r.couple.name}" tersimpan${d.activeId === r.couple.id ? ' dan aktif' : ''}.`);
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari mulai.js)
function pasangCouple() {
  $('coupleSel').onchange = e => changeActive(e.target.value);
  $('btnAddCouple').onclick = () => openTambah(null);
  $('btnEditCouple').onclick = () => openTambah(couplesData.couples.find(c => c.id === $('coupleSel').value));
  $('btnDelCouple').onclick = deleteCouple;
  $('btnCoupleFolder').onclick = async () => {
    const r = await api.openCoupleFolder();
    if (r) flash('coupleMsg', r, true);
  };
  $('btnTambahBatal').onclick = () => show('admin');
  $('btnTambahSimpan').onclick = saveTambah;
}
