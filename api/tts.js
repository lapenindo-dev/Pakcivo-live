// api/tts.js
// Vercel Serverless Function — ElevenLabs Text-to-Speech proxy
// Menerima teks dari frontend, return audio stream dari ElevenLabs

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID) {
    return res.status(500).json({ error: "ElevenLabs API key atau Voice ID belum dikonfigurasi." });
  }

  try {
    const { text } = req.body;
    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "Teks tidak boleh kosong." });
    }

    // Bersihkan emoji & karakter non-verbal sebelum dikirim ke TTS
    const cleanText = text
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, "") // hapus emoji
      .replace(/https?:\/\/\S+/g, "")          // hapus URL
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
        }),
      }
    );

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error("ElevenLabs error:", ttsRes.status, errText);
      return res.status(502).json({ error: "Gagal generate suara dari ElevenLabs." });
    }

    // Stream audio langsung ke frontend
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-cache");

    const buffer = await ttsRes.arrayBuffer();
    return res.status(200).send(Buffer.from(buffer));

  } catch (err) {
    console.error("TTS handler error:", err);
    return res.status(500).json({ error: "Server error saat generate suara." });
  }
};
