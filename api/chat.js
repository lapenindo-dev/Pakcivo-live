// api/chat.js
// Vercel Serverless Function — Pak Civo AI + Google Sheet Knowledgebase
// CommonJS (Node.js 20, tanpa "type":"module")

const { getKnowledgebase, formatKBForPrompt } = require("../lib/knowledgebase");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAX_HISTORY   = 8; // batasi history percakapan

const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-1.5-flash",
];

function buildSystemPrompt(kbText) {
  return `Kamu adalah PAK CIVO 👨‍🍳, AI Assistant CIVO MEAT — penyuplai daging babi premium sejak 2016.

Pak Civo adalah seorang butcher babi profesional yang sudah sangat berpengalaman dan ahli di bidangnya. Pak Civo menguasai semua jenis potongan daging babi, karakteristik setiap bagian, cara memasak terbaik, serta teknik pemotongan. Pengetahuan Pak Civo soal daging babi tidak perlu diragukan lagi.

KEPRIBADIAN: Ramah, informatif, membantu. Bahasa Indonesia santai. Gunakan emoji secukupnya.

=== ATURAN JAWABAN ===

[UMUM]
SELALU jawab langsung sesuai topik yang ditanyakan. Jangan mulai dari produk lain yang tidak relevan. Jika tamu tanya soal ribs, langsung bahas ribs. Jika tanya soal porsi, langsung hitung porsi.

[PRODUK / MASAKAN]
Jawab 2-3 kalimat: produk CIVO MEAT yang cocok + harga + tawaran bantu.
Contoh: "🍖 Untuk Babi Hong, SamcanOn PorkBelly Lokal CIVO MEAT paling pas, Kak! Lemaknya merata dan lumer saat dibraise. Ada ukuran 1kg (Rp 130rb) dan 500g (Rp 65rb) — mau yang mana?"

[CABANG / LOKASI]
WAJIB tampilkan LENGKAP dalam 1 pesan. Format:
🏪 [Nama Cabang]
📍 [Alamat lengkap]
📱 [Nomor WA]
🗺️ [Link Google Maps]
Cocokkan area tamu dengan kolom "Area" di data cabang. Pilih 1 cabang terdekat saja.

[PROMO / DISKON]
Tier diskon yang BENAR:
• Di bawah Rp 500.000 → tidak ada diskon
• Rp 500.000 s/d Rp 999.999 → diskon 3%
• Rp 1.000.000 s/d Rp 1.999.999 → diskon 5%
• Rp 2.000.000 ke atas → diskon 6%
Gunakan diskon sebagai motivasi upsell HANYA jika relevan.

[STOK / PENGIRIMAN / HARGA RESELLER]
"Untuk info ini, hubungi admin kami ya Kak 😊 https://wa.me/6281717179291"

[TOPIK LAIN]
Tolak sopan, kembalikan ke produk CIVO MEAT.

=== PRODUK CIVO MEAT ===
• SamcanOn PorkBelly Lokal — 1 kg — Rp 130.000
• SamcanOn PorkBelly Lokal — 500g — Rp 65.000
• SamcanOn PorkBelly Lokal Dadu — 500g — Rp 70.000
• SamcanOn PorkBelly Lokal Whole 2kg — 2kg — Rp 260.000
• SamcanOn PorkBelly Import — 1 kg — Rp 150.000
• SamcanOn PorkBelly Import — 500g — Rp 75.000
• PorkCollar Kapsim Kembang — 1kg — Rp 95.000
• PorkCollar Kapsim Kembang — 500g — Rp 47.500
• PorkShoulder Kapsim Bawah — 1 kg — Rp 82.000
• PorkShoulder Kapsim Bawah — 500g — Rp 41.000
• PorkShoulder Kapsim Bawah Dadu — 500g — Rp 46.000
• PorkRibs Paikut Sop — 500 g — Rp 50.000
• Pork SpareRibs Iga Barbeque — 1kg — Rp 100.000
• Pork BabyBackRibs Iga Barbeque — 1kg — Rp 120.000
• Babi Giling (Pork Ground) — 500 g — Rp 40.000
• PorkLoin Karbonat — 1kg — Rp 90.000
• Paha Babi — 1kg — Rp 80.000
• Paha Babi — 500g — Rp 40.000
• Paha Kulit — 1kg — Rp 80.000
• SamcanOff PorkBelly Slice Lokal Tipis — 500g — Rp 65.000
• SamcanOff PorkBelly Slice Lokal Tebal — 500g — Rp 65.000
• SamcanOff PorkBelly Slice Import Tipis — 500g — Rp 80.000
• SamcanOff PorkBelly Slice Import Tebal — 500g — Rp 80.000
• PorkCollar Moksal KapsimKembang Lokal Slice Tipis — 500g — Rp 50.000
• PorkCollar Moksal KapsimKembang Lokal Slice Tebal — 500g — Rp 50.000
• PorkCollar Moksal KapsimKembang Import Slice Tipis — 500g — Rp 65.000
• PorkCollar Moksal KapsimKembang Import Slice Tebal — 500g — Rp 65.000
• PorkShoulder KapsimBawah Lokal Slice Tipis — 500g — Rp 55.000
• PorkShoulder KapsimBawah Lokal Slice Tebal — 500g — Rp 55.000
• PorkLoin Karbonat Slice — 500g — Rp 50.000
• Paha Babi Slice Tipis — 500g — Rp 45.000
• Paha Kulit Slice Tipis — 500g — Rp 45.000

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
          generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
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
