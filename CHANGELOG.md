# Pak Civo Live — Perubahan (UX & Programming Review)

## v6.3 — Perbaikan alur keranjang & checkout yang "tidak sinkron" (2026-07-01)

**Root cause yang ditemukan (via code review + simulasi Playwright):**

1. **Dua sistem keranjang yang tidak nyambung.** Saat Pak Civo (AI) memutuskan sendiri untuk checkout, backend (`api/chat.js`) langsung membuat link checkout Shopify dari command `<<SHOPIFY_CART|...>>` TANPA pernah menyentuh `cartLines` yang dipakai badge/keranjang/tombol `+Keranjang`. Hasilnya: badge keranjang salah, dan kartu konfirmasi "Ya/Batal" yang konsisten hanya muncul untuk add via tombol, tidak untuk add via chat AI — persis gejala "jawaban tidak sinkron" dan alur checkout berantakan.
   - **Fix:** `api/chat.js` sekarang hanya melaporkan `cartCommands` (variant + qty), tidak lagi membuat link sendiri. Frontend menyambungkannya ke pipeline konfirmasi yang SAMA dengan tombol `+Keranjang` (`renderPendingCartConfirmation`), jadi hanya ada SATU sumber kebenaran untuk isi keranjang, satu gaya kartu konfirmasi, dan checkout selalu dibangun dari total isi keranjang terkini (bukan cuma item terakhir).
2. **Kode mati yang menyesatkan.** Frontend masih mem-parsing format marker lama `<<CART:ADD:pN:qty>>` yang sudah tidak pernah dikirim backend (backend pakai `<<SHOPIFY_CART|variantId|qty>>`). Blok ini 100% tidak pernah jalan — dihapus, diganti logika `cartCommands` yang nyata.
3. **"Sudah masuk keranjang" padahal tidak.** 3 dari 5 produk showroom (Babi Giling, Paikut Sop, Kapsim) baru dapat `variantId` setelah hidrasi Shopify selesai (async, ada jeda). Kalau customer buru-buru konfirmasi SEBELUM hidrasi selesai, baris keranjang itu di-drop diam-diam oleh `cloneCartLines()` (karena variantId kosong), tapi pesannya tetap bilang "sudah masuk keranjang" — checkout jadi kehilangan item itu.
   - **Fix:** `ensureVariantForProduct()` — sebelum benar-benar mengeksekusi add, coba ambil data variant terbaru dari Shopify sekali lagi. Kalau masih gagal, kasih pesan jujur ("lagi disiapkan, coba lagi ya") — bukan klaim sukses palsu. Sudah diuji dengan simulasi race-condition (klik konfirmasi persis saat hidrasi belum selesai) → hasilnya benar, tidak ada lagi silent-drop.
4. **FAQ instan pakai substring match longgar** (`includes()` tanpa batas kata) → berpotensi salah nyantol ke jawaban FAQ yang tidak relevan. Diganti whole-word match.

**Upsell hook — kenapa jarang muncul:**
Sebelumnya, hook upsell HANYA muncul kalau jawaban datang dari Gemini (AI). Tapi kalimat pembelian paling umum ("tambahkan", "mau", "beli", "pesan", "order") justru langsung ditangkap oleh deteksi lokal di frontend dan TIDAK PERNAH sampai ke AI — jadi upsell hook nyaris tidak pernah tampil di momen paling penting: setelah customer baru saja menambah produk.

**Fix:** upsell hook sekarang dipicu langsung dari sisi client, setelah SETIAP add-to-cart berhasil — lewat tombol, teks chat, maupun command AI. Saran silang dibatasi ke 5 produk showroom (closed loop) supaya klik "+ Tambah" selalu instan berhasil tanpa perlu round-trip AI lagi.

File yang diubah: `api/chat.js`, `public/index.html`.

---

# Pak Civo Live — Perubahan (UX & Programming Review)

File yang diubah: **`public/index.html`** (hanya 1 file).
Backend (`api/*`) tidak disentuh agar tidak ada regresi yang tidak bisa diuji.

Cara pakai: timpa `public/index.html` lama dengan yang ada di zip ini, lalu deploy ulang ke Vercel.

---

## 1. Performa — hapus video tersembunyi 1.1 MB
- `pakcivo-host.mp4` (1.1 MB) di-`display:none !important` tapi **tetap di-download** tiap load (ada `<video autoplay>` + pemanggilan `.play()`).
- Elemen `<video>` dan pemanggilan `hostVideo.play()` dihapus. Visual host tetap pakai `pakcivo-host-clean-art.webp` (28 KB).
- **Dampak:** ~1.1 MB lebih ringan per kunjungan — penting untuk halaman live-selling di mobile.

## 2. Performa — hidrasi produk Shopify paralel
- Sebelumnya 5 slot best-seller di-fetch berurutan (`await` di dalam `for`), jadi waktu muat menumpuk 5 round-trip.
- Sekarang semua di-fetch bersamaan via `Promise.all` → strip produk muncul jauh lebih cepat.

## 3. UX — lead gate kini bisa ditutup
- Modal nama+WhatsApp sebelumnya tidak bisa ditutup; padahal copy-nya menjanjikan "Pak Civo tetap bisa bantu rekomendasi dulu".
- Ditambah: tombol ✕, tombol "Nanti saja, lihat-lihat dulu", tutup via Escape, dan tutup via klik backdrop.
- Logika gate diperbarui: pertanyaan biasa tidak lagi memaksa modal setelah di-skip, **tetapi** aksi checkout/order (`beli`, `order`, `keranjang`, `ongkir`, `bayar`, `qris`, dll.) tetap meminta data. Lead tetap tertangkap di momen niat tertinggi.

## 4. Aksesibilitas (a11y)
- Tombol ikon (`Kirim`, input pesan) diberi `aria-label`.
- Aksi sidebar (Keranjang/Admin) dan quick chips kini bisa dioperasikan keyboard (`role="button"`, `tabindex`, Enter/Space) dan punya `aria-label` untuk screen reader.

## 5. Bersih-bersih kode mati (mengurangi risiko error & ukuran)
Dihapus karena tidak pernah dipakai dan sebagian menunjuk elemen yang tidak ada:
- `doLike()` — menunjuk `#likeIcon` / `#likeCount` yang tidak ada di markup (akan error bila dipanggil).
- `shareWA()` — tidak pernah dipasang ke tombol mana pun.
- `sendProductQuick()` — tidak dipanggil.
- `toggleChips()` + handler klik-di-luar yang menunjuk `#chatQuickAction` (tidak ada) — selalu no-op.

---

## Catatan / rekomendasi lanjutan (TIDAK diubah — perlu keputusan Anda)
- **Rate limiter** (`api/chat.js`, `api/tts.js`) berbasis memori per-instance serverless, jadi lemah lintas instance di Vercel. Untuk produksi sebaiknya pakai Vercel KV/Redis.
- **Social proof palsu** (viewer count acak, bubble chat fiktif, "Order ke-8") dipertahankan sebagai pilihan desain Anda, tapi berisiko terhadap kepercayaan pelanggan.
- **`.product-card` besar** masih disembunyikan permanen (`display:none !important`); hanya strip kecil yang tampil. Mohon konfirmasi apakah ini memang disengaja.
- Validasi: kedua blok `<script>` lulus `node --check`, markup `<div>` seimbang, dan semua fungsi `onclick` punya definisi.
