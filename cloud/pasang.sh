#!/bin/bash
# =====================================================================
# pasang.sh — memasang server unduh foto (Worker + R2) ke akun Cloudflare-mu.
# Jalankan dari folder proyek:   npm run cloud:pasang
# Aman dijalankan ulang (misalnya setelah worker.mjs diperbarui).
#
# Sebelum menjalankan: buat akun Cloudflare dan aktifkan R2 di dashboard
# (Cloudflare meminta kartu pembayaran walau pemakaiannya masih gratis).
# =====================================================================
set -e
cd "$(dirname "$0")"
W="npx --yes wrangler@4"
BUCKET="leura-foto"
HASIL=".hasil-pasang.json"

say() { printf '\n▶ %s\n' "$1"; }
gagal() { printf '\n✗ %s\n\n' "$1"; exit 1; }

say "Memeriksa login Cloudflare"
if ! $W whoami 2>/dev/null | grep -qi "associated with"; then
  echo "Browser akan terbuka. Login ke Cloudflare lalu klik Allow."
  $W login || gagal "Login Cloudflare gagal."
fi

say "Membuat tempat penyimpanan foto (R2: $BUCKET)"
$W r2 bucket create "$BUCKET" 2>&1 | tail -3 || true
$W r2 bucket list 2>/dev/null | grep -q "$BUCKET" || gagal "Bucket R2 belum ada. Aktifkan R2 di dashboard Cloudflare (menu R2), lalu jalankan lagi."

say "Mengatur hapus otomatis setelah 7 hari"
$W r2 bucket lifecycle add "$BUCKET" hapus-7-hari --expire-days 7 --force 2>&1 | tail -2 || true
# Unggahan video yang terputus & tidak pernah diselesaikan: dibuang setelah 1 hari
$W r2 bucket lifecycle add "$BUCKET" buang-unggah-video-terputus --abort-multipart-days 1 --force 2>&1 | tail -2 || true

say "Mengirim program ke Cloudflare"
OUT=$($W deploy 2>&1) || {
  if echo "$OUT" | grep -qi "workers.dev subdomain"; then
    LINK=$(echo "$OUT" | grep -Eo 'https://dash\.cloudflare\.com/[^ ]*/workers/onboarding' | head -1)
    printf '\nAkunmu belum punya nama subdomain workers.dev (cukup sekali).\n'
    printf '1. Buka: %s\n' "${LINK:-https://dash.cloudflare.com → Workers & Pages}"
    printf '2. Isi nama subdomain (misalnya: gusvin), lalu simpan.\n'
    printf '3. Tunggu 1–2 menit, lalu jalankan lagi: npm run cloud:pasang\n'
    gagal "Worker belum terpasang karena subdomain belum dibuat."
  fi
  echo "$OUT"; gagal "Gagal memasang Worker."; }
echo "$OUT" | tail -6
URL=$(echo "$OUT" | grep -Eo 'https://[A-Za-z0-9.-]+\.workers\.dev' | head -1)
[ -n "$URL" ] || gagal "Alamat Worker tidak ditemukan di hasil pemasangan."

say "Membuat kunci booth"
if [ -f "$HASIL" ] && grep -q '"kunci"' "$HASIL"; then
  KUNCI=$(node -e "console.log(require('./$HASIL').kunci)")
  echo "Memakai kunci yang sudah ada."
else
  KUNCI=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
fi
echo "$KUNCI" | $W secret put KUNCI_BOOTH 2>&1 | tail -2

node -e "require('fs').writeFileSync('$HASIL', JSON.stringify({ url: '$URL', kunci: '$KUNCI', waktu: new Date().toISOString() }, null, 2))"

say "Mengecek sambungan"
sleep 3
if curl -fsS -H "Authorization: Bearer $KUNCI" "$URL/ping" | grep -q '"ok":true'; then
  printf '\n✓ Selesai. Server unduh foto: %s\n' "$URL"
  printf '  Di aplikasi: Admin → Pengaturan photobooth → Unduh lewat QR → "Ambil dari hasil pasang"\n\n'
else
  printf '\n⚠ Worker terpasang di %s, tapi tes sambungan belum berhasil.\n' "$URL"
  printf '  Tunggu 1 menit lalu tekan "Tes sambungan" di Admin.\n\n'
fi
