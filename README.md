# Tokopakcivo / Pak Civo Live v2.2.0 Production Cleanup

Perbaikan utama:
- `public/index.html` diringankan dengan memindahkan base64 image/video ke `public/assets/`.
- XSS pada bubble chat user diperbaiki dengan `escapeHtml()`.
- Tombol `+ Keranjang` mencoba direct Shopify checkout via `/api/shopify-products` dan `/api/shopify-cart`.
- Fallback tetap ke AI chat jika produk tidak ditemukan.
- TTS dibatasi ke 1–2 kalimat awal agar lebih cepat.
- Warmup TTS frontend dihapus agar tidak boros request.
- Storefront API header distandarkan ke `X-Shopify-Storefront-Access-Token`.
- Endpoint test dikunci dengan `DEBUG_SECRET` jika env var tersebut diisi.
- File HTML lama di folder public dibersihkan.

Env Vercel yang dibutuhkan:
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`
- `SHOPIFY_API_VERSION` optional, default `2026-04`
- `SHOPIFY_SHOP_DOMAIN` / Admin credentials untuk `/api/lead` sesuai setup lama
- `DEBUG_SECRET` optional untuk membuka endpoint test

Test cepat setelah deploy:
1. Buka landing page.
2. Isi nama dan WhatsApp.
3. Tanya: `ada samcan?`
4. Klik produk Samcan lalu `+ Keranjang`.
5. Pastikan muncul tombol `Checkout Sekarang`.
6. Test produk API: `/api/shopify-products?q=samcan`.
