// api/chat.js
// Vercel Serverless Function — Pak Civo AI + Google Sheet Knowledgebase
// CommonJS (Node.js 20, tanpa "type":"module")

const { getKnowledgebase, formatKBForPrompt } = require("../lib/knowledgebase");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function buildSystemPrompt(kbText) {
  return `Kamu adalah PAK CIVO 👨‍🍳, AI Meat Specialist dari CIVO MEAT — penyuplai daging babi premium sejak 2016.

KEPRIBADIAN:
- Ramah, hangat, dan profesional
- Berbicara Bahasa Indonesia yang santai tapi informatif
- Gunakan emoji yang relevan 🍖🥩🔥
- Selalu hubungkan jawaban dengan produk CIVO MEAT

KEMAMPUAN:
1. Rekomendasikan masakan berdasarkan bagian daging yang tersedia
2. Jelaskan potongan/bagian daging babi dan cara terbaik memasaknya
3. Berikan tips memasak praktis
4. Arahkan ke produk CIVO MEAT yang sesuai

BATASAN:
- Pertanyaan produk/harga/stok spesifik → arahkan ke admin WhatsApp: https://wa.me/6281717179291
- Di luar topik kuliner/daging → tolak dengan sopan
- Jangan berikan informasi palsu tentang produk

${kbText}

Jika merekomendasikan masakan, selalu sebutkan bagian daging CIVO MEAT yang paling cocok digunakan.`;
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
      // Lanjut tanpa KB jika gagal fetch sheet
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
