/* =====================================================================
   worker.mjs — server kecil di Cloudflare untuk unduh foto lewat QR.
   Dipasang dengan:  npm run cloud:pasang   (lihat cloud/pasang.sh)

   PUT  /u/<kode>   booth mengunggah foto hasil (wajib kunci booth)
   GET  /f/<kode>   halaman unduh untuk tamu (yang dibuka dari QR)
   GET  /i/<kode>   gambar fotonya
   GET  /d/<kode>   unduh file foto
   GET  /ping       cek sambungan dari Admin (wajib kunci booth)

   Foto disimpan di R2 (binding FOTO) dan dianggap hilang setelah
   HARI_SIMPAN hari; aturan R2 menghapus file aslinya otomatis.
   ===================================================================== */

const KODE = /^[A-Za-z0-9]{8,16}$/;
const MAKS_BYTE = 15 * 1024 * 1024;

const TEKS = {
  id: {
    judul: 'Fotomu dari Photo Booth', unduh: 'Simpan foto', tips: 'Di iPhone: tekan lama fotonya, lalu pilih "Simpan ke Foto".',
    tunggu: 'Fotomu sedang dikirim…', tungguInfo: 'Halaman ini akan memuat ulang sendiri. Biasanya hanya beberapa detik.',
    hilang: 'Foto tidak ditemukan', hilangInfo: 'Foto disimpan selama {h} hari setelah diambil. Kalau kamu baru saja berfoto, tunggu sebentar dan buka lagi link ini.',
    simpan: 'Foto tersedia {h} hari.',
  },
  en: {
    judul: 'Your Photo Booth photo', unduh: 'Save photo', tips: 'On iPhone: press and hold the photo, then choose "Save to Photos".',
    tunggu: 'Your photo is on its way…', tungguInfo: 'This page will refresh by itself. It usually takes just a few seconds.',
    hilang: 'Photo not found', hilangInfo: 'Photos are kept for {h} days after they are taken. If you just took your photo, please wait a moment and open this link again.',
    simpan: 'Available for {h} days.',
  },
};

const kunciFoto = kode => `foto/${kode}.jpg`;
const hariSimpan = env => Math.max(1, Number(env.HARI_SIMPAN) || 7);
const kedaluwarsa = (obj, env) => {
  const t = Number(obj.customMetadata && obj.customMetadata.diunggah) || (obj.uploaded ? new Date(obj.uploaded).getTime() : Date.now());
  return Date.now() - t > hariSimpan(env) * 86400000;
};
// Bandingkan kunci tanpa bocor lewat waktu proses
function samaAman(a, b) {
  a = String(a || ''); b = String(b || '');
  let beda = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) beda |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return beda === 0 && a.length > 0;
}
const bolehBooth = (req, env) => samaAman((req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''), env.KUNCI_BOOTH);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEADER_AMAN = { 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...HEADER_AMAN } });

function halaman(t, isi) {
  return new Response(`<!doctype html><html lang="${t === TEKS.en ? 'en' : 'id'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(t.judul)}</title><style>
:root{--bg:#F6F1EA;--kartu:#fff;--teks:#1D1D1F;--abu:#6E6E73;--aksen:#B08D57}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--kartu:#1F1F21;--teks:#F5F5F7;--abu:#A1A1A6}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--teks);
font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;display:flex;justify-content:center;padding:24px 16px}
main{width:100%;max-width:520px;text-align:center}.merek{letter-spacing:.32em;font-size:13px;font-weight:600;color:var(--aksen);margin:8px 0 18px}
h1{font-size:24px;margin:0 0 16px}.kartu{background:var(--kartu);border-radius:20px;padding:12px;box-shadow:0 10px 30px rgba(0,0,0,.08)}
img{display:block;width:100%;height:auto;border-radius:12px}.btn{display:block;margin:18px 0 10px;padding:16px;border-radius:999px;
background:var(--aksen);color:#fff;text-decoration:none;font-weight:600;font-size:18px}p{color:var(--abu);margin:8px 0}
.putar{width:40px;height:40px;margin:30px auto;border-radius:50%;border:4px solid var(--aksen);border-right-color:transparent;animation:p 1s linear infinite}
@keyframes p{to{transform:rotate(360deg)}}</style></head><body><main><div class="merek">LEURA</div>${isi}</main></body></html>`,
  { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...HEADER_AMAN } });
}

async function ambil(env, kode) {
  if (!KODE.test(kode)) return null;
  const obj = await env.FOTO.get(kunciFoto(kode));
  if (!obj) return null;
  if (kedaluwarsa(obj, env)) return null;
  return obj;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const [, jalur, kode = ''] = url.pathname.split('/');
    const t = url.searchParams.get('b') === 'en' ? TEKS.en : TEKS.id;
    const h = hariSimpan(env);

    if (jalur === 'ping') {
      if (!bolehBooth(req, env)) return json({ ok: false, error: 'Kunci booth salah' }, 401);
      return json({ ok: true, hari: h });
    }

    if (jalur === 'u' && req.method === 'PUT') {
      if (!bolehBooth(req, env)) return json({ ok: false, error: 'Kunci booth salah' }, 401);
      if (!KODE.test(kode)) return json({ ok: false, error: 'Kode tidak valid' }, 400);
      const data = await req.arrayBuffer();
      if (!data.byteLength || data.byteLength > MAKS_BYTE) return json({ ok: false, error: 'Ukuran foto tidak valid' }, 413);
      const b = new Uint8Array(data, 0, 3);
      if (!(b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF)) return json({ ok: false, error: 'Bukan foto JPEG' }, 415);
      await env.FOTO.put(kunciFoto(kode), data, {
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: { diunggah: String(Date.now()) },
      });
      return json({ ok: true });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return json({ ok: false, error: 'Metode tidak didukung' }, 405);

    if (jalur === 'i' || jalur === 'd') {
      const obj = await ambil(env, kode);
      if (!obj) return new Response('Tidak ditemukan', { status: 404, headers: HEADER_AMAN });
      const headers = { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600', ...HEADER_AMAN };
      if (jalur === 'd') headers['content-disposition'] = `attachment; filename="Leura-${kode}.jpg"`;
      return new Response(obj.body, { headers });
    }

    if (jalur === 'f') {
      const obj = KODE.test(kode) ? await ambil(env, kode) : null;
      if (obj) {
        return halaman(t, `<h1>${esc(t.judul)}</h1><div class="kartu"><img src="/i/${kode}" alt="${esc(t.judul)}"></div>
<a class="btn" href="/d/${kode}" download="Leura-${kode}.jpg">${esc(t.unduh)}</a><p>${esc(t.tips)}</p><p>${esc(t.simpan.replace('{h}', h))}</p>`);
      }
      // Belum sampai (internet booth lambat) atau sudah lewat masa simpan. Muat ulang sendiri selama 15 menit pertama.
      const umur = Number(url.searchParams.get('n') || 0);
      if (KODE.test(kode) && umur < 180) {
        return halaman(t, `<div class="putar"></div><h1>${esc(t.tunggu)}</h1><p>${esc(t.tungguInfo)}</p>
<script>setTimeout(function(){var u=new URL(location.href);u.searchParams.set('n',${umur + 1});location.replace(u)},5000)</script>`);
      }
      return halaman(t, `<h1>${esc(t.hilang)}</h1><p>${esc(t.hilangInfo.replace('{h}', h))}</p>`);
    }

    return halaman(t, `<h1>Leura Photo Booth</h1>`);
  },
};
