// api/warmup.js
// Dipanggil oleh Vercel Cron 1x/hari
// Tujuan: keep /api/tts dan /api/chat warm, pre-cache audio greeting

module.exports = async function handler(req, res) {
  const results = {};
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(200).json({ ok: false, reason: "no key" });

    // Warm TTS + chat paralel
    const [ttsRes, chatRes] = await Promise.all([
      fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1",
          input: "Halo, selamat datang di CIVO MEAT.",
          voice: "onyx",
          response_format: "mp3",
          speed: 1.08,
        }),
      }),
      // Self-ping chat function
      fetch(`${process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "http://localhost:3000"}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "halo" }], cartContext: "" }),
      }).catch(() => null),
    ]);

    results.tts = ttsRes.ok;
    results.chat = chatRes?.ok ?? false;

    return res.status(200).json({ ok: true, results, time: new Date().toISOString() });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message, results });
  }
};
