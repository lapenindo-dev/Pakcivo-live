// lib/knowledgebase.js
// Fetch & cache knowledgebase dari Google Sheet (CommonJS)

const SHEET_ID = "1KrdnCww-pP36vI-f1_uofhIOGpOKWjTfJcMB7oz8PjQ";
const CACHE_TTL = 10 * 60 * 1000; // 10 menit

let _cache = { data: null, ts: 0 };

function parseCSV(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.replace(/"/g, "").trim());
  return lines.slice(1).map(line => {
    const values = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { values.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    values.push(cur.trim());
    const row = {};
    headers.forEach((h, i) => { row[h] = (values[i] || "").replace(/"/g, "").trim(); });
    return row;
  });
}

async function fetchSheet(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Gagal fetch sheet: " + sheetName);
  return parseCSV(await res.text());
}

async function getKnowledgebase() {
  const now = Date.now();
  if (_cache.data && now - _cache.ts < CACHE_TTL) return _cache.data;

  const [resep, bagian] = await Promise.all([
    fetchSheet("Resep Database"),
    fetchSheet("Panduan Bagian Daging"),
  ]);

  _cache = { data: { resep, bagian }, ts: now };
  return _cache.data;
}

function formatKBForPrompt(kb) {
  const validResep = (kb.resep || []).filter(r => r.NO && !isNaN(r.NO));

  const resepLines = validResep.map(r =>
    `• ${r["NAMA MASAKAN"]} (${r["ASAL / KATEGORI"]}): ` +
    `bagian → ${r["BAGIAN DAGING BABI"]} / ${r["NAMA POTONGAN (EN)"]}. ` +
    `Metode: ${r["METODE MEMASAK"]}. Rasa: ${r["KARAKTERISTIK RASA"]}. ` +
    `Tips: ${r["CATATAN / TIPS"]}`
  ).join("\n");

  const bagianLines = (kb.bagian || [])
    .filter(b => b["BAGIAN (ID)"])
    .map(b =>
      `• ${b["BAGIAN (ID)"]} (${b["NAMA INGGRIS"]}): ${b["TEKSTUR & LEMAK"]}. ` +
      `Terbaik untuk: ${b["METODE TERBAIK"]}. Masakan: ${b["MASAKAN REKOMENDASI"]}`
    ).join("\n");

  return `=== DATABASE MASAKAN (${validResep.length} menu) ===\n${resepLines}\n\n=== PANDUAN BAGIAN DAGING ===\n${bagianLines}`;
}

module.exports = { getKnowledgebase, formatKBForPrompt };
