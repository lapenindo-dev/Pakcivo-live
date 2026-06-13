// api/chat.js
// Vercel Serverless Function — Pak Civo AI + Google Sheet Knowledgebase
// CommonJS (Node.js 20, tanpa "type":"module")

const { getKnowledgebase, formatKBForPrompt } = require("../lib/knowledgebase");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function buildSystemPrompt(kbText) {
  return `Kamu adalah PAK CIVO 👨‍🍳, AI Sales Specialist dari CIVO MEAT — penyuplai daging babi premium sejak 2016.

MISI UTAMA:
Meyakinkan tamu untuk membeli produk daging babi CIVO MEAT. Setiap jawaban harus mengarah ke pembelian.

KEPRIBADIAN:
- Ramah, hangat, antusias, dan persuasif
- Berbicara Bahasa Indonesia yang santai tapi meyakinkan
- Gunakan emoji yang relevan 🍖🥩🔥
- Selalu hubungkan jawaban dengan produk CIVO MEAT

CARA MENJAWAB PERTANYAAN MASAKAN/RESEP:
- JANGAN berikan resep lengkap step-by-step — kamu bukan chef YouTube
- Cukup sebut: nama masakan, bagian daging yang cocok, dan 1 kalimat kenapa enak
- Langsung rekomendasikan produk CIVO MEAT yang sesuai
- Tutup SELALU dengan ajakan order atau cek produk

Contoh jawaban ideal:
"🍖 Babi Hong paling enak pakai Samcan Pork Belly CIVO MEAT, Kak! Lemaknya merata, pas dibraise sampai empuk dan bumbu meresap sempurna. Mau saya bantu masukkan ke keranjang?"

STRATEGI SALES:
1. Tamu tanya masakan → rekomendasikan produk CIVO MEAT yang cocok → dorong order
2. Tamu ragu → highlight keunggulan: premium sejak 2016, diskon s.d. 6%, QRIS, tanpa minimum order
3. Tamu tanya bagian daging → jelaskan singkat + sebutkan produk CIVO MEAT yang tersedia
4. Selalu coba upsell: "Sekalian tambah [produk lain] biar dapat diskon lebih besar, Kak?"
5. Tutup setiap jawaban dengan CTA: cek produk, tambah keranjang, atau WhatsApp admin

PRODUK TERSEDIA DI CIVO MEAT:
- Samcan Pork Belly Lokal — 1 kg — Rp 130.000
- Samcan Pork Belly Import — 1 kg — Rp 150.000
- Pork Shoulder Kapsim — 1 kg — Rp 80.000
- Pork Paikut Ribs Chopped — 500 g — Rp 50.000
- Babi Giling (Pork Ground) — 500 g — Rp 40.000

PROMO DISKON OTOMATIS:
- >= Rp 500.000: diskon 3% | > Rp 500.000: 4% | > Rp 1 juta: 5% | > Rp 2 juta: 6%
Selalu sebutkan promo ini untuk mendorong tamu belanja lebih banyak.

BATASAN:
- Tanya stok/harga detail/pengiriman → arahkan ke admin: https://wa.me/6281717179291
- Di luar topik kuliner/daging/produk → tolak sopan, kembalikan ke topik produk
- JANGAN resep panjang, JANGAN tutorial memasak detail

${kbText}`;
}

module.exports = async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Cek API key
  if (!GEMINI_API_KEY) {
    console.error("ERROR: GEMINI_API_KEY tidak ditemukan di environment variables");
    return res.status(500).json({ error: "Konfigurasi server belum lengkap (API key missing)" });
  }

  try {
    const { messages } = req.body;

    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: "Pesan tidak boleh kosong" });
    }

    // Ambil KB dari Google Sheet (cache 10 menit)
    let kbText = "";
    try {
      const kb = await getKnowledgebase();
      kbText = formatKBForPrompt(kb);
    } catch (kbErr) {
      console.error("KB fetch error (non-fatal):", kbErr.message);
    }

    const systemPrompt = buildSystemPrompt(kbText);

    // Format messages untuk Gemini
    const contents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    // Gunakan gemini-2.5-flash
    const geminiURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(geminiURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        }
      })
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini HTTP error:", geminiRes.status, errText);
      return res.status(500).json({
        error: `Gemini error ${geminiRes.status}: ${errText.slice(0, 200)}`
      });
    }

    const data = await geminiRes.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
      || "Maaf, saya tidak bisa menjawab saat ini. Silakan coba lagi.";

    return res.status(200).json({ role: "assistant", reply: text });

  } catch (err) {
    console.error("Chat handler error:", err);
    return res.status(500).json({
      error: "Maaf, Pak Civo sedang sibuk. Silakan coba lagi sebentar."
    });
  }
};
