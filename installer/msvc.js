// =====================================================================
// msvc.js — finds the Microsoft C++ compiler (Visual Studio / Build Tools) on Windows
// and runs a command with it. Used by build-lumix-win.js and build-sony-win.js.
// The camera SDKs (Sony Cr_Core.lib, Lumix Lmxptpif.lib) are made for this compiler.
// =====================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const VSWHERE = path.join(
  process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
  'Microsoft Visual Studio',
  'Installer',
  'vswhere.exe',
);
const INSTALL_HELP =
  'The C++ compiler is not installed. Install "Build Tools for Visual Studio 2022" ' +
  '(https://visualstudio.microsoft.com/downloads/ → Tools for Visual Studio) with ' +
  '"Desktop development with C++", then run this again.';

// Path of vcvars64.bat (sets up the 64-bit compiler), or null
function findVcvars() {
  if (!fs.existsSync(VSWHERE)) return null;
  const r = spawnSync(
    VSWHERE,
    [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ],
    { encoding: 'utf8' },
  );
  for (const dir of (r.stdout || '').split(/\r?\n/).filter(Boolean)) {
    const bat = path.join(dir.trim(), 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
    if (fs.existsSync(bat)) return bat;
  }
  return null;
}

// Runs `command` (one cmd.exe line) after vcvars64.bat, in `cwd`. Output goes to the terminal.
function runWithCompiler(vcvars, command, cwd) {
  const line = `call "${vcvars}" >nul && ${command}`;
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    cwd,
    stdio: 'inherit',
    windowsVerbatimArguments: true,
    // vcvars64.bat looks for vswhere.exe on the PATH
    env: { ...process.env, PATH: path.dirname(VSWHERE) + ';' + process.env.PATH },
  });
  return r.status === 0;
}

// The Microsoft C++ runtime (msvcp140.dll, vcruntime140*.dll) that the camera SDK libraries need.
// Copied next to the helper ("app-local", allowed by Microsoft for these redistributable files), so a
// booth computer doesn't need "Visual C++ Redistributable" installed. [] = not found.
function crtDlls(vcvars) {
  const redist = path.join(vcvars, '..', '..', '..', 'Redist', 'MSVC');
  if (!fs.existsSync(redist)) return [];
  const versions = fs
    .readdirSync(redist)
    .filter(v => /^\d+\.\d+/.test(v))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const v of versions) {
    const x64 = path.join(redist, v, 'x64');
    if (!fs.existsSync(x64)) continue;
    const crt = fs.readdirSync(x64).find(d => /^Microsoft\.VC\d+\.CRT$/.test(d));
    if (!crt) continue;
    return fs
      .readdirSync(path.join(x64, crt))
      .filter(f => f.endsWith('.dll'))
      .map(f => path.join(x64, crt, f));
  }
  return [];
}

module.exports = { findVcvars, runWithCompiler, crtDlls, INSTALL_HELP };
