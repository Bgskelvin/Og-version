/* =====================================================================
   eslint.config.mjs — pemeriksa kode Leura   (npm run lint)
   - Aturan "recommended" bawaan ESLint (sama dengan @eslint/js recommended)
     + beberapa aturan tambahan yang umum dipakai.
   - Lingkungan per bagian: proses utama & uji (Node, CommonJS),
     tampilan (browser, ES module), server Cloudflare (ES module).
   - Tampilan (src/) berupa ES module (index.html memuat src/start.js);
     setiap file meng-import yang dipakainya, jadi tidak ada nama global bersama.
   ===================================================================== */
import globals from 'globals';
import { builtinRules } from 'eslint/use-at-your-own-risk';

const rekomendasi = Object.fromEntries(
  [...builtinRules].filter(([, r]) => r.meta?.docs?.recommended).map(([nama]) => [nama, 'error']),
);

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
  // Tampilan aplikasi (src/): ES module di browser; window.api dari preload.js
  {
    files: ['src/**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser, api: 'readonly' } },
  },
  // Tiruan api untuk demo HP (skrip biasa, dimuat sebelum aplikasi)
  {
    files: ['demo/api-demo.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  // Uji tampilan & demo: kode di dalam page.evaluate() berjalan di halaman aplikasi
  {
    files: ['tests/uji-tampilan.js', 'tests/uji-demo.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        api: 'readonly',
        __leura: 'readonly', // window.__leura (src/debug-handle.js)
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
