// api/tts.js
// Vercel Serverless Function — OpenAI TTS
// Lebih murah & lebih cepat dari ElevenLabs

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY belum dikonfigurasi di Vercel." });
  }

  try {
    const { text } = req.body;
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "Teks tidak boleh kosong." });
    }

    // Bersihkan emoji, URL, markdown, dan karakter non-verbal
    const cleanText = text
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
      .replace(/[\u{2600}-\u{27BF}]/gu, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/<<CART:[^>]+>>/g, "")
      .replace(/\*\*/g, "")
      .replace(/\*/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (cleanText.length === 0) {
      return res.status(400).json({ error: "Teks kosong setelah dibersihkan." });
    }

    // Batasi max 4096 karakter (limit OpenAI TTS)
    const trimmed = cleanText.slice(0, 4096);

    const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",        // tts-1 = latency rendah, tts-1-hd = kualitas lebih tinggi
        input: trimmed,
        voice: "onyx",         // dalam, berwibawa — cocok untuk Pak Civo
        response_format: "mp3",
        speed: 1.0,
      }),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error("OpenAI TTS error:", ttsRes.status, errText);
      return res.status(502).json({ error: "Gagal generate suara dari OpenAI." });
    }

    // Stream langsung ke browser
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Transfer-Encoding", "chunked");

    const reader = ttsRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();

  } catch (err) {
    console.error("TTS handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Server error." });
    }
  }
};
