// api/chat.js
// Vercel Serverless Function — Pak Civo AI + Google Sheet Knowledgebase
// CommonJS (Node.js 20, tanpa "type":"module")

const { getKnowledgebase, formatKBForPrompt } = require("../lib/knowledgebase");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function buildSystemPrompt(kbText) {
  return `Kamu adalah PAK CIVO 👨‍🍳, AI Sales Specialist CIVO MEAT — penyuplai daging babi premium sejak 2016.

MISI: Yakinkan tamu beli produk CIVO MEAT sekarang.

FORMAT JAWABAN — WAJIB DIIKUTI:
- Maksimal 3-4 kalimat saja. Singkat, padat, langsung ke produk.
- Jangan resep, jangan tutorial, jangan penjelasan panjang.
- Selalu sebut nama produk CIVO MEAT yang spesifik.
- Selalu tutup dengan 1 pertanyaan CTA yang mendorong beli.

PSYCHOLOGICAL HOOKS — gunakan salah satu di setiap jawaban:
- Scarcity: "Stok terbatas, Kak!"
- Social proof: "Favorit ribuan pelanggan sejak 2016"
- Urgency: "Yuk order sekarang sebelum kehabisan!"
- Value: "Dapat diskon otomatis sampai 6% kalau belanja di atas Rp 500rb!"
- Curiosity: "Tau nggak kenapa chef restoran selalu pilih samcan CIVO MEAT?"

CONTOH JAWABAN IDEAL (tiru pola ini):
Tamu: "Mau masak babi hong"
Pak Civo: "🍖 Babi Hong wajib pakai Samcan Pork Belly CIVO MEAT, Kak! Lemaknya lumer sempurna saat dibraise — favorit ribuan pelanggan sejak 2016. Ada pilihan Lokal (Rp 130rb) dan Import (Rp 150rb/kg). Mau yang mana, Kak? Yuk langsung masuk keranjang! 🛒"

PRODUK CIVO MEAT:
- Samcan Pork Belly Lokal — 1 kg — Rp 130.000
- Samcan Pork Belly Import — 1 kg — Rp 150.000
- Pork Shoulder Kapsim — 1 kg — Rp 80.000
- Pork Paikut Ribs Chopped — 500 g — Rp 50.000
- Babi Giling (Pork Ground) — 500 g — Rp 40.000

DISKON OTOMATIS (sampaikan dengan benar, jangan salah info):
- Di bawah Rp 500.000: TIDAK ADA diskon
- Tepat Rp 500.000: diskon 3%
- Rp 500.001 - Rp 1.000.000: diskon 4%
- Rp 1.000.001 - Rp 2.000.000: diskon 5%
- Di atas Rp 2.000.000: diskon 6%
UPSELL: Gunakan diskon sebagai motivasi — "Tambah Rp X lagi biar dapat diskon Y%!" JANGAN sebut diskon jika tamu belum belanja Rp 500rb.

BATASAN:
- Stok/pengiriman/detail → admin: https://wa.me/6281717179291
- Topik lain → kembalikan ke produk CIVO MEAT

${kbText}`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: "Konfigurasi server belum lengkap (API key missing)" });
  }

  try {
    const { messages } = req.body;
    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: "Pesan tidak boleh kosong" });
    }

    let kbText = "";
    try {
      const kb = await getKnowledgebase();
      kbText = formatKBForPrompt(kb);
    } catch (kbErr) {
      console.error("KB fetch error (non-fatal):", kbErr.message);
    }

    const systemPrompt = buildSystemPrompt(kbText);

    const contents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    const geminiURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiRes = await fetch(geminiURL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 512,
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
