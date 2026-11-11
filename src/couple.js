/* =====================================================================
   couple.js — couple list (in Admin) and the couple page:
   info, quiz questions, photo templates, folder, delete.
   Shared state (couplesData, activeCouple, editingId, delArmed, MAX_Q) still
   lives in state.js as globals until that file becomes a module.
   ===================================================================== */
import { coupleMenu, applyMenu } from './settings.js';
import { listCoupleTemplates, clearTemplateCouple } from './template-editor.js';
import { loadSessions } from './session-history.js';
import { $, MAX_Q, state } from './state.js';
import { flash, show } from './app.js';

export function applyCouples(d) {
  state.couplesData = d;
  state.activeCouple = d.couples.find(c => c.id === d.activeId) || d.couples[0] || null;
  $('couple').textContent = state.activeCouple ? state.activeCouple.name : '';
  $('welcome').textContent = (state.activeCouple && state.activeCouple.welcome) || state.cfg.welcome || '';
  state.cfg.quiz = state.activeCouple ? state.activeCouple.questions.slice() : [];
  if ($('btnToPesan')) applyMenu();
}
// Couple list in Admin: tap a couple to open its page
export async function fillCoupleSel() {
  const box = $('coupleList');
  box.innerHTML = '';
  const [templateCounts, sessions] = await Promise.all([
    api.countTemplates ? api.countTemplates() : {},
    api.getSessions(),
  ]);
  const sorted = [...state.couplesData.couples].sort(
    (a, b) => (b.id === state.couplesData.activeId) - (a.id === state.couplesData.activeId),
  );
  for (const c of sorted) {
    const sessionCount = sessions.filter(x => x.couple === c.name).length,
      templateCount = templateCounts[c.id] || 0;
    const row = document.createElement('button');
    row.className = 'item nav-row cp-row';
    row.dataset.id = c.id;
    row.innerHTML = '<span><b></b><small></small></span><svg class="i chev"><use href="#i-next"/></svg>';
    row.querySelector('b').textContent = c.name;
    const m = coupleMenu(c);
    const menu = [m.pesan && 'Message', m.quiz && `Quiz (${c.questions.length} questions)`, m.photo && 'Photo']
      .filter(Boolean)
      .join(', ');
    row.querySelector('small').textContent =
      `${menu} · ${templateCount} template${templateCount === 1 ? '' : 's'} · ${sessionCount} session${sessionCount === 1 ? '' : 's'}`;
    if (c.id === state.couplesData.activeId) {
      const badge = document.createElement('em');
      badge.className = 'cp-aktif';
      badge.textContent = 'Active';
      row.insertBefore(badge, row.lastElementChild);
    }
    row.onclick = () => openCouplePage(c);
    box.appendChild(row);
  }
}
function disarmDelete() {
  clearTimeout(state.delArmed);
  state.delArmed = null;
  $('delLabel').textContent = 'Delete couple';
}
async function deleteCouple() {
  const target = state.couplesData.couples.find(c => c.id === state.editingId);
  if (!target) return;
  if (!state.delArmed) {
    // press twice to confirm
    $('delLabel').textContent = 'Delete for sure?';
    state.delArmed = setTimeout(disarmDelete, 3000);
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

/* ---------- Couple page ---------- */
// Quiz questions are only required when Quick quiz is on
function markQuizState() {
  const on = $('fMenuQuiz').checked;
  $('qInputs').classList.toggle('mati', !on);
  $('qWajib').textContent = on ? '' : ' · Quick quiz is off, questions are not used';
  const first = document.querySelector('.qIn');
  if (first) first.placeholder = on ? 'First question (required)' : 'Optional';
}
// Menu toggles: refuse to turn off the last option
function onMenuToggle(e) {
  const states = ['fMenuPesan', 'fMenuQuiz', 'fMenuPhoto'].map(id => $(id).checked);
  if (!states.some(Boolean)) {
    e.target.checked = true;
    flash('fMenuMsg', 'At least one option must be on.', true);
  }
  markQuizState();
}
export function buildQInputs() {
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
// Couple page: info, quiz questions, photo templates, folder & delete — all in one place
function openCouplePage(c, keepForm = false) {
  state.editingId = c ? c.id : null;
  disarmDelete();
  $('tambahTitle').textContent = c ? c.name : 'Add couple';
  $('cpTplBaru').style.display = c ? 'none' : '';
  $('cpTplBox').style.display = c ? '' : 'none';
  $('cpLainBox').style.display = c ? '' : 'none';
  if (c) listCoupleTemplates(c);
  else clearTemplateCouple();
  if (keepForm) return; // form content unchanged (after saving a new couple)
  $('fName').value = c ? c.name : '';
  $('fWelcome').value = c ? c.welcome || '' : '';
  const qs = c ? c.questions : [];
  document.querySelectorAll('.qIn').forEach((inp, i) => {
    inp.value = qs[i] || '';
  });
  $('fActive').checked = c ? c.id === state.couplesData.activeId : true;
  const m = coupleMenu(c);
  $('fMenuPesan').checked = m.pesan;
  $('fMenuQuiz').checked = m.quiz;
  $('fMenuPhoto').checked = m.photo;
  markQuizState();
  $('tambahErr').textContent = '';
  $('cpMsg').textContent = '';
  updateQCount();
  show('tambah');
  $('tambah').querySelector('.sheet-body').scrollTop = 0;
  setTimeout(() => $('fName').focus(), 50);
}
async function saveCouple() {
  const data = {
    id: state.editingId || undefined,
    name: $('fName').value,
    welcome: $('fWelcome').value,
    questions: [...document.querySelectorAll('.qIn')].map(i => i.value),
    menu: { pesan: $('fMenuPesan').checked, quiz: $('fMenuQuiz').checked, photo: $('fMenuPhoto').checked },
  };
  const showError = text => {
    $('tambahErr').textContent = text;
    $('tambahErr').scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  if (!Object.values(data.menu).some(Boolean))
    return showError('At least one option must be on: Send a message, Quick quiz or Photo booth.');
  const r = await api.saveCouple(data);
  if (r.error) return showError(r.error);
  let d = r.data;
  if ($('fActive').checked && d.activeId !== r.couple.id) d = (await api.setActiveCouple(r.couple.id)).data;
  applyCouples(d);
  const activeNote = d.activeId === r.couple.id ? ' and set as active' : '';
  if (!state.editingId) {
    // new couple: stay on this page so templates can be created right away
    openCouplePage(r.couple, true);
    flash('tplMsg', `"${r.couple.name}" saved${activeNote}. You can now create their photo templates.`);
    fillCoupleSel();
    return;
  }
  show('admin');
  await fillCoupleSel();
  await loadSessions();
  flash('coupleMsg', `"${r.couple.name}" saved${activeNote}.`);
}

// Wire up this feature's buttons (called once from start.js)
export function setupCouples() {
  $('btnAddCouple').onclick = () => openCouplePage(null);
  ['fMenuPesan', 'fMenuQuiz', 'fMenuPhoto'].forEach(id => {
    $(id).onchange = onMenuToggle;
  });
  $('btnDelCouple').onclick = deleteCouple;
  $('btnCoupleFolder').onclick = async () => {
    const r = await api.openCoupleFolder(state.editingId);
    if (r) flash('cpMsg', r, true);
  };
  $('btnTambahBatal').onclick = () => {
    disarmDelete();
    show('admin');
    fillCoupleSel();
  };
  $('btnTambahSimpan').onclick = saveCouple;
}
