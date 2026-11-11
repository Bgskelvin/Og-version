/* =====================================================================
   couple.js — daftar couple (di Admin) dan halaman couple:
   info, pertanyaan quiz, template foto, folder, hapus
   ===================================================================== */

function applyCouples(d) {
  couplesData = d;
  activeCouple = d.couples.find(c => c.id === d.activeId) || d.couples[0] || null;
  $('couple').textContent = activeCouple ? activeCouple.name : '';
  $('welcome').textContent = (activeCouple && activeCouple.welcome) || cfg.welcome || '';
  cfg.quiz = activeCouple ? activeCouple.questions.slice() : [];
  if (typeof terapkanMenu === 'function' && $('btnToPesan')) terapkanMenu();
}
// Daftar couple di Admin: ketuk satu couple untuk membuka halaman couple itu
async function fillCoupleSel() {
  const box = $('coupleList');
  box.innerHTML = '';
  const [jumlahTpl, sesi] = await Promise.all([api.countTemplates ? api.countTemplates() : {}, api.getSessions()]);
  const urut = [...couplesData.couples].sort(
    (a, b) => (b.id === couplesData.activeId) - (a.id === couplesData.activeId),
  );
  for (const c of urut) {
    const nSesi = sesi.filter(x => x.couple === c.name).length,
      nTpl = jumlahTpl[c.id] || 0;
    const row = document.createElement('button');
    row.className = 'item nav-row cp-row';
    row.dataset.id = c.id;
    row.innerHTML = '<span><b></b><small></small></span><svg class="i chev"><use href="#i-next"/></svg>';
    row.querySelector('b').textContent = c.name;
    const m = menuCouple(c);
    const menu = [m.pesan && 'Message', m.quiz && `Quiz (${c.questions.length} questions)`, m.photo && 'Photo']
      .filter(Boolean)
      .join(', ');
    row.querySelector('small').textContent =
      `${menu} · ${nTpl} template${nTpl === 1 ? '' : 's'} · ${nSesi} session${nSesi === 1 ? '' : 's'}`;
    if (c.id === couplesData.activeId) {
      const t = document.createElement('em');
      t.className = 'cp-aktif';
      t.textContent = 'Active';
      row.insertBefore(t, row.lastElementChild);
    }
    row.onclick = () => openTambah(c);
    box.appendChild(row);
  }
}
function flash(id, text, isErr) {
  const el = $(id);
  el.className = 'note ' + (isErr ? 'err' : 'ok');
  el.textContent = text;
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.textContent = '';
  }, 4000);
}
function disarmDelete() {
  clearTimeout(delArmed);
  delArmed = null;
  $('delLabel').textContent = 'Delete couple';
}
async function deleteCouple() {
  const target = couplesData.couples.find(c => c.id === editingId);
  if (!target) return;
  if (!delArmed) {
    // tekan dua kali untuk konfirmasi
    $('delLabel').textContent = 'Delete for sure?';
    delArmed = setTimeout(disarmDelete, 3000);
    return;
  }
  disarmDelete();
  const r = await api.deleteCouple(target.id);
  if (r.error) return flash('cpMsg', r.error, true);
  applyCouples(r.data);
  show('admin');
  await fillCoupleSel();
  await loadSessions();
  const tpl = r.templateDihapus ? ` and ${r.templateDihapus} template(s)` : '';
  flash('coupleMsg', `"${target.name}"${tpl} deleted. Their recordings and photos are still saved.`);
}

/* ---------- Halaman couple ---------- */
// Pertanyaan quiz hanya wajib kalau Quick quiz aktif
function tandaiQuiz() {
  const on = $('fMenuQuiz').checked;
  $('qInputs').classList.toggle('mati', !on);
  $('qWajib').textContent = on ? '' : ' · Quick quiz is off, questions are not used';
  const pertama = document.querySelector('.qIn');
  if (pertama) pertama.placeholder = on ? 'First question (required)' : 'Optional';
}
// Saklar menu: menolak mematikan menu terakhir
function saklarMenu(e) {
  const semua = ['fMenuPesan', 'fMenuQuiz', 'fMenuPhoto'].map(id => $(id).checked);
  if (!semua.some(Boolean)) {
    e.target.checked = true;
    flash('fMenuMsg', 'At least one option must be on.', true);
  }
  tandaiQuiz();
}
function buildQInputs() {
  const box = $('qInputs');
  box.innerHTML = '';
  for (let i = 0; i < MAX_Q; i++) {
    const row = document.createElement('div');
    row.className = 'item split';
    const n = document.createElement('span');
    n.className = 'qnum';
    n.textContent = i + 1;
    const inp = document.createElement('input');
    inp.className = 'field qIn';
    inp.maxLength = 200;
    inp.autocomplete = 'off';
    inp.placeholder = i === 0 ? 'First question (required)' : 'Optional';
    inp.addEventListener('input', updateQCount);
    row.append(n, inp);
    box.appendChild(row);
  }
}
function updateQCount() {
  const n = [...document.querySelectorAll('.qIn')].filter(i => i.value.trim()).length;
  $('qCount').textContent = `(${n}/${MAX_Q} filled)`;
}
// Halaman couple: info, pertanyaan quiz, template foto, folder & hapus — semua di satu tempat
function openTambah(c, tetapDiForm = false) {
  editingId = c ? c.id : null;
  disarmDelete();
  $('tambahTitle').textContent = c ? c.name : 'Add couple';
  $('cpTplBaru').style.display = c ? 'none' : '';
  $('cpTplBox').style.display = c ? '' : 'none';
  $('cpLainBox').style.display = c ? '' : 'none';
  if (c) listCoupleTemplates(c);
  else clearTemplateCouple();
  if (tetapDiForm) return; // isi form tidak diubah (setelah simpan couple baru)
  $('fName').value = c ? c.name : '';
  $('fWelcome').value = c ? c.welcome || '' : '';
  const qs = c ? c.questions : [];
  document.querySelectorAll('.qIn').forEach((inp, i) => {
    inp.value = qs[i] || '';
  });
  $('fActive').checked = c ? c.id === couplesData.activeId : true;
  const m = menuCouple(c);
  $('fMenuPesan').checked = m.pesan;
  $('fMenuQuiz').checked = m.quiz;
  $('fMenuPhoto').checked = m.photo;
  tandaiQuiz();
  $('tambahErr').textContent = '';
  $('cpMsg').textContent = '';
  updateQCount();
  show('tambah');
  $('tambah').querySelector('.sheet-body').scrollTop = 0;
  setTimeout(() => $('fName').focus(), 50);
}
async function saveTambah() {
  const data = {
    id: editingId || undefined,
    name: $('fName').value,
    welcome: $('fWelcome').value,
    questions: [...document.querySelectorAll('.qIn')].map(i => i.value),
    menu: { pesan: $('fMenuPesan').checked, quiz: $('fMenuQuiz').checked, photo: $('fMenuPhoto').checked },
  };
  const gagal = teks => {
    $('tambahErr').textContent = teks;
    $('tambahErr').scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  if (!Object.values(data.menu).some(Boolean))
    return gagal('At least one option must be on: Send a message, Quick quiz or Photo booth.');
  const r = await api.saveCouple(data);
  if (r.error) return gagal(r.error);
  let d = r.data;
  if ($('fActive').checked && d.activeId !== r.couple.id) d = (await api.setActiveCouple(r.couple.id)).data;
  applyCouples(d);
  const aktif = d.activeId === r.couple.id ? ' and set as active' : '';
  if (!editingId) {
    // couple baru: tetap di halaman ini supaya bisa langsung membuat template
    openTambah(r.couple, true);
    flash('tplMsg', `"${r.couple.name}" saved${aktif}. You can now create their photo templates.`);
    fillCoupleSel();
    return;
  }
  show('admin');
  await fillCoupleSel();
  await loadSessions();
  flash('coupleMsg', `"${r.couple.name}" saved${aktif}.`);
}

// Pasang tombol-tombol fitur ini (dipanggil sekali dari start.js)
function pasangCouple() {
  $('btnAddCouple').onclick = () => openTambah(null);
  ['fMenuPesan', 'fMenuQuiz', 'fMenuPhoto'].forEach(id => {
    $(id).onchange = saklarMenu;
  });
  $('btnDelCouple').onclick = deleteCouple;
  $('btnCoupleFolder').onclick = async () => {
    const r = await api.openCoupleFolder(editingId);
    if (r) flash('cpMsg', r, true);
  };
  $('btnTambahBatal').onclick = () => {
    disarmDelete();
    show('admin');
    fillCoupleSel();
  };
  $('btnTambahSimpan').onclick = saveTambah;
}
