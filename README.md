# Tokopakcivo / Pak Civo Live v5.0.1 Production Cleanup

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


## v5.0.1 Production Hardening
- Dynamic Shopify catalog hydration from `/api/shopify-products`.
- SKU removed from public product API response.
- Lead gate conversion-safe fallback if Shopify Admin lead sync is temporarily down.
- Optional Cloudflare Turnstile validation for lead capture.
- TTS unit normalization fix: lowercase `m` is meter, explicit `M/miliar/milyar` is miliar.
- Desktop frame layout, toast feedback, analytics-ready events, unified versioning.


## v5.0.1 Best-Selling 5 Update

Homepage Pak Civo Live product showroom is locked to 5 best sellers only: Samcan Lokal 1kg, Babi Giling 500g, Paikut Sop 500g, Kapsim 1kg, and Samcan Import 1kg. Shopify hydration updates price/variant ID for these five without adding other products to the visible strip.
