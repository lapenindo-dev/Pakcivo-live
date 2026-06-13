// api/tts.js
// Vercel Serverless Function — ElevenLabs TTS dengan streaming
// Audio langsung diputar sambil diterima, mengurangi delay

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    return res.status(500).json({ error: "ElevenLabs belum dikonfigurasi." });
  }

  try {
    const { text } = req.body;
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "Teks tidak boleh kosong." });
    }

    // Bersihkan emoji, URL, dan karakter non-verbal
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

    const ttsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          "Accept": "audio/mpeg",
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
          // Optimasi: kirim audio lebih cepat dengan chunk lebih kecil
          optimize_streaming_latency: 3,
        }),
      }
    );

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error("ElevenLabs error:", ttsRes.status, errText);
      return res.status(502).json({ error: "Gagal generate suara." });
    }

    // Stream langsung ke browser — tidak buffer semua dulu
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
