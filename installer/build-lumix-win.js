// =====================================================================
// build-lumix-win.js — builds the Lumix camera helper for Windows.
// Run from the project folder:   npm run build:lumix
//
// Needs:
//   - Build Tools for Visual Studio 2022 with "Desktop development with C++"
//   - sdk/lumix/Library (Lumix Tether SDK: headers, Lmxptpif.lib, Lmxptpif.dll;
//     licensed, not in Git)
// Result:
//   kamera-lumix/bin/lumix-helper.exe + Lmxptpif.dll next to it
// With --fake (for the automated tests, no camera needed):
//   kamera-lumix/uji/bin/lumix-helper-palsu.exe = the same helper with the fake SDK (uji/sdk-palsu.cpp)
// =====================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { findVcvars, runWithCompiler, crtDlls, INSTALL_HELP } = require('./msvc');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'kamera-lumix');
const SDK = path.join(ROOT, 'sdk', 'lumix', 'Library');
const FAKE = process.argv.includes('--fake');
const BIN = FAKE ? path.join(DIR, 'uji', 'bin') : path.join(DIR, 'bin');
const EXE = path.join(BIN, FAKE ? 'lumix-helper-palsu.exe' : 'lumix-helper.exe');
const OBJ = path.join(DIR, '.build');

const say = s => console.log('\n▶ ' + s);
const fail = s => {
  console.error('\n✗ ' + s + '\n');
  process.exit(1);
};

if (process.platform !== 'win32')
  fail('The Lumix camera helper can only be built on Windows (the Lumix SDK is Windows only).');
for (const f of ['LMX_func_api.h', 'Lmxptpif.lib', 'Lmxptpif.dll'])
  if (!fs.existsSync(path.join(SDK, f))) fail(`Lumix SDK not found: sdk/lumix/Library/${f} is missing.`);
const vcvars = findVcvars();
if (!vcvars) fail(INSTALL_HELP);

say('Compiling ' + path.basename(EXE));
try {
  fs.rmSync(BIN, { recursive: true, force: true });
} catch (e) {
  fail(`Could not replace ${path.relative(ROOT, BIN)} (${e.code}): close PlaygroundBooth (npm start) and try again.`);
}
fs.rmSync(OBJ, { recursive: true, force: true });
fs.mkdirSync(BIN, { recursive: true });
fs.mkdirSync(OBJ, { recursive: true });
const ok = runWithCompiler(
  vcvars,
  [
    'cl /nologo /EHsc /O2 /MT /std:c++17 /utf-8 /W3 /wd4828 /D_CRT_SECURE_NO_WARNINGS',
    `/I "${SDK}"`,
    `"${path.join(DIR, 'lumix-helper.cpp')}"`,
    FAKE ? `"${path.join(DIR, 'uji', 'sdk-palsu.cpp')}"` : '',
    `/Fo"${OBJ}\\\\"`,
    `/Fe"${EXE}"`,
    FAKE ? '' : `/link "${path.join(SDK, 'Lmxptpif.lib')}"`,
  ].join(' '),
  DIR,
);
fs.rmSync(OBJ, { recursive: true, force: true });
if (!ok) fail('Compiling failed (see the messages above).');

if (!FAKE) {
  say('Copying the Lumix SDK library');
  fs.copyFileSync(path.join(SDK, 'Lmxptpif.dll'), path.join(BIN, 'Lmxptpif.dll'));
  const crt = crtDlls(vcvars);
  for (const f of crt) fs.copyFileSync(f, path.join(BIN, path.basename(f)));
  console.log(
    crt.length
      ? '  ✓ C++ runtime copied (' + crt.length + ' files)'
      : '  ⚠ C++ runtime not found: the booth computer needs Visual C++ Redistributable',
  );
}

say('Checking the result');
const r = spawnSync(EXE, [], { cwd: BIN, input: '', encoding: 'utf8', timeout: 10000 });
if (!/"siap"/.test(r.stdout || ''))
  fail(`${path.basename(EXE)} was built but does not run: ` + (r.stderr || r.error || ''));
if (FAKE) {
  console.log('\n✓ Done: kamera-lumix/uji/bin/lumix-helper-palsu.exe (used by npm run test:utama)\n');
  process.exit(0);
}

console.log('\n✓ Done: kamera-lumix/bin/lumix-helper.exe');
console.log('  In the app: Admin → Camera → Source: Panasonic Lumix (USB)\n');
