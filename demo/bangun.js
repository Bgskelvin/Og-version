/* =====================================================================
   demo/bangun.js — membuat Leura versi DEMO untuk HP (folder demo/web)
     npm run demo:bangun   → buat folder demo/web
     npm run demo:lihat    → buka demo di komputer ini (http://localhost:8080)
     npm run demo:pasang   → bangun + unggah ke Cloudflare (link untuk HP)
   Kode aplikasi asli (src/, styles/) disalin apa adanya. Bagian Mac
   diganti demo/api-demo.js. Tidak ada kunci/password yang ikut disalin.
   ===================================================================== */
const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const KELUAR = path.join(__dirname, 'web');

function salinFolder(dari, ke) {
  fs.mkdirSync(ke, { recursive: true });
  for (const f of fs.readdirSync(dari, { withFileTypes: true })) {
    if (f.name.startsWith('.')) continue;
    const a = path.join(dari, f.name), b = path.join(ke, f.name);
    if (f.isDirectory()) salinFolder(a, b); else fs.copyFileSync(a, b);
  }
}

function bangun() {
  fs.rmSync(KELUAR, { recursive: true, force: true });
  fs.mkdirSync(KELUAR, { recursive: true });
  salinFolder(path.join(AKAR, 'src'), path.join(KELUAR, 'src'));
  salinFolder(path.join(AKAR, 'styles'), path.join(KELUAR, 'styles'));
  for (const f of ['api-demo.js', 'demo.css', 'contoh-unduh.html', 'ikon-180.png', 'ikon-512.png'])
    fs.copyFileSync(path.join(__dirname, f), path.join(KELUAR, f));

  let html = fs.readFileSync(path.join(AKAR, 'index.html'), 'utf8');
  const ganti = (lama, baru) => {
    if (!html.includes(lama)) throw new Error('Tidak menemukan bagian ini di index.html: ' + lama);
    html = html.replace(lama, baru);
  };
  ganti('<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">\n' +
    '<meta name="robots" content="noindex">\n' +
    '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n' +
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">\n<meta name="apple-mobile-web-app-title" content="Leura">\n' +
    '<meta name="theme-color" content="#f5f5f7">\n<link rel="manifest" href="manifest.json">\n<link rel="apple-touch-icon" href="ikon-180.png">');
  ganti('<title>Videobooth</title>', '<title>Leura Demo</title>');
  ganti('<link rel="stylesheet" href="styles/photobooth.css">', '<link rel="stylesheet" href="styles/photobooth.css">\n<link rel="stylesheet" href="demo.css">');
  ganti('<script src="src/state.js"></script>', '<script src="api-demo.js"></script>\n<script src="src/state.js"></script>');
  fs.writeFileSync(path.join(KELUAR, 'index.html'), html);

  fs.writeFileSync(path.join(KELUAR, 'manifest.json'), JSON.stringify({
    name: 'Leura Demo', short_name: 'Leura', start_url: './', scope: './', display: 'fullscreen', orientation: 'landscape',
    background_color: '#f5f5f7', theme_color: '#f5f5f7',
    icons: [{ src: 'ikon-180.png', sizes: '180x180', type: 'image/png' }, { src: 'ikon-512.png', sizes: '512x512', type: 'image/png' }],
  }, null, 2));
  // Header keamanan untuk Cloudflare (file _headers dibaca otomatis oleh Workers Static Assets)
  fs.writeFileSync(path.join(KELUAR, '_headers'), [
    '/*',
    '  X-Robots-Tag: noindex',
    '  Referrer-Policy: no-referrer',
    '  X-Content-Type-Options: nosniff',
    '  Permissions-Policy: camera=(self), microphone=(self)',
    '',
  ].join('\n'));
  const n = (function hitung(d) { return fs.readdirSync(d, { withFileTypes: true }).reduce((s, f) => s + (f.isDirectory() ? hitung(path.join(d, f.name)) : 1), 0); })(KELUAR);
  console.log(`✓ Demo dibuat di demo/web (${n} file)`);
}

// Server kecil untuk mencoba demo di komputer ini (localhost boleh memakai kamera)
function lihat(port = 8080) {
  const http = require('http');
  const JENIS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
  http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(KELUAR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(KELUAR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Tidak ada'); }
    res.writeHead(200, { 'Content-Type': JENIS[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(port, () => console.log(`Demo jalan di http://localhost:${port}  (tekan Ctrl+C untuk berhenti)`));
}

if (require.main === module) {
  bangun();
  if (process.argv.includes('--lihat')) lihat(Number(process.env.PORT) || 8080);
}
module.exports = { bangun, lihat, KELUAR };
