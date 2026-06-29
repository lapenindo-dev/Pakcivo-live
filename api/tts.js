// api/tts.js
// Vercel Serverless Function — OpenAI TTS
// Text chat tetap normal, tapi teks suara dinormalisasi agar bahasa Indonesia lebih natural.
//
// PERBAIKAN LATENCY (lihat README-TTS-FIX.md):
// - Sebelumnya: server menunggu SELURUH audio dari OpenAI (arrayBuffer) lalu
//   kirim sekali jadi ke client; client juga menunggu SELURUH body (res.blob())
//   sebelum audio bisa diputar. Total = generation time + 2x full transfer.
// - Sekarang: support GET (untuk <audio src="..."> native progressive streaming)
//   dan response di-PIPE langsung dari OpenAI ke client per-chunk (tidak dibuffer
//   penuh dulu), supaya audio mulai bisa diputar browser begitu byte pertama datang.

const { Readable } = require("stream");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ── RATE LIMITER ─────────────────────────────────────────────
// Max 30 requests per IP per minute
const _rateMap = new Map();
function checkRateLimit(req) {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() 
    || req.headers["x-real-ip"] 
    || req.socket?.remoteAddress 
    || "unknown";
  
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 minute
  const maxRequests = 30;

  if (!_rateMap.has(ip)) {
    _rateMap.set(ip, { count: 1, start: now });
    return { allowed: true, ip };
  }

  const entry = _rateMap.get(ip);
  
  // Reset window if expired
  if (now - entry.start > windowMs) {
    _rateMap.set(ip, { count: 1, start: now });
    return { allowed: true, ip };
  }

  // Increment count
  entry.count++;

  if (entry.count > maxRequests) {
    console.warn(`Rate limit hit: ${ip} (${entry.count} req/min)`);
    return { allowed: false, ip, count: entry.count };
  }

  return { allowed: true, ip };
}

function cleanupRateMap() {
  const now = Date.now();
  for (const [ip, entry] of _rateMap.entries()) {
    if (now - entry.start > 120000) _rateMap.delete(ip);
  }
}
// ─────────────────────────────────────────────────────────────


module.exports.config = { maxDuration: 20 };

const _audioCache = new Map();
const MAX_CACHE_ITEMS = 80;
function getBody(req) {
  // GET (dipakai oleh <audio src="/api/tts?text=...">) → ambil dari query string
  if (req.method === "GET") {
    return {
      text: req.query?.text || "",
      mode: req.query?.mode || "sync",
    };
  }
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body;
}
function cacheGet(key) {
  const item = _audioCache.get(key);
  if (!item) return null;
  item.lastUsed = Date.now();
  return item.buffer;
}
function cacheSet(key, buffer) {
  if (!key || !buffer) return;
  if (_audioCache.size >= MAX_CACHE_ITEMS) {
    let oldestKey = null;
    let oldestTime = Infinity;
    for (const [k, v] of _audioCache.entries()) {
      if ((v.lastUsed || 0) < oldestTime) { oldestTime = v.lastUsed || 0; oldestKey = k; }
    }
    if (oldestKey) _audioCache.delete(oldestKey);
  }
  _audioCache.set(key, { buffer, lastUsed: Date.now() });
}
function makeCacheKey(text, voice, speed) {
  return Buffer.from(`${voice}|${speed}|${text}`).toString("base64").slice(0, 220);
}

function cleanDoubleSpaces(text) {
  return text.replace(/\s+/g, " ").trim();
}

function numberToWords(num) {
  num = parseInt(num || 0, 10);

  const angka = [
    "",
    "satu",
    "dua",
    "tiga",
    "empat",
    "lima",
    "enam",
    "tujuh",
    "delapan",
    "sembilan",
    "sepuluh",
    "sebelas",
  ];

  if (num === 0) return "nol";
  if (num < 12) return angka[num];
  if (num < 20) return cleanDoubleSpaces(numberToWords(num - 10) + " belas");
  if (num < 100) {
    const sisa = num % 10;
    return cleanDoubleSpaces(numberToWords(Math.floor(num / 10)) + " puluh" + (sisa ? " " + numberToWords(sisa) : ""));
  }
  if (num < 200) {
    const sisa = num - 100;
    return cleanDoubleSpaces("seratus" + (sisa ? " " + numberToWords(sisa) : ""));
  }
  if (num < 1000) {
    const sisa = num % 100;
    return cleanDoubleSpaces(numberToWords(Math.floor(num / 100)) + " ratus" + (sisa ? " " + numberToWords(sisa) : ""));
  }
  if (num < 2000) {
    const sisa = num - 1000;
    return cleanDoubleSpaces("seribu" + (sisa ? " " + numberToWords(sisa) : ""));
  }
  if (num < 1000000) {
    const sisa = num % 1000;
    return cleanDoubleSpaces(numberToWords(Math.floor(num / 1000)) + " ribu" + (sisa ? " " + numberToWords(sisa) : ""));
  }
  if (num < 1000000000) {
    const sisa = num % 1000000;
    return cleanDoubleSpaces(numberToWords(Math.floor(num / 1000000)) + " juta" + (sisa ? " " + numberToWords(sisa) : ""));
  }
  return num.toString();
}

function decimalToWords(value) {
  const str = String(value).replace(",", ".");
  if (!str.includes(".")) return numberToWords(parseInt(str, 10));

  const [whole, dec] = str.split(".");
  const decimalWords = dec.split("").map((d) => numberToWords(parseInt(d, 10))).join(" ");
  return cleanDoubleSpaces(`${numberToWords(parseInt(whole, 10))} koma ${decimalWords}`);
}

function normalizePhone(phone) {
  return phone.replace(/\D/g, "").split("").join(" ");
}

function normalizePlainNumber(raw) {
  const value = String(raw || "").trim();
  if (!value) return value;

  const digitsOnly = value.replace(/\D/g, "");
  if (digitsOnly.startsWith("0") && digitsOnly.length >= 8) return normalizePhone(value);

  if (/^\d{1,3}([.,]\d{3})+$/.test(value)) {
    const num = parseInt(value.replace(/\D/g, ""), 10);
    return Number.isFinite(num) ? numberToWords(num) : value;
  }

  if (/^\d+[.,]\d+$/.test(value)) return decimalToWords(value);

  const num = parseInt(digitsOnly, 10);
  return Number.isFinite(num) ? numberToWords(num) : value;
}

function normalizeForSpeech(text) {
  let t = text;

  t = t.replace(/https?:\/\/\S+/gi, "");
  t = t.replace(/www\.\S+/gi, "");
  t = t.replace(/<<CART:[^>]+>>/g, "");

  t = t.replace(/\*\*/g, "");
  t = t.replace(/\*/g, "");
  t = t.replace(/_/g, " ");

  t = t.replace(/\bCIVO MEAT\b/g, "Sivo Mit");
  t = t.replace(/\bCivo Meat\b/gi, "Sivo Mit");
  t = t.replace(/\bCIVO\b/g, "Sivo");
  t = t.replace(/\bCivo\b/g, "Sivo");
  t = t.replace(/\bcivo\b/g, "Sivo");
  t = t.replace(/\bSamcanOn\b/gi, "Sam-can On");
  t = t.replace(/\bSamcanOff\b/gi, "Sam-can Off");
  t = t.replace(/\bSAMCAN ON\b/g, "Sam-can On");
  t = t.replace(/\bSAMCAN OFF\b/g, "Sam-can Off");
  t = t.replace(/\bSAMCAN\b/g, "Sam-can");
  t = t.replace(/\bSamcan\b/gi, "Sam-can");
  t = t.replace(/\bSamgyeopsal\b/gi, "Sam-gyeop-sal");
  t = t.replace(/\bMoksal\b/gi, "Mok-sal");
  t = t.replace(/\bHangjeongsal\b/gi, "Hang-jeong-sal");
  t = t.replace(/\bGochujang\b/gi, "Go-chu-jang");
  t = t.replace(/\bBossam\b/gi, "Bos-sam");
  t = t.replace(/\bBulgogl\b/gi, "Bul-go-gi");

  t = t.replace(/\bWA\b/gi, "WhatsApp");
  t = t.replace(/\bTelp\.?\b/gi, "telepon");
  t = t.replace(/\bCS\b/gi, "customer service");
  t = t.replace(/\bBBQ\b/gi, "barbekyu");
  t = t.replace(/\bskin on\b/gi, "skin on");
  t = t.replace(/\bskin off\b/gi, "skin off");

  t = t.replace(/\b(?:Rp|IDR)\.?\s*([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?|\d+)/gi, (full, amount) => {
    const isThousands = /^\d{1,3}([.,]\d{3})+$/.test(amount);
    const isDecimal = /^\d+[.,]\d+$/.test(amount) && !isThousands;
    let num;
    if (isThousands) {
      num = parseInt(amount.replace(/[.,]/g, ""), 10);
    } else if (isDecimal) {
      num = Math.round(parseFloat(amount.replace(",", ".")));
    } else {
      num = parseInt(amount.replace(/[^\d]/g, ""), 10);
    }
    if (isNaN(num)) return full;
    return `${numberToWords(num)} rupiah`;
  });

  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*(?:rb|ribu)\b/gi, (_, n) => {
    const num = parseFloat(String(n).replace(",", "."));
    return `${numberToWords(Math.round(num * 1000))} rupiah`;
  });

  t = t.replace(/\b(\d+)\s*(jt|juta)\b/gi, (_, n) => {
    return `${numberToWords(parseInt(n, 10))} juta`;
  });

  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*(m|miliar|milyar)\b/gi, (_, n) => {
    return `${decimalToWords(n)} miliar`;
  });

  t = t.replace(/\/\s*kg\b/gi, " per kilogram");
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*kg\b/gi, (_, n) => `${decimalToWords(n)} kilogram`);
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*g\b/gi, (_, n) => `${decimalToWords(n)} gram`);
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*gr\b/gi, (_, n) => `${decimalToWords(n)} gram`);
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*ml\b/gi, (_, n) => `${decimalToWords(n)} mili liter`);
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*l\b/gi, (_, n) => `${decimalToWords(n)} liter`);

  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*m\b/gi, (_, a, b, c) => {
    return `${decimalToWords(a)} kali ${decimalToWords(b)} kali ${decimalToWords(c)} meter`;
  });

  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*(m2|m²)\b/gi, (_, n) => `${decimalToWords(n)} meter persegi`);
  t = t.replace(/\b(\d+)\s*pcs\b/gi, (_, n) => `${numberToWords(n)} pieces`);
  t = t.replace(/\b(\d+)\s*pc\b/gi, (_, n) => `${numberToWords(n)} piece`);
  t = t.replace(/\b(\d+)\s*pack\b/gi, (_, n) => `${numberToWords(n)} pak`);
  t = t.replace(/\b(\d+)\s*pax\b/gi, (_, n) => `${numberToWords(n)} orang`);
  t = t.replace(/\b(\d+)\s*ekor\b/gi, (_, n) => `${numberToWords(n)} ekor`);
  t = t.replace(/\b(\d+)\s*-\s*(\d+)\s*jam\b/gi, (_, a, b) => `${numberToWords(a)} sampai ${numberToWords(b)} jam`);
  t = t.replace(/\b(\d+)\s*°?\s*C\b/g, (_, n) => `${numberToWords(n)} derajat celcius`);

  t = t.replace(/\bNo\.?\s*(\d+)([A-Za-z]?)\b/gi, (_, n, letter) => {
    return cleanDoubleSpaces(`nomor ${numberToWords(n)} ${letter ? letter.toUpperCase() : ""}`);
  });

  t = t.replace(/\bBlok\s+([A-Za-z]+)[-\s]?(\d+)\b/gi, (_, letters, n) => {
    return `blok ${letters.toUpperCase()} ${numberToWords(n)}`;
  });

  t = t.replace(/\b0[\d\s\-]{8,18}\b/g, (phone) => normalizePhone(phone));
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*%\b/g, (_, n) => `${decimalToWords(n)} persen`);
  t = t.replace(/\b\d{1,3}(?:[.,]\d{3})+\b|\b\d+(?:[.,]\d+)?\b/g, (raw) => normalizePlainNumber(raw));

  t = t.replace(/[•|]/g, ". ");
  t = t.replace(/[<>]/g, "");
  t = t.replace(/\s+/g, " ");

  return cleanDoubleSpaces(t);
}

function safeSpeechLimit(text, maxChars) {
  const value = cleanDoubleSpaces(String(text || ""));
  if (value.length <= maxChars) return value;

  const soft = value.slice(0, maxChars);
  const lastPunct = Math.max(soft.lastIndexOf("."), soft.lastIndexOf("!"), soft.lastIndexOf("?"));
  if (lastPunct >= 120) return cleanDoubleSpaces(soft.slice(0, lastPunct + 1));

  const lastComma = Math.max(soft.lastIndexOf(","), soft.lastIndexOf(";"));
  if (lastComma >= 140) return cleanDoubleSpaces(soft.slice(0, lastComma) + ".");

  const lastSpace = soft.lastIndexOf(" ");
  const trimmed = cleanDoubleSpaces(lastSpace >= 120 ? soft.slice(0, lastSpace) : soft);
  return /[.!?]$/.test(trimmed) ? trimmed : trimmed + ".";
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Rate limiting (stricter for TTS — more expensive)
  cleanupRateMap();
  const rl = checkRateLimit(req);
  if (!rl.allowed) {
    return res.status(429).json({ error: "Rate limit exceeded" });
  }

  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: "OPENAI_API_KEY belum dikonfigurasi di Vercel." });
  }

  try {
    const body = getBody(req);
    const { text } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "Teks tidak boleh kosong." });
    }

    const cleanText = text
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
      .replace(/[\u{2600}-\u{27BF}]/gu, "")
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 260);

    let speechText = normalizeForSpeech(cleanText);
    speechText = safeSpeechLimit(speechText, 320);

    if (speechText.length === 0) {
      return res.status(400).json({ error: "Teks kosong setelah dibersihkan." });
    }

    const voice = process.env.OPENAI_TTS_VOICE || "onyx";
    const speed = Number(process.env.OPENAI_TTS_SPEED || 1.08);
    const cacheKey = makeCacheKey(speechText, voice, speed);
    const cached = cacheGet(cacheKey);

    // ── CACHE HIT: sudah berupa Buffer di memori, kirim langsung (paling cepat) ──
    if (cached) {
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", cached.length);
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("X-TTS-Cache", "HIT");
      return res.status(200).send(cached);
    }

    // ── CACHE MISS: PIPE langsung dari OpenAI ke client, JANGAN dibuffer penuh dulu.
    // Ini kunci fix delay: browser (lewat <audio src=...>) mulai terima & bisa
    // mulai memutar byte audio begitu OpenAI mengirimnya, bukan menunggu file
    // selesai 100% baru dikirim sekaligus.
    const openaiController = new AbortController();
    const openaiTimeout = setTimeout(() => openaiController.abort(), 18000);

    const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL || "tts-1",
        input: speechText,
        voice,
        response_format: "mp3",
        speed,
      }),
      signal: openaiController.signal,
    });

    if (!ttsRes.ok) {
      clearTimeout(openaiTimeout);
      const errText = await ttsRes.text();
      console.error("OpenAI TTS error:", ttsRes.status, errText);
      return res.status(502).json({ error: "Gagal generate suara dari OpenAI." });
    }

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("X-TTS-Cache", "MISS-STREAM");
    // Tanpa Content-Length → Vercel/Node otomatis pakai chunked transfer,
    // sehingga browser bisa mulai consume/play sebelum stream berakhir.
    res.flushHeaders?.();

    const nodeStream = Readable.fromWeb(ttsRes.body);
    const chunks = [];
    nodeStream.on("data", (chunk) => chunks.push(chunk));
    nodeStream.on("end", () => {
      clearTimeout(openaiTimeout);
      try { cacheSet(cacheKey, Buffer.concat(chunks)); } catch (_) {}
    });
    nodeStream.on("error", (err) => {
      clearTimeout(openaiTimeout);
      console.error("TTS stream error:", err);
      try { res.end(); } catch (_) {}
    });

    nodeStream.pipe(res);
    return; // response diakhiri oleh stream pipe (res.end() otomatis saat 'end')
  } catch (err) {
    console.error("TTS handler error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Server error." });
    }
  }
};
