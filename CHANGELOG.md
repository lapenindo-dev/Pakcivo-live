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
