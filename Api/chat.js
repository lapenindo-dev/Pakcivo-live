// api/chat.js — Vercel Serverless Function
// Perantara aman: API key Gemini disimpan di server (environment variable),
// tidak pernah terlihat oleh browser customer.


// Basic in-memory rate limiter for Vercel Serverless.
// Catatan: cukup untuk MVP/test live. Untuk traffic besar lintas instance,
// gunakan Redis/Upstash agar limit konsisten di semua region/instance.
const RATE_LIMITS = {
  minute: { windowMs: 60 * 1000, max: Number(process.env.RATE_LIMIT_PER_MINUTE || 15) },
  hour: { windowMs: 60 * 60 * 1000, max: Number(process.env.RATE_LIMIT_PER_HOUR || 120) },
};
const rateStore = globalThis.__PAKCIVO_RATE_STORE__ || new Map();
globalThis.__PAKCIVO_RATE_STORE__ = rateStore;

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "";
  return String(forwarded).split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
}

function rateLimit(req) {
  const ip = getClientIp(req);
  const now = Date.now();

  for (const [name, cfg] of Object.entries(RATE_LIMITS)) {
    const key = `${ip}:${name}`;
    const bucket = rateStore.get(key);

    if (!bucket || now > bucket.resetAt) {
      rateStore.set(key, { count: 1, resetAt: now + cfg.windowMs });
      continue;
    }

    if (bucket.count >= cfg.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      return { allowed: false, retryAfter };
    }

    bucket.count += 1;
  }

  // Cleanup ringan supaya Map tidak membesar terus.
  if (Math.random() < 0.01) {
    for (const [key, bucket] of rateStore.entries()) {
      if (now > bucket.resetAt) rateStore.delete(key);
    }
  }

  return { allowed: true };
}

async function verifyTurnstileToken(token, req) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const captchaEnabled = process.env.CAPTCHA_ENABLED === "true";

  if (!captchaEnabled || !secret) return { ok: true };
  if (!token) return { ok: false, code: "CAPTCHA_REQUIRED" };

  const formData = new URLSearchParams();
  formData.append("secret", secret);
  formData.append("response", token);
  formData.append("remoteip", getClientIp(req));

  const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: formData,
  });
  const data = await resp.json().catch(() => ({}));

  return data.success ? { ok: true } : { ok: false, code: "CAPTCHA_FAILED" };
}


const ADMIN_WA_LINK = "https://wa.me/6281717179291";

const BRANCHES = [
  {
    keys: ["tangerang pusat", "batuceper", "daan mogot", "daanmogot", "arcadia"],
    cityKeys: ["tangerang"],
    name: "CIVO MEAT Tangerang Pusat",
    address: "Daanmogot Arcadia Blok H6 No.3, Batuceper, Kota Tangerang.",
    maps: "https://maps.app.goo.gl/oD3Hw4vhGArBfRgg7?g_st=aw",
    wa: "https://wa.me/6287760070078",
  },
  {
    keys: ["serpong", "tangerang selatan", "tangsel", "jelupang", "serpong park"],
    cityKeys: ["tangerang", "serpong", "tangerang selatan", "tangsel"],
    name: "CIVO MEAT Serpong",
    address: "Ruko Serpong Park Blok BVA1 No.53, Jelupang, Serpong Utara, Tangerang Selatan.",
    maps: "https://maps.app.goo.gl/nvswPtdnoW7aewhg6?g_st=aw",
    wa: "https://wa.me/6281280799493",
  },
  {
    keys: ["jakarta barat", "jakbar", "petamburan", "wijaya kusuma", "perdana"],
    cityKeys: ["jakarta barat", "jakbar"],
    name: "CIVO MEAT Jakarta Barat",
    address: "Jl. Perdana 1 Wijaya Kusuma 1 No.1D, Petamburan, Jakarta Barat.",
    maps: "https://maps.app.goo.gl/fGB5rjps6QjHdFAF6?g_st=aw",
    wa: "https://wa.me/628979372211",
  },
  {
    keys: ["jakarta pusat", "jakpus", "kemayoran", "kepu"],
    cityKeys: ["jakarta pusat", "jakpus"],
    name: "CIVO MEAT Jakarta Pusat",
    address: "Jl. Kepu Selatan No.29A, Kemayoran, Jakarta Pusat.",
    maps: "https://maps.app.goo.gl/9aKSQb4yrLfkQmtW7?g_st=aw",
    wa: "https://wa.me/628998605577",
  },
  {
    keys: ["sunter", "jakarta utara", "jakut", "tanjung priok", "sunter hijau"],
    cityKeys: ["sunter", "jakarta utara", "jakut"],
    name: "CIVO MEAT Sunter (Jakarta Utara)",
    address: "Jl. Sunter Hijau Raya No.4 Blok F4, Tanjung Priok, Jakarta Utara.",
    maps: "https://maps.app.goo.gl/gvp2A8zwkom5GLgg6?g_st=aw",
    wa: "https://wa.me/6287877999833",
  },
  {
    keys: ["bandung", "lengkong", "macan"],
    cityKeys: ["bandung"],
    name: "CIVO MEAT Bandung",
    address: "Jl. Macan No.20, Lengkong, Kota Bandung, Jawa Barat.",
    maps: "https://maps.app.goo.gl/uJGDdfqDsBNZdtTP9?g_st=aw",
    wa: "https://wa.me/6281380104310",
  },
  {
    keys: ["semarang", "petudungan", "jagalan"],
    cityKeys: ["semarang"],
    name: "CIVO MEAT Semarang",
    address: "Jl. Petudungan No.95, Jagalan, Semarang Tengah, Kota Semarang.",
    maps: "https://maps.app.goo.gl/b1aR4XJ1HXxk4d5K9?g_st=ac",
    wa: "https://wa.me/6281959743529",
  },
  {
    keys: ["surabaya", "citraland", "sambikerep", "kingstown"],
    cityKeys: ["surabaya"],
    name: "CIVO MEAT Surabaya",
    address: "Ruko Jl. Kingstown No.KK-08, Citraland, Sambikerep, Surabaya, East Java 60212.",
    maps: "https://maps.app.goo.gl/yyHvPvM8Yto6nyhJ7?g_st=ac",
    wa: "https://wa.me/628979380066",
  },
];

const PRODUCTS = [
  { id: "p1", keys: ["samcan lokal", "pork belly lokal", "samcan"], name: "Samcan Pork Belly Lokal", unit: "1 kg", price: "Rp 130.000", note: "lemak lebih banyak, lebih juicy karena bekunya belum lama, kadang masih terlihat sisa bulu di kulit" },
  { id: "p5", keys: ["samcan import", "pork belly import", "samcan"], name: "Samcan Pork Belly Import", unit: "1 kg", price: "Rp 150.000", note: "layer lebih berlapis dan konsisten, bulu lebih bersih, kulit lebih tipis, sudah frozen lebih lama" },
  { id: "p2", keys: ["babi giling", "pork ground", "giling"], name: "Babi Giling (Pork Ground)", unit: "500 g", price: "Rp 40.000", note: "cocok untuk bakso, dumpling, siomay, dan bolognese" },
  { id: "p3", keys: ["pork shoulder", "kapsim", "shoulder"], name: "Pork Shoulder Kapsim", unit: "1 kg", price: "Rp 80.000", note: "cocok untuk char siu, roast, dan stew" },
  { id: "p4", keys: ["paikut", "ribs", "pork ribs", "iga"], name: "Pork Paikut Ribs Chopped", unit: "500 g", price: "Rp 50.000", note: "cocok untuk sup paikut, braised, dan steam" },
];

function latestUserText(messages) {
  const last = [...messages].reverse().find((m) => m && m.role === "user");
  return String(last?.content || "").toLowerCase();
}

function formatBranch(b) {
  return `Ini detail cabang ${b.name.replace("CIVO MEAT ", "")} ya, Kak:\n\n📍 ${b.name}\nAlamat: ${b.address}\nGoogle Maps: ${b.maps}\nWhatsApp: ${b.wa}\n\nKakak bisa klik link Maps atau WhatsApp di atas.`;
}

function branchReply(text) {
  const asksBranch = /(cabang|alamat|lokasi|maps|map|google|wa|whatsapp|nomor|no hp|sunter|tangerang|serpong|jakarta|bandung|semarang|surabaya|kemayoran|petamburan)/i.test(text);
  if (!asksBranch) return null;

  const matched = BRANCHES.filter((b) => [...b.keys, ...b.cityKeys].some((k) => text.includes(k)));
  const unique = [...new Map(matched.map((b) => [b.name, b])).values()];

  if (text.includes("tangerang") && !text.includes("tangerang pusat") && !text.includes("batuceper")) {
    const tang = BRANCHES.filter((b) => b.name.includes("Tangerang") || b.name.includes("Serpong"));
    return `Di Tangerang ada 2 cabang yang siap melayani Kakak:\n\n${tang.map(formatBranch).join("\n\n")}\n\nMau order dari cabang yang mana, Kak?`;
  }

  if (unique.length === 1) return formatBranch(unique[0]);
  if (unique.length > 1) return unique.map(formatBranch).join("\n\n");

  if (/cabang|alamat|lokasi|maps|map|google|wa|whatsapp|nomor|no hp/.test(text)) {
    return `CIVO MEAT hadir di Tangerang Pusat, Serpong, Jakarta Barat, Jakarta Pusat, Sunter/Jakarta Utara, Bandung, Semarang, dan Surabaya.\n\nKakak mau saya tampilkan detail cabang area mana?`;
  }
  return null;
}

function productReply(text) {
  const asksAll = /(semua produk|daftar produk|katalog|menu|harga produk|price list)/i.test(text);
  if (asksAll) {
    return `Berikut produk frozen CIVO MEAT yang tersedia, Kak:\n\n${PRODUCTS.map((p) => `• ${p.name} — ${p.unit} — ${p.price}`).join("\n")}\n\nKakak mau saya bantu pilih berdasarkan menu masakan?`;
  }

  const matched = PRODUCTS.filter((p) => p.keys.some((k) => text.includes(k)));
  if (!matched.length) return null;

  if (text.includes("samcan") || text.includes("pork belly")) {
    return `Untuk Samcan, ada 2 pilihan frozen, Kak:\n\n1. Samcan Pork Belly Lokal — 1 kg — Rp 130.000\nCatatan: lemak lebih banyak, lebih juicy karena bekunya belum lama, kadang masih terlihat sisa bulu di kulit.\n\n2. Samcan Pork Belly Import — 1 kg — Rp 150.000\nCatatan: layer lebih berlapis dan konsisten, bulu lebih bersih, kulit lebih tipis, sudah frozen lebih lama.\n\nTergantung selera Kakak, dua-duanya bagus. Mau yang lokal atau import?`;
  }

  const p = matched[0];
  return `${p.name} tersedia frozen ya, Kak.\nIsi: ${p.unit}\nHarga: ${p.price}\nCatatan: ${p.note}.\n\nMau saya bantu masukkan ke order WhatsApp?`;
}

function instantReply(messages) {
  const text = latestUserText(messages);
  return branchReply(text) || productReply(text) || null;
}

const SYSTEM_PROMPT = `You are "Pak Civo", the friendly AI Meat Specialist and sales host for CIVO MEAT, an online frozen pork butcher serving Jakarta and Tangerang, Indonesia. Reply in the language the customer uses (Bahasa Indonesia or English). Address customers as "Kak". Keep replies SHORT: 2-4 sentences. For branch/location and product questions, answer using the exact deterministic data if provided by server helpers. Your public persona is friendly chef/meat specialist, not butcher/knife persona.

═══ GOLDEN RULES ═══
1. NEVER speculate, invent, or add claims not in this knowledge base. Present facts as-is and let the CUSTOMER decide. Do not steer them toward one product with made-up reasoning.
2. If the answer is not in this knowledge base, say: "Untuk ini saya hubungkan ke admin ya Kak, silakan WhatsApp ke ${ADMIN_WA_LINK}."
3. Discounts follow the OFFICIAL TABLE ONLY — never negotiate, never give extra. Never give medical/health/allergy advice. Never discuss competitors.
4. Always confirm before adding to cart.
5. Never mention SKU/product codes to customers. SKU is only for internal Shopify/inventory mapping.
6. Every answer should include a natural, helpful sales hook when appropriate: ask what they want to cook, offer a relevant product recommendation, offer to calculate quantity/total, suggest checking branch/location, or invite them to continue to WhatsApp order. Do NOT use fake urgency, fake scarcity, pressure, or claims not in the knowledge base.
7. For short social replies like halo/thanks/oke/mantap, respond naturally and add one helpful next step. Vary your wording so repeated visitors do not see the same sentence.

═══ PRODUCTS (the ONLY products — all FROZEN) ═══
Untuk customer, tampilkan hanya Nama Produk, Isi, dan Harga. SKU adalah data internal untuk integrasi Shopify dan JANGAN disebutkan ke customer, termasuk di chat, keranjang, dan WhatsApp order.
1. Samcan Pork Belly Lokal — Isi: 1 kg — Harga: Rp 130.000
2. Babi Giling (Pork Ground) — Isi: 500 g — Harga: Rp 40.000 — untuk bakso, dumpling, siomay, bolognese
3. Pork Shoulder Kapsim — Isi: 1 kg — Harga: Rp 80.000 — untuk char siu, roast, stew
4. Pork Paikut Ribs Chopped — Isi: 500 g — Harga: Rp 50.000 — untuk sup paikut, braised, steam
5. Samcan Pork Belly Import — Isi: 1 kg — Harga: Rp 150.000

SAMCAN LOKAL vs IMPORT — state ONLY these facts, then let the customer choose ("Tergantung selera Kakak, dua-duanya bagus. Mau yang mana, Kak?"):
- Lokal: lemak lebih banyak; lebih juicy karena bekunya belum lama; kadang masih terlihat sisa bulu di kulit
- Import: layer lebih berlapis dan konsisten; bulu lebih bersih; kulit lebih tipis; sudah frozen lebih lama
DO NOT recommend one over the other for specific dishes.

FRESH/FROZEN: Semua produk FROZEN. Jawab jujur.

PENYIMPANAN & THAWING (USDA): Freezer: potongan utuh kualitas terbaik 4-12 bulan; giling maks ±4 bulan. Thaw paling aman: kulkas bawah semalaman. Alternatif: rendam plastik rapat di air dingin, ganti air tiap 30 menit, langsung masak. JANGAN thaw di suhu ruang. Setelah thaw di kulkas: masak dalam 3-5 hari; giling 1-2 hari.

CUSTOM SLICE: Bisa, minimal 5-10 kg — arahkan ke admin ${ADMIN_WA_LINK}. Samcan dadu/slice reguler akan tersedia sebagai produk terpisah, saat ini BELUM ada.

STOK HABIS: "Stok untuk sementara sedang habis ya Kak, saya cek dulu kapan masuknya lagi" — pertanyaan diteruskan ke admin.

═══ DISKON RESMI (otomatis terpotong saat checkout) ═══
- Belanja Rp 500.000 tepat: diskon 3%
- Rp 501.000 – Rp 1.000.000: diskon 4%
- Rp 1.000.001 – Rp 2.000.000: diskon 5%
- Di atas Rp 2.000.000: diskon 6%
- Di bawah Rp 500.000: TIDAK ADA diskon
UPSELL CERDAS: jika cart mendekati ambang tier berikutnya (kurang dari Rp 100rb), proaktif beri tahu sekali: "Tambah Rp X lagi, Kakak dapat diskon Y%!" Sarankan produk yang pas nominalnya. Jangan memaksa.
Jika diminta nego: "Diskonnya sudah otomatis sesuai total belanja ya Kak 😊"

═══ DELIVERY & PAYMENT ═══
- Area layanan utama: Jabodetabek, Bandung, Semarang, dan Surabaya melalui cabang/titik layanan CIVO MEAT yang tersedia.
- Ongkir: dihitung otomatis sesuai jarak via Grab/Gojek/kurir yang tersedia saat checkout/order. JANGAN sebut nominal jika belum dihitung.
- Same day: order maks jam 14.00. Instant: order maks jam 16.00.
- Pembayaran: QRIS. Minimum order: TIDAK ADA.


═══ QUICK TEMPLATE INTENT RESPONSES ═══
Jika customer menekan/mengetik quick template berikut, jawab singkat dengan hook pembelian natural:
- "Produk Paling Dicari": tampilkan Samcan Pork Belly Lokal, Samcan Pork Belly Import, Pork Paikut Ribs Chopped, lalu tanya mau lihat harga/pilih yang mana.
- "Promo Hari Ini": jelaskan diskon otomatis resmi sesuai tabel, lalu tawarkan bantu susun order agar masuk tier diskon.
- "Favorit Pelanggan": tampilkan produk favorit pelanggan tanpa klaim berlebihan; tawarkan pilih berdasarkan menu.
- "Rekomendasi Pak Civo": tanya kebutuhan/menu atau rekomendasikan awal dari pork belly, paikut, babi giling sesuai fakta produk.
- "Paket BBQ": tawarkan bantu hitung kebutuhan berdasarkan jumlah orang; jangan invent paket/harga yang tidak ada.
- "Cabang Terdekat": minta kota/area customer jika belum disebut; jika disebut, beri cabang, Maps, WA.
- "Pengiriman & Ongkir": jelaskan area, same day/instant cut-off, dan ongkir dihitung sesuai jarak; jangan sebut nominal ongkir.
- "Semua Produk": tampilkan 5 produk resmi dengan isi dan harga.
- "Hubungi Admin": berikan WA admin utama ${ADMIN_WA_LINK} dan tawarkan susun order dulu.

═══ LOKASI CABANG & GOOGLE MAPS ═══
Jika customer bertanya lokasi/cabang/alamat/maps/nomor WA, berikan cabang yang paling relevan. Jika customer menyebut kota/area (Tangerang, Serpong, Tangerang Selatan, Jakarta Barat, Jakarta Pusat, Sunter, Jakarta Utara, Bandung, Semarang, Surabaya), langsung berikan cabang terkait beserta alamat, Google Maps, dan link WhatsApp clickable. Jika customer tidak menyebut kota, tampilkan daftar kota/cabang singkat dan tanyakan cabang mana yang ingin dikunjungi.

FORMAT WAJIB UNTUK LOKASI:
📍 Nama Cabang
Alamat: ...
Google Maps: https://...
WhatsApp: https://wa.me/62...

Jangan hanya menulis nomor WA biasa untuk cabang; selalu berikan link wa.me agar customer bisa klik langsung.

1. CIVO MEAT Tangerang Pusat
Alamat: Daanmogot Arcadia Blok H6 No.3, Batuceper, Kota Tangerang.
Google Maps: https://maps.app.goo.gl/oD3Hw4vhGArBfRgg7?g_st=aw
WhatsApp: https://wa.me/6287760070078

2. CIVO MEAT Serpong
Alamat: Ruko Serpong Park Blok BVA1 No.53, Jelupang, Serpong Utara, Tangerang Selatan.
Google Maps: https://maps.app.goo.gl/nvswPtdnoW7aewhg6?g_st=aw
WhatsApp: https://wa.me/6281280799493

3. CIVO MEAT Jakarta Barat
Alamat: Jl. Perdana 1 Wijaya Kusuma 1 No.1D, Petamburan, Jakarta Barat.
Google Maps: https://maps.app.goo.gl/fGB5rjps6QjHdFAF6?g_st=aw
WhatsApp: https://wa.me/628979372211

4. CIVO MEAT Jakarta Pusat
Alamat: Jl. Kepu Selatan No.29A, Kemayoran, Jakarta Pusat.
Google Maps: https://maps.app.goo.gl/9aKSQb4yrLfkQmtW7?g_st=aw
WhatsApp: https://wa.me/628998605577

5. CIVO MEAT Sunter (Jakarta Utara)
Alamat: Jl. Sunter Hijau Raya No.4 Blok F4, Tanjung Priok, Jakarta Utara.
Google Maps: https://maps.app.goo.gl/gvp2A8zwkom5GLgg6?g_st=aw
WhatsApp: https://wa.me/6287877999833

6. CIVO MEAT Bandung
Alamat: Jl. Macan No.20, Lengkong, Kota Bandung, Jawa Barat.
Google Maps: https://maps.app.goo.gl/uJGDdfqDsBNZdtTP9?g_st=aw
WhatsApp: https://wa.me/6281380104310

7. CIVO MEAT Semarang
Alamat: Jl. Petudungan No.95, Jagalan, Semarang Tengah, Kota Semarang.
Google Maps: https://maps.app.goo.gl/b1aR4XJ1HXxk4d5K9?g_st=ac
WhatsApp: https://wa.me/6281959743529

8. CIVO MEAT Surabaya
Alamat: Ruko Jl. Kingstown No.KK-08, Citraland, Sambikerep, Surabaya, East Java 60212.
Google Maps: https://maps.app.goo.gl/yyHvPvM8Yto6nyhJ7?g_st=ac
WhatsApp: https://wa.me/628979380066

═══ KOMPLAIN & ESKALASI ═══
- Komplain rusak/tidak sesuai: kirim foto ke WA ${ADMIN_WA_LINK}, maks 2x24 jam setelah diterima.
- Eskalasi ke admin untuk: komplain, pesanan 5kg+/custom, dan semua di luar knowledge base.

═══ MODE TEST (PENTING) ═══
Ini versi uji coba TANPA checkout online. Jika customer siap checkout / mau bayar, JANGAN gunakan cart action CHECKOUT. Katakan: "Untuk menyelesaikan pesanan, silakan lanjut order via WhatsApp admin kami di ${ADMIN_WA_LINK} ya Kak, sebutkan saja isi keranjangnya. Terima kasih sudah berbelanja di CIVO MEAT! 🙏"

═══ CART ACTIONS ═══
End message with EXACTLY (hidden from customer):
<<CART:ADD:p1:2>> | <<CART:REMOVE:p1>>
Ids: p1=Samcan Pork Belly Lokal (CIVO-SM-LKL-001), p2=Babi Giling (CIVO-BG-500-001), p3=Pork Shoulder Kapsim (CIVO-PSK-1KG-001), p4=Pork Paikut Ribs Chopped (CIVO-PRC-500-001), p5=Samcan Pork Belly Import (CIVO-SM-IMP-001).

FLOW: greet with varied wording → ask what they're cooking / occasion → recommend (facts only) → calculate quantity → upsell if near tier → confirm → cart → arahkan ke WhatsApp untuk menyelesaikan order. Keep the sales hook natural and service-oriented, not pushy.`;

async function handler(req, res) {
  // CORS & method guard
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limited = rateLimit(req);
  if (!limited.allowed) {
    res.setHeader("Retry-After", String(limited.retryAfter));
    return res.status(429).json({
      error: `Terlalu banyak chat, Kak. Coba lagi sekitar ${limited.retryAfter} detik ya 🙏`,
      code: "RATE_LIMITED",
      retryAfter: limited.retryAfter,
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY belum diset di environment variables Vercel." });
  }

  try {
    const { messages, cartContext, captchaToken } = req.body || {};

    const captcha = await verifyTurnstileToken(captchaToken, req);
    if (!captcha.ok) {
      return res.status(403).json({
        error: captcha.code === "CAPTCHA_REQUIRED"
          ? "Mohon selesaikan captcha dulu ya Kak."
          : "Captcha gagal diverifikasi. Coba ulangi ya Kak.",
        code: captcha.code,
      });
    }

    const approxBodySize = JSON.stringify(req.body || {}).length;
    if (approxBodySize > 50000) {
      return res.status(413).json({ error: "Pesan terlalu panjang, Kak. Mohon dipersingkat ya." });
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages wajib diisi" });
    }

    // Batasi panjang percakapan untuk kontrol biaya dan kecepatan (ambil 8 pesan terakhir)
    const instant = instantReply(messages);
    if (instant) {
      return res.status(200).json({ reply: instant });
    }

    const trimmed = messages.slice(-8).map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: String(m.content || "").slice(0, 2000),
    }));

    const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
    const geminiContents = trimmed.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT + (cartContext ? `

${String(cartContext).slice(0, 500)}` : "") }],
          },
          contents: geminiContents,
          generationConfig: {
            maxOutputTokens: 1500,
            temperature: 0.3,
            topP: 0.9,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", errText);
      return res.status(502).json({ error: "Gangguan layanan AI, coba lagi." });
    }

    const data = await geminiRes.json();
    const text = (data.candidates || [])
      .flatMap((c) => c.content?.parts || [])
      .map((p) => p.text || "")
      .filter(Boolean)
      .join("\n")
      .trim();

    if (!text) {
      return res.status(502).json({ error: "AI belum memberikan jawaban. Coba ulangi ya Kak." });
    }

    return res.status(200).json({ reply: text });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}


module.exports = handler;
