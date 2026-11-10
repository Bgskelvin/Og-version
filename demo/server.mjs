/* =====================================================================
   demo/server.mjs — server kecil untuk Leura Demo (Cloudflare Worker)
   - File tampilan (demo/web) dilayani otomatis oleh Cloudflare.
   - PUT /u/<kode>  demo mengunggah foto hasil photobooth (tanpa kunci booth,
                    tapi dibatasi: hanya JPEG, maks 8 MB, hanya dari halaman demo).
   - GET /f/<kode>  halaman unduh ASLI Leura (dipakai ulang dari cloud/worker.mjs),
     GET /s/<kode>, /i/<kode>, /d/<kode>  status, gambar & unduhan.
   Foto demo disimpan di bucket yang sama (leura-foto) tapi di folder terpisah
   "demo/", hanya 1 hari (aturan R2 "hapus-demo-1-hari" menghapusnya otomatis).
   Foto booth asli (folder "foto/") tidak bisa dibaca atau ditimpa dari sini.
   ===================================================================== */
import leura from '../cloud/worker.mjs';

const KODE = /^[A-Za-z0-9]{10,16}$/;
const MAKS_BYTE = 8 * 1024 * 1024;
const HEADER_AMAN = {
  'x-robots-tag': 'noindex, nofollow',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...HEADER_AMAN } });

// Bucket R2 yang diarahkan ke folder demo/ (halaman unduh asli membaca "foto/<kode>.jpg")
const keDemo = k => 'demo/' + String(k).replace(/^foto\//, '');
const bucketDemo = b => ({
  get: (k, o) => b.get(keDemo(k), o),
  head: k => b.head(keDemo(k)),
  put: (k, v, o) => b.put(keDemo(k), v, o),
});

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const [, jalur, kode = ''] = url.pathname.split('/');

    if (jalur === 'u') {
      if (req.method !== 'PUT') return json({ ok: false, error: 'Metode tidak didukung' }, 405);
      const asal = req.headers.get('origin');
      if (asal && asal !== url.origin) return json({ ok: false, error: 'Tidak diizinkan' }, 403);
      if (!KODE.test(kode)) return json({ ok: false, error: 'Kode tidak valid' }, 400);
      const panjang = Number(req.headers.get('content-length') || 0);
      if (panjang > MAKS_BYTE) return json({ ok: false, error: 'Foto terlalu besar' }, 413);
      const data = await req.arrayBuffer();
      if (!data.byteLength || data.byteLength > MAKS_BYTE)
        return json({ ok: false, error: 'Ukuran foto tidak valid' }, 413);
      const b = new Uint8Array(data, 0, 3);
      if (!(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)) return json({ ok: false, error: 'Bukan foto JPEG' }, 415);
      if (await env.FOTO.head(keDemo(kode + '.jpg'))) return json({ ok: false, error: 'Kode sudah dipakai' }, 409);
      await env.FOTO.put(keDemo(kode + '.jpg'), data, {
        httpMetadata: { contentType: 'image/jpeg' },
        customMetadata: { diunggah: String(Date.now()), demo: '1' },
      });
      return json({ ok: true });
    }

    if (jalur === 'f' || jalur === 's' || jalur === 'i' || jalur === 'd') {
      return leura.fetch(req, { ...env, FOTO: bucketDemo(env.FOTO), HARI_SIMPAN: '1', KUNCI_BOOTH: '' }, ctx);
    }

    return env.ASSETS.fetch(req);
  },
};
