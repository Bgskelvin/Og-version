/* =====================================================================
   booth-settings.js — Videobooth settings & Photo booth settings pages
   (opened from Admin). Every choice is saved and applied right away.
   Values & limits are enforced in main/pengaturan.js.
   ===================================================================== */
import { fillDownloadQrSettings } from './download-qr.js';
import { SECONDS, secLabel, fillSelect, normalizeConfig, applySettings } from './settings.js';
import { $, state } from './state.js';
import { flash, show } from './app.js';

const OPTIONS = {
  messageCountdown: [
    [0, 'Record right away'],
    [3, '3 seconds'],
    [5, '5 seconds'],
    [10, '10 seconds'],
  ],
  messageMaxSeconds: [
    [0, 'No limit'],
    [30, '30 seconds'],
    [60, '1 minute'],
    [120, '2 minutes'],
    [180, '3 minutes'],
    [300, '5 minutes'],
  ],
  photoCountdown: [
    [3, '3 seconds'],
    [5, '5 seconds'],
    [7, '7 seconds'],
    [10, '10 seconds'],
  ],
  photoPreview: [
    [0, 'No preview'],
    [1, '1 second'],
    [2, '2 seconds'],
    [3, '3 seconds'],
  ],
};
const labelFor = key => v => (OPTIONS[key].find(([n]) => n === v) || [v, secLabel(v)])[1];

function fillBoothSettings(s) {
  // Videobooth
  fillSelect(
    $('setMessageCountdown'),
    OPTIONS.messageCountdown.map(p => p[0]),
    s.messageCountdown,
    labelFor('messageCountdown'),
  );
  fillSelect(
    $('setMessageMax'),
    OPTIONS.messageMaxSeconds.map(p => p[0]),
    s.messageMaxSeconds,
    labelFor('messageMaxSeconds'),
  );
  fillSelect($('setSeconds'), SECONDS, s.quizSeconds, secLabel);
  fillSelect($('setRounds'), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], s.quizRounds, v => `${v} question${v === 1 ? '' : 's'}`);
  // Photobooth
  fillSelect(
    $('setPhotoCountdown'),
    OPTIONS.photoCountdown.map(p => p[0]),
    s.photoCountdown,
    labelFor('photoCountdown'),
  );
  fillSelect(
    $('setPhotoPreview'),
    OPTIONS.photoPreview.map(p => p[0]),
    s.photoPreview,
    labelFor('photoPreview'),
  );
  $('setPhotoFlash').checked = s.photoFlash;
}
async function openBoothSettings(screen) {
  show(screen);
  const s = await api.getSettings();
  normalizeConfig(s);
  fillBoothSettings({ ...s, ...state.cfg });
  if (screen === 'setphoto') fillDownloadQrSettings();
}
async function saveBoothSetting(patch, msgId, msg) {
  const s = await api.saveSettings(patch);
  applySettings(s);
  fillBoothSettings({ ...s, ...state.cfg });
  if (s.error) flash(msgId, s.error, true);
  else flash(msgId, msg);
}

// Wire up this feature's buttons (called once from start.js)
export function setupBoothSettings() {
  $('btnSetVideo').onclick = () => openBoothSettings('setvideo');
  $('btnSetPhoto').onclick = () => openBoothSettings('setphoto');
  $('btnSetVideoBack').onclick = () => show('admin');
  $('btnSetPhotoBack').onclick = () => show('admin');

  const toggle = (id, key, label) => {
    $(id).onchange = e => {
      const msgId = key === 'enablePhoto' || key === 'photoFlash' ? 'setPhotoMsg' : 'setVideoMsg';
      saveBoothSetting({ [key]: e.target.checked }, msgId, `${label} ${e.target.checked ? 'on' : 'off'}.`);
    };
  };
  toggle('setPhotoFlash', 'photoFlash', 'Screen flash');

  const choice = (id, key, msgId, describe) => {
    $(id).onchange = e => {
      const v = Number(e.target.value);
      saveBoothSetting({ [key]: v }, msgId, describe(v));
    };
  };
  choice(
    'setMessageCountdown',
    'messageCountdown',
    'setVideoMsg',
    v => `Message countdown: ${labelFor('messageCountdown')(v).toLowerCase()}.`,
  );
  choice(
    'setMessageMax',
    'messageMaxSeconds',
    'setVideoMsg',
    v => `Message time limit: ${labelFor('messageMaxSeconds')(v).toLowerCase()}.`,
  );
  choice('setSeconds', 'quizSeconds', 'setVideoMsg', v => `Answer time: ${secLabel(v)}.`);
  choice('setRounds', 'quizRounds', 'setVideoMsg', v => `Questions per session: ${v}.`);
  choice(
    'setPhotoCountdown',
    'photoCountdown',
    'setPhotoMsg',
    v => `Photo countdown: ${labelFor('photoCountdown')(v)}.`,
  );
  choice(
    'setPhotoPreview',
    'photoPreview',
    'setPhotoMsg',
    v => `Preview: ${labelFor('photoPreview')(v).toLowerCase()}.`,
  );
}
