/* =====================================================================
   cloud-setup.js — runs cloud/pasang.sh on Mac and on Windows.
   npm run cloud:pasang
   - Mac / Linux: bash is always there.
   - Windows: `bash` is usually not on the PATH, so this looks for Git Bash
     (Git for Windows) in the usual places. WSL's bash (System32\bash.exe)
     is not used: it runs in a separate Linux system without this Node / npx.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'cloud', 'pasang.sh');

// Places Git Bash is installed by Git for Windows (machine-wide, per user, 32-bit)
function windowsBashCandidates(env = process.env) {
  const roots = [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'),
  ];
  const list = [];
  if (env.PLAYGROUNDBOOTH_BASH) list.push(env.PLAYGROUNDBOOTH_BASH);
  for (const root of roots) if (root) list.push(path.win32.join(root, 'Git', 'bin', 'bash.exe'));
  // git.exe on the PATH (…\Git\cmd\git.exe) → …\Git\bin\bash.exe
  for (const dir of String(env.PATH || env.Path || '').split(';')) {
    if (/[\\/]git[\\/]cmd[\\/]?$/i.test(dir)) list.push(path.win32.join(dir, '..', 'bin', 'bash.exe'));
  }
  return [...new Set(list)];
}

function findBash({ platform = process.platform, env = process.env, exists = fs.existsSync } = {}) {
  if (platform !== 'win32') return 'bash';
  return windowsBashCandidates(env).find(f => exists(f)) || null;
}

function main() {
  const bash = findBash();
  if (!bash) {
    console.error(
      '\n✗ Git Bash not found. Install Git for Windows (https://git-scm.com/download/win), then run again:\n' +
        '  npm run cloud:pasang\n' +
        '  (Or set PLAYGROUNDBOOTH_BASH to the full path of bash.exe.)\n',
    );
    process.exit(1);
  }
  const r = spawnSync(bash, [SCRIPT], { stdio: 'inherit' });
  if (r.error) {
    console.error('\n✗ Could not start bash: ' + r.error.message + '\n');
    process.exit(1);
  }
  process.exit(r.status === null ? 1 : r.status);
}

if (require.main === module) main();

module.exports = { findBash, windowsBashCandidates };
