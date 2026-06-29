// api/tts-live.js
// Streaming OpenAI TTS endpoint for lower perceived latency.
// Browser can play this URL directly, so it does not wait for the whole MP3 blob first.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
module.exports.config = { maxDuration: 20 };

const _rateMap = new Map();
function getIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || req.socket?.remoteAddress
    || "unknown";
}
function checkRateLimit(req) {
  const ip = getIp(req);
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 45;
  const old = _rateMap.get(ip);
  if (!old || now - old.start > windowMs) {
    _rateMap.set(ip, { count: 1, start: now });
    return true;
  }
  old.count += 1;
  return old.count <= maxRequests;
}
function cleanupRateMap() {
  const now = Date.now();
  for (const [ip, entry] of _rateMap.entries()) {
    if (now - entry.start > 120000) _rateMap.delete(ip);
  }
}

function cleanSpaces(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeForSpeech(text) {
  let t = cleanSpaces(text);
  t = t.replace(/[\u{1F300}-\u{1FAFF}]/gu, " ");
  t = t.replace(/[\u{2600}-\u{27BF}]/gu, " ");
  t = t.replace(/https?:\/\/\S+/gi, " ");
  t = t.replace(/<<CART:[^>]+>>/g, " ");
  t = t.replace(/\*\*|\*|_/g, " ");
  t = t.replace(/\bCIVO MEAT\b/gi, "Sivo Mit");
  t = t.replace(/\bCIVO\b/gi, "Sivo");
  t = t.replace(/\bWA\b/gi, "WhatsApp");
  t = t.replace(/\bBBQ\b/gi, "barbekyu");
  t = t.replace(/\bSamcan\b/gi, "Sam-can");
  t = t.replace(/\bSamgyeopsal\b/gi, "Sam-gyeop-sal");
  t = t.replace(/\bSkin Off\b/gi, "skin off");
  t = t.replace(/\bSkin On\b/gi, "skin on");
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*rb\b/gi, (_, n) => `${String(n).replace(",", " koma ")} ribu rupiah`);
  t = t.replace(/\bRp\.?\s*([0-9.]+)\b/gi, (_, n) => `${String(n).replace(/[.]/g, "")} rupiah`);
  t = t.replace(/\/\s*kg\b/gi, " per kilogram");
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*kg\b/gi, (_, n) => `${String(n).replace(",", " koma ")} kilogram`);
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*(g|gr)\b/gi, (_, n) => `${String(n).replace(",", " koma ")} gram`);
  t = t.replace(/[<>|]/g, " ");
  return cleanSpaces(t).slice(0, 320);
}

function getQueryText(req) {
  const url = new URL(req.url || "/", `https://${req.headers.host || "localhost"}`);
  return url.searchParams.get("text") || "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  cleanupRateMap();
  if (!checkRateLimit(req)) {
    return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ ok: false, error: "OPENAI_API_KEY belum dikonfigurasi." });
  }

  const rawText = getQueryText(req);
  const speechText = normalizeForSpeech(rawText);
  if (!speechText) {
    return res.status(400).json({ ok: false, error: "Teks kosong." });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);

  try {
    const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || "tts-1",
        input: speechText,
        voice: process.env.OPENAI_TTS_VOICE || "onyx",
        response_format: "mp3",
        speed: Number(process.env.OPENAI_TTS_SPEED || 1.08),
      }),
      signal: controller.signal,
    });

    if (!ttsRes.ok || !ttsRes.body) {
      const errText = await ttsRes.text().catch(() => "");
      console.error("OpenAI streaming TTS error:", ttsRes.status, errText);
      clearTimeout(timeout);
      return res.status(502).json({ ok: false, error: "Gagal streaming suara." });
    }

    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-TTS-Mode": "stream",
    });

    const reader = ttsRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        res.write(Buffer.from(value));
      }
    }
    clearTimeout(timeout);
    return res.end();
  } catch (error) {
    clearTimeout(timeout);
    console.error("TTS live handler error:", error);
    if (!res.headersSent) {
      return res.status(500).json({ ok: false, error: "Server error." });
    }
    try { return res.end(); } catch (_) {}
  }
};
