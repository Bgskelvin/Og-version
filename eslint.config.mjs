/* =====================================================================
   eslint.config.mjs — pemeriksa kode Leura   (npm run lint)
   - Aturan "recommended" bawaan ESLint (sama dengan @eslint/js recommended)
     + beberapa aturan tambahan yang umum dipakai.
   - Lingkungan per bagian: proses utama & uji (Node, CommonJS),
     tampilan (browser, skrip biasa), server Cloudflare (ES module).
   - Tampilan (src/) masih berupa skrip yang berbagi nama global lintas file.
     Nama-nama itu dikumpulkan otomatis di bawah supaya ESLint tetap bisa
     menangkap salah ketik. Bagian ini dihapus saat src/ diubah jadi modul
     (refactor/renderer-modules).
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import globals from 'globals';
import { builtinRules } from 'eslint/use-at-your-own-risk';

// Pengurai JavaScript yang dipakai ESLint sendiri (ikut terpasang bersama ESLint)
const espree = createRequire(import.meta.resolve('eslint'))('espree');

const rekomendasi = Object.fromEntries(
  [...builtinRules].filter(([, r]) => r.meta?.docs?.recommended).map(([nama]) => [nama, 'error']),
);

// Nama tingkat atas di src/*.js (fungsi, let/const/class, window.xxx = …) — dipakai bersama oleh semua file tampilan
function namaPola(p, hasil) {
  if (!p) return;
  if (p.type === 'Identifier') hasil.push(p.name);
  else if (p.type === 'ObjectPattern')
    p.properties.forEach(x => namaPola(x.type === 'RestElement' ? x.argument : x.value, hasil));
  else if (p.type === 'ArrayPattern') p.elements.forEach(x => namaPola(x, hasil));
  else if (p.type === 'AssignmentPattern') namaPola(p.left, hasil);
  else if (p.type === 'RestElement') namaPola(p.argument, hasil);
}
function globalTampilan() {
  const nama = [];
  for (const f of fs.readdirSync('src').filter(f => f.endsWith('.js'))) {
    const teks = fs.readFileSync(path.join('src', f), 'utf8');
    const ast = espree.parse(teks, { ecmaVersion: 'latest', sourceType: 'script' });
    for (const n of ast.body) {
      if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') nama.push(n.id.name);
      else if (n.type === 'VariableDeclaration') n.declarations.forEach(d => namaPola(d.id, nama));
    }
    for (const m of teks.matchAll(/\bwindow\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) nama.push(m[1]);
  }
  return Object.fromEntries(nama.map(n => [n, 'writable']));
}
const GLOBAL_TAMPILAN = globalTampilan();

const aturanUmum = {
  ...rekomendasi,
  'no-unused-vars': ['error', { ignoreRestSiblings: true }], // { buang, ...sisa } = x  boleh
  'no-empty': ['error', { allowEmptyCatch: false }], // catch kosong harus dijelaskan atau dicatat
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
  eqeqeq: ['error', 'smart'],
};

export default [
  {
    ignores: [
      'node_modules/',
      'dist/',
      'sdk/',
      'demo/web/',
      'demo/.wrangler/',
      'cloud/.wrangler/',
      'kamera-sony/bin/',
      'kamera-sony/.sdk/',
      'kamera-sony/hasil-uji/',
      'kamera-sony/uji/bin/',
    ],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    languageOptions: { ecmaVersion: 2024 },
    rules: aturanUmum,
  },
  // Proses utama Electron, preload, skrip build & uji: Node (CommonJS)
  {
    files: ['main.js', 'preload.js', 'main/**/*.js', 'tests/**/*.js', 'demo/bangun.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  // Tampilan aplikasi (dimuat lewat <script> di index.html) & tiruan api untuk demo HP
  {
    files: ['src/**/*.js', 'demo/api-demo.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.browser, ...GLOBAL_TAMPILAN, api: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { vars: 'local', ignoreRestSiblings: true }], // fungsi tingkat atas dipakai file lain
      'no-redeclare': ['error', { builtinGlobals: false }],
      // Variabel bersama (mis. di state.js) diubah dari file lain — ESLint tidak melihatnya,
      // jadi "ubah let jadi const" bisa merusak aplikasi. Dinyalakan lagi setelah src/ jadi modul.
      'prefer-const': 'off',
    },
  },
  {
    files: ['src/lut.js', 'src/qr.js'], // juga bisa dipakai lewat require() (module.exports)
    languageOptions: { globals: { module: 'readonly' } },
  },
  // Uji tampilan & demo: kode di dalam page.evaluate() berjalan di halaman aplikasi
  {
    files: ['tests/uji-tampilan.js', 'tests/uji-demo.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...GLOBAL_TAMPILAN,
        api: 'readonly',
        // tiruan window.api & alat uji yang dipasang di halaman (PALSU di uji-tampilan.js)
        ...Object.fromEntries(
          [
            'LOG',
            'MODE',
            'UNG',
            'SESI',
            'TPL',
            'SONY',
            'HITUNG',
            'KILAT',
            'CP',
            'QRPNG',
            'QRPNG2',
            'META_REC',
            'fireRecError',
            'setSony',
          ].map(n => [n, 'writable']),
        ),
      },
    },
  },
  // Server QR & server demo (Cloudflare Workers, ES module)
  {
    files: ['cloud/**/*.mjs', 'demo/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.serviceworker } },
  },
];
