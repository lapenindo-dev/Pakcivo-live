// api/chat.js
// Vercel Serverless Function — Pak Civo AI + Google Sheet Knowledgebase
// CommonJS (Node.js 20, tanpa "type":"module")

const { getKnowledgebase, formatKBForPrompt } = require("../lib/knowledgebase");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAX_HISTORY   = 6; // batasi history percakapan

const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

function buildSystemPrompt(kbText) {
  return `Kamu adalah PAK CIVO 👨‍🍳, AI Assistant CIVO MEAT — penyuplai daging babi premium sejak 2016.

KEPRIBADIAN: Ramah, informatif, membantu. Bahasa Indonesia santai. Gunakan emoji secukupnya.

=== ATURAN JAWABAN ===

[PRODUK / MASAKAN]
Jawab 2-3 kalimat: produk CIVO MEAT yang cocok + harga + tawaran bantu.
Contoh: "🍖 Untuk Babi Hong, Samcan Pork Belly CIVO MEAT paling pas, Kak! Lemaknya merata dan lumer saat dibraise. Ada Lokal (Rp 130rb/kg) dan Import (Rp 150rb/kg) — mau yang mana?"

[CABANG / LOKASI]
WAJIB tampilkan LENGKAP dalam 1 pesan. Format:
🏪 [Nama Cabang]
📍 [Alamat lengkap]
📱 [Nomor WA]
🗺️ [Link Google Maps]
Cocokkan area tamu dengan kolom "Area" di data cabang. Pilih 1 cabang terdekat saja.

[PROMO / DISKON]
Tier diskon yang BENAR:
• Di bawah Rp 500rb → tidak ada diskon
• Tepat Rp 500rb → diskon 3%
• Rp 500.001–Rp 1jt → diskon 4%
• Rp 1jt–Rp 2jt → diskon 5%
• Di atas Rp 2jt → diskon 6%
Gunakan diskon sebagai motivasi upsell HANYA jika relevan.

[STOK / PENGIRIMAN / HARGA RESELLER]
"Untuk info ini, hubungi admin kami ya Kak 😊 https://wa.me/6281717179291"

[TOPIK LAIN]
Tolak sopan, kembalikan ke produk CIVO MEAT.

=== PRODUK CIVO MEAT ===
• Samcan Pork Belly Lokal — 1 kg — Rp 130.000
• Samcan Pork Belly Import — 1 kg — Rp 150.000
• Pork Shoulder Kapsim — 1 kg — Rp 80.000
• Pork Paikut Ribs Chopped — 500 g — Rp 50.000
• Babi Giling (Pork Ground) — 500 g — Rp 40.000

=== DATA LENGKAP ===
${kbText}`;
}

async function callGemini(systemPrompt, contents) {
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
        })
      });

      if (res.status === 503 || res.status === 429) {
        console.warn(`Model ${model} unavailable (${res.status}), trying next...`);
        continue;
      }
      if (!res.ok) {
        const errText = await res.text();
        console.error(`Model ${model} error ${res.status}:`, errText);
        continue;
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text;

    } catch (err) {
      console.error(`Model ${model} fetch error:`, err.message);
      continue;
    }
  }
  return null;
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: "Konfigurasi server belum lengkap." });
  }

  try {
    const { messages } = req.body;
    if (!messages || messages.length === 0) {
      return res.status(400).json({ error: "Pesan tidak boleh kosong" });
    }

    // Batasi history ke MAX_HISTORY pesan terakhir untuk hemat token
    const trimmedMessages = messages.slice(-MAX_HISTORY);

    let kbText = "";
    try {
      const kb = await getKnowledgebase();
      kbText = formatKBForPrompt(kb);
    } catch (kbErr) {
      console.error("KB fetch error (non-fatal):", kbErr.message);
    }

    const systemPrompt = buildSystemPrompt(kbText);
    const contents = trimmedMessages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    const text = await callGemini(systemPrompt, contents);

    if (!text) {
      return res.status(200).json({
        role: "assistant",
        reply: "Maaf Kak, Pak Civo sedang ramai 😅 Coba lagi sebentar ya, atau langsung hubungi admin di https://wa.me/6281717179291 🙏"
      });
    }

    return res.status(200).json({ role: "assistant", reply: text });

  } catch (err) {
    console.error("Chat handler error:", err);
    return res.status(200).json({
      role: "assistant",
      reply: "Maaf Kak, ada gangguan sebentar 🙏 Coba lagi ya, atau hubungi admin di https://wa.me/6281717179291"
    });
  }
};
