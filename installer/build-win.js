// =====================================================================
// build-win.js — builds the PlaygroundBooth installer for Windows (PlaygroundBooth-Setup-<version>-x64.exe)
// Run from the project folder on a Windows computer:   npm run build:win
// (GitHub also builds it automatically: .github/workflows/installer-windows.yml)
//
// Contents of the installed app:
//   - app code (app.asar)
//   - FFmpeg (MP4, quiz text, phone version for the QR)  → resources/app.asar.unpacked
//   - THIRD-PARTY-NOTICES.txt                             → resources/
//   - USB camera helpers, if built on this computer (they need the licensed SDKs, so GitHub builds
//     the installer without them; then only the webcam works):
//       Sony  kamera-sony/bin-win  → resources/kamera-sony/bin   (npm run build:sony)
//       Lumix kamera-lumix/bin     → resources/kamera-lumix/bin  (npm run build:lumix)
// Event data (couples, recordings, settings, QR queue) is NOT inside: it stays in
//   %APPDATA%\playgroundbooth — the same folder "npm start" uses, and uninstalling keeps it.
// Result:  dist/PlaygroundBooth-Setup-<version>-x64.exe  and  dist/win-unpacked/
// =====================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);

const say = s => console.log('\n▶ ' + s);
const ok = s => console.log('  ✓ ' + s);
const warn = s => console.log('  ⚠ ' + s);
const fail = s => {
  console.error('\n✗ ' + s + '\n');
  process.exit(1);
};
const git = args => {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return ''; // not a git checkout (e.g. a zip download): skip the branch checks
  }
};
// npx/npm are .cmd files on Windows, so they need a shell there
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;
const runsVersion = file => spawnSync(file, ['-hide_banner', '-version'], { encoding: 'utf8' }).status === 0;

if (process.platform !== 'win32') fail('The Windows installer can only be built on Windows.');
const version = require(path.join(ROOT, 'package.json')).version;
const branch = git(['branch', '--show-current']) || '-';
console.log(`\nPlaygroundBooth ${version}  ·  branch ${branch}`);
if (git(['status', '--porcelain'])) warn('There are uncommitted changes — the installer uses the folder as it is.');
if (branch !== 'main' && !process.env.CI)
  warn('Not the main branch: this installer is for trying out, not for events.');

say('Checking components');
if (
  !fs.existsSync(path.join(ROOT, 'node_modules', 'electron-builder')) ||
  !fs.existsSync(path.join(ROOT, 'node_modules', 'ffmpeg-static'))
) {
  console.log('  Installing components (npm install)…');
  if (!run('npm', ['install', '--no-audit', '--no-fund'])) fail('npm install failed.');
}
let ff;
try {
  ff = require('ffmpeg-static') || '';
} catch {
  ff = ''; // not installed: reported just below
}
if (!ff || !fs.existsSync(ff)) fail('FFmpeg (ffmpeg-static) not found. Run: npm install');
if (!runsVersion(ff)) fail('FFmpeg is there but does not run on this computer: ' + ff);
ok('FFmpeg');
if (!fs.existsSync(path.join(ROOT, 'THIRD-PARTY-NOTICES.txt'))) fail('THIRD-PARTY-NOTICES.txt is missing.');
const HELPERS = [
  ['Sony', path.join('kamera-sony', 'bin-win', 'sony-helper.exe'), 'npm run build:sony', 'kamera-sony'],
  ['Lumix', path.join('kamera-lumix', 'bin', 'lumix-helper.exe'), 'npm run build:lumix', 'kamera-lumix'],
];
for (const [name, file, build] of HELPERS)
  if (fs.existsSync(path.join(ROOT, file))) ok(`${name} camera helper`);
  else warn(`${name} camera helper not built: the installer works without it (${build} to add it)`);

say('Building the installer (a few minutes)');
fs.rmSync(path.join(ROOT, 'dist'), { recursive: true, force: true });
if (!run('npx', ['electron-builder', '--win', 'nsis', '--x64', '--publish', 'never'])) fail('electron-builder failed.');

say('Checking the result');
const unpacked = path.join(ROOT, 'dist', 'win-unpacked');
if (!fs.existsSync(path.join(unpacked, 'PlaygroundBooth.exe')))
  fail('PlaygroundBooth.exe not found in dist/win-unpacked.');
ok('PlaygroundBooth.exe');
const res = path.join(unpacked, 'resources');
const ffApp = path.join(res, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
if (!fs.existsSync(ffApp) || !runsVersion(ffApp)) fail('FFmpeg inside the installed app does not run.');
ok('FFmpeg inside the app');
if (!fs.existsSync(path.join(res, 'THIRD-PARTY-NOTICES.txt'))) fail('THIRD-PARTY-NOTICES.txt did not go into the app.');
ok('Third-party licences');
for (const [name, file, , folder] of HELPERS) {
  if (!fs.existsSync(path.join(ROOT, file))) continue;
  if (!fs.existsSync(path.join(res, folder, 'bin', path.basename(file))))
    fail(`The ${name} camera helper did not go into the app.`);
  ok(`${name} camera helper inside the app`);
}
const setup = path.join(ROOT, 'dist', `PlaygroundBooth-Setup-${version}-x64.exe`);
if (!fs.existsSync(setup)) fail('Installer not found: ' + setup);
const mb = (fs.statSync(setup).size / 1024 / 1024).toFixed(0);

console.log('\n✓ Done');
console.log(`  Installer : ${path.relative(ROOT, setup)} (${mb} MB)`);
console.log(`  App       : ${path.relative(ROOT, unpacked)}\\PlaygroundBooth.exe\n`);
console.log('Installing:');
console.log('  1. Close PlaygroundBooth (npm start) if it is running.');
console.log(`  2. Open ${path.basename(setup)} and follow the steps.`);
console.log('     If Windows says "Windows protected your PC": click More info → Run anyway');
console.log('     (the installer is not signed yet).');
console.log('  3. Open PlaygroundBooth from the desktop or the Start menu. Allow camera & microphone if Windows asks.');
console.log('  Event data stays in %APPDATA%\\playgroundbooth, also after uninstalling.\n');
