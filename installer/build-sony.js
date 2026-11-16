// =====================================================================
// build-sony.js — builds the Sony camera helper.   npm run build:sony
// On a Mac it runs kamera-sony/build.sh (unchanged); on Windows it builds the Windows helper below.
//
// Needs:
//   - Build Tools for Visual Studio 2022 with "Desktop development with C++"
//   - the Windows Sony Camera Remote SDK (SimpleCli.zip) in one of the folders in SDK_DIRS
//     (licensed, not in Git)
// Result:
//   kamera-sony/bin-win/sony-helper.exe + Sony SDK libraries next to it
//   (Cr_Core.dll, monitor_protocol*.dll, CrAdapter/*.dll) + licenses/
// The Mac build stays in kamera-sony/bin, so both can live in one code folder.
// =====================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { findVcvars, runWithCompiler, crtDlls, INSTALL_HELP } = require('./msvc');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'kamera-sony');
const SDK_DIRS = ['sony windows', 'sony-windows', path.join('sony', 'windows')].map(d => path.join(ROOT, 'sdk', d));
const WORK = path.join(DIR, '.sdk-win');
const BIN = path.join(DIR, 'bin-win');

const say = s => console.log('\n▶ ' + s);
const warn = s => console.log('  ⚠ ' + s);
const fail = s => {
  console.error('\n✗ ' + s + '\n');
  process.exit(1);
};
// Windows 10/11 come with tar.exe, which also opens .zip files
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const unzip = (zip, dest, members) =>
  spawnSync(TAR, ['-xf', zip, '-C', dest, ...members], { stdio: 'inherit' }).status === 0;

if (process.platform === 'darwin')
  process.exit(spawnSync('bash', [path.join(DIR, 'build.sh')], { stdio: 'inherit' }).status ?? 1);
if (process.platform !== 'win32') fail('The Sony camera helper is built on a Mac or on Windows.');
const sdkDir = SDK_DIRS.find(d => fs.existsSync(path.join(d, 'SimpleCli.zip')));
if (!sdkDir) fail('Windows Sony SDK not found: put SimpleCli.zip (Windows) in sdk/sony windows/');
const zip = path.join(sdkDir, 'SimpleCli.zip');
const vcvars = findVcvars();
if (!vcvars) fail(INSTALL_HELP);

say('Preparing the Sony SDK (' + path.relative(ROOT, zip) + ')');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
if (!unzip(zip, WORK, ['app/CRSDK', 'external/crsdk'])) fail('Could not unpack ' + zip);
const crsdk = path.join(WORK, 'external', 'crsdk');
if (!fs.existsSync(path.join(crsdk, 'Cr_Core.lib')))
  fail('This SimpleCli.zip has no Cr_Core.lib: it is probably the Mac SDK, not the Windows one.');

say('Compiling sony-helper.exe');
fs.rmSync(BIN, { recursive: true, force: true });
fs.mkdirSync(BIN, { recursive: true });
const obj = path.join(WORK, 'obj');
fs.mkdirSync(obj, { recursive: true });
// UNICODE: on Windows the Sony SDK uses wide text (CrChar = wchar_t), like Sony's own sample
const ok = runWithCompiler(
  vcvars,
  [
    'cl /nologo /EHsc /O2 /MT /std:c++17 /utf-8 /W3 /wd4828 /D_CRT_SECURE_NO_WARNINGS /DUNICODE /D_UNICODE /DNOMINMAX',
    `/I "${path.join(WORK, 'app', 'CRSDK')}"`,
    `"${path.join(DIR, 'sony-helper.cpp')}"`,
    `/Fo"${obj}\\\\"`,
    `/Fe"${path.join(BIN, 'sony-helper.exe')}"`,
    `/link "${path.join(crsdk, 'Cr_Core.lib')}"`,
  ].join(' '),
  DIR,
);
if (!ok) fail('Compiling failed (see the messages above).');

say('Copying the Sony SDK libraries');
// Same layout as Sony's Windows sample: Cr_Core.dll & monitor_protocol*.dll next to the program,
// the connection libraries in CrAdapter\
for (const f of fs.readdirSync(crsdk)) if (f.endsWith('.dll')) fs.copyFileSync(path.join(crsdk, f), path.join(BIN, f));
fs.cpSync(path.join(crsdk, 'CrAdapter'), path.join(BIN, 'CrAdapter'), {
  recursive: true,
  filter: f => fs.statSync(f).isDirectory() || f.endsWith('.dll'),
});
// The C++ runtime the Sony libraries need (Sony asks for Visual C++ Redistributable 2015-2022)
const crt = crtDlls(vcvars);
for (const f of crt) fs.copyFileSync(f, path.join(BIN, path.basename(f)));
if (!crt.length) warn('C++ runtime not found: the booth computer needs Visual C++ Redistributable (x64)');
// Licenses of the open source libraries inside the SDK (libusb LGPL, libssh2, OpenSSL) — go into the app
const oss = path.join(sdkDir, 'SourceCodeOfOpenSourceSoftware');
fs.mkdirSync(path.join(BIN, 'licenses'), { recursive: true });
for (const [z, member, name] of [
  ['libusb.zip', 'libusb/COPYING', 'libusb-COPYING.txt'],
  ['libssh2.zip', 'libssh2/COPYING', 'libssh2-COPYING.txt'],
  ['openssl.zip', 'openssl/LICENSE.txt', 'openssl-LICENSE.txt'],
]) {
  const r = spawnSync(TAR, ['-xOf', path.join(oss, z), member], { encoding: 'buffer' });
  if (r.status === 0 && r.stdout.length) fs.writeFileSync(path.join(BIN, 'licenses', name), r.stdout);
  else warn(`License ${name} not found in the SDK (${path.relative(ROOT, oss)})`);
}
fs.rmSync(WORK, { recursive: true, force: true });

say('Checking the result');
const r = spawnSync(path.join(BIN, 'sony-helper.exe'), [], { cwd: BIN, input: '', encoding: 'utf8', timeout: 15000 });
if (!/"siap"/.test(r.stdout || '')) fail('sony-helper.exe was built but does not run: ' + (r.stderr || r.error || ''));

console.log('\n✓ Done: kamera-sony/bin-win/sony-helper.exe');
console.log('  The first time on this computer: install the Sony USB driver (see kamera-sony/README.md).\n');
