// api/warmup.js
// Dipanggil setiap 5 menit oleh Vercel Cron
// Tujuan: keep function /api/tts tetap warm agar tidak cold start

module.exports = async function handler(req, res) {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) return res.status(200).json({ ok: false, reason: "no key" });

    // Ping OpenAI TTS dengan teks sangat pendek
    await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: "halo",
        voice: "onyx",
        response_format: "mp3",
      }),
    });

    return res.status(200).json({ ok: true, time: new Date().toISOString() });
  } catch (e) {
    return res.status(200).json({ ok: false, error: e.message });
  }
};
