// api/tts.js
// Vercel Serverless Function — OpenAI TTS
// Text chat tetap normal, tapi teks suara dinormalisasi agar bahasa Indonesia lebih natural.

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

module.exports.config = { maxDuration: 30 };

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

  // Nomor telepon / kode panjang sebaiknya dibaca digit per digit.
  const digitsOnly = value.replace(/\D/g, "");
  if (digitsOnly.startsWith("0") && digitsOnly.length >= 8) return normalizePhone(value);

  // Format ribuan Indonesia/US: 117.000 / 117,000 / 1.000.000
  if (/^\d{1,3}([.,]\d{3})+$/.test(value)) {
    const num = parseInt(value.replace(/\D/g, ""), 10);
    return Number.isFinite(num) ? numberToWords(num) : value;
  }

  // Format desimal: 5,5 / 4.5 — jangan dianggap ribuan.
  if (/^\d+[.,]\d+$/.test(value)) return decimalToWords(value);

  const num = parseInt(digitsOnly, 10);
  return Number.isFinite(num) ? numberToWords(num) : value;
}

function normalizeForSpeech(text) {
  let t = text;

  // Hapus URL dan kode internal cart
  t = t.replace(/https?:\/\/\S+/gi, "");
  t = t.replace(/www\.\S+/gi, "");
  t = t.replace(/<<CART:[^>]+>>/g, "");

  // Markdown dasar
  t = t.replace(/\*\*/g, "");
  t = t.replace(/\*/g, "");
  t = t.replace(/_/g, " ");

  // Singkatan umum
  t = t.replace(/\bWA\b/gi, "WhatsApp");
  t = t.replace(/\bTelp\.?\b/gi, "telepon");
  t = t.replace(/\bCS\b/gi, "customer service");
  t = t.replace(/\bBBQ\b/gi, "barbekyu");
  t = t.replace(/\bskin on\b/gi, "skin on");
  t = t.replace(/\bskin off\b/gi, "skin off");

  // Harga: Rp117.000 / Rp 117,000 / IDR 117000
  t = t.replace(/\b(?:Rp|IDR)\.?\s*([\d\.\,]+)/gi, (_, amount) => {
    const num = parseInt(String(amount).replace(/[^\d]/g, ""), 10);
    if (isNaN(num)) return amount;
    return `${numberToWords(num)} rupiah`;
  });

  // 65rb / 65Rb / 65 rb / 65 ribu → enam puluh lima ribu rupiah
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*(?:rb|ribu)\b/gi, (_, n) => {
    const num = parseFloat(String(n).replace(",", "."));
    return `${numberToWords(Math.round(num * 1000))} rupiah`;
  });

  // 2jt / 2 juta
  t = t.replace(/\b(\d+)\s*(jt|juta)\b/gi, (_, n) => {
    return `${numberToWords(parseInt(n, 10))} juta`;
  });

  // 5.5M / 5,5M / 5.5 miliar
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*(m|miliar|milyar)\b/gi, (_, n) => {
    return `${decimalToWords(n)} miliar`;
  });

  // Per kilogram: /kg
  t = t.replace(/\/\s*kg\b/gi, " per kilogram");

  // Berat dan satuan
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*kg\b/gi, (_, n) => `${decimalToWords(n)} kilogram`);
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*g\b/gi, (_, n) => `${decimalToWords(n)} gram`);
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*gr\b/gi, (_, n) => `${decimalToWords(n)} gram`);
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*ml\b/gi, (_, n) => `${decimalToWords(n)} mili liter`);
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*l\b/gi, (_, n) => `${decimalToWords(n)} liter`);

  // Ukuran: 4.5x3.2x9 m
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*m\b/gi, (_, a, b, c) => {
    return `${decimalToWords(a)} kali ${decimalToWords(b)} kali ${decimalToWords(c)} meter`;
  });

  // Meter persegi
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*(m2|m²)\b/gi, (_, n) => `${decimalToWords(n)} meter persegi`);

  // Satuan produk
  t = t.replace(/\b(\d+)\s*pcs\b/gi, (_, n) => `${numberToWords(n)} pieces`);
  t = t.replace(/\b(\d+)\s*pc\b/gi, (_, n) => `${numberToWords(n)} piece`);
  t = t.replace(/\b(\d+)\s*pack\b/gi, (_, n) => `${numberToWords(n)} pak`);
  t = t.replace(/\b(\d+)\s*pax\b/gi, (_, n) => `${numberToWords(n)} orang`);
  t = t.replace(/\b(\d+)\s*ekor\b/gi, (_, n) => `${numberToWords(n)} ekor`);

  // Range angka: 2-3 jam
  t = t.replace(/\b(\d+)\s*-\s*(\d+)\s*jam\b/gi, (_, a, b) => `${numberToWords(a)} sampai ${numberToWords(b)} jam`);

  // Suhu: 63°C
  t = t.replace(/\b(\d+)\s*°?\s*C\b/g, (_, n) => `${numberToWords(n)} derajat celcius`);

  // Alamat: No.3 / No.29A
  t = t.replace(/\bNo\.?\s*(\d+)([A-Za-z]?)\b/gi, (_, n, letter) => {
    return cleanDoubleSpaces(`nomor ${numberToWords(n)} ${letter ? letter.toUpperCase() : ""}`);
  });

  // Blok H6 / KK-08
  t = t.replace(/\bBlok\s+([A-Za-z]+)[-\s]?(\d+)\b/gi, (_, letters, n) => {
    return `blok ${letters.toUpperCase()} ${numberToWords(n)}`;
  });

  // Nomor HP/WA dengan strip atau spasi
  t = t.replace(/\b0[\d\s\-]{8,18}\b/g, (phone) => normalizePhone(phone));

  // Persentase
  t = t.replace(/\b(\d+(?:[.,]\d+)?)\s*%\b/g, (_, n) => `${decimalToWords(n)} persen`);

  // FIX: Angka umum — gunakan regex yang hanya cocok dengan angka utuh (bukan digit sisa)
  // Ini mencegah "10" dibaca "sepuluh nol" karena regex menangkap "1" dan "0" secara terpisah
  t = t.replace(/\b\d+([.,]\d+)?\b/g, (raw) => normalizePlainNumber(raw));

  // Bersihkan sisa simbol yang mengganggu suara
  t = t.replace(/[•|]/g, ". ");
  t = t.replace(/[<>]/g, "");
  t = t.replace(/\s+/g, " ");

  return cleanDoubleSpaces(t);
}

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

    const cleanText = text
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
      .replace(/[\u{2600}-\u{27BF}]/gu, "")
      .replace(/\s+/g, " ")
      .trim();

    const speechText = normalizeForSpeech(cleanText);

    if (speechText.length === 0) {
      return res.status(400).json({ error: "Teks kosong setelah dibersihkan." });
    }

    const trimmed = speechText.slice(0, 4096);

    const ttsRes = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: trimmed,
        voice: "onyx",
        response_format: "mp3",
        speed: 1.08,
      }),
    });

    if (!ttsRes.ok) {
      const errText = await ttsRes.text();
      console.error("OpenAI TTS error:", ttsRes.status, errText);
      return res.status(502).json({ error: "Gagal generate suara dari OpenAI." });
    }

    const arrayBuffer = await ttsRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", buffer.length);
    res.setHeader("Cache-Control", "no-cache");
    return res.status(200).send(buffer);
  } catch (err) {
    console.error("TTS handler error:", err);

    if (!res.headersSent) {
      return res.status(500).json({ error: "Server error." });
    }
  }
};
