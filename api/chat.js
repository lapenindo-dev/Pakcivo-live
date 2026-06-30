// api/chat.js
// v6.0.0 — mobile live commerce UX + catalog-wide Shopify fallback search
// Vercel Serverless Function — Pak Civo AI + Shopify Storefront API
// CommonJS (Node.js 20, tanpa "type":"module")

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_STOREFRONT_ACCESS_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

// ── RATE LIMITER ─────────────────────────────────────────────
// Max 15 requests per IP per minute
const _rateMap = new Map();

function checkRateLimit(req) {
  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown";

  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 15;

  if (!_rateMap.has(ip)) {
    _rateMap.set(ip, { count: 1, start: now });
    return { allowed: true, ip };
  }

  const entry = _rateMap.get(ip);

  if (now - entry.start > windowMs) {
    _rateMap.set(ip, { count: 1, start: now });
    return { allowed: true, ip };
  }

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

const MAX_HISTORY = 6;

const MODELS = [
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-1.5-flash",
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}



const GUARANTEED_BEST_SELLERS = [
  {
    id: "best-samcan-lokal-1kg",
    title: "Samcan Lokal 1kg",
    handle: "samcan-lokal-1kg",
    description: "Best seller CIVO MEAT. Samcan lokal frozen vacuum pack 1kg.",
    tags: ["best-seller", "samcan", "pork belly", "lokal"],
    productType: "Best Seller",
    image: null,
    variants: [{ id: "", title: "Default Title", availableForSale: true, price: 130000, currencyCode: "IDR" }],
    guaranteedBestSeller: true,
  },
  {
    id: "best-babi-giling-500g",
    title: "Babi Giling 500g",
    handle: "babi-giling-500g",
    description: "Best seller CIVO MEAT. Daging babi giling 500g untuk bakso, pangsit, bakmoy, tumisan, dan campuran masakan.",
    tags: ["best-seller", "babi giling", "ground pork", "minced pork"],
    productType: "Best Seller",
    image: null,
    variants: [{ id: "", title: "Default Title", availableForSale: true, price: 40000, currencyCode: "IDR" }],
    guaranteedBestSeller: true,
  },
  {
    id: "best-paikut-sop-500g",
    title: "Paikut Sop 500g",
    handle: "paikut-sop-500g",
    description: "Best seller CIVO MEAT. Paikut/bakut potongan sop 500g untuk sup, rebusan, dan masakan kuah.",
    tags: ["best-seller", "paikut", "bakut", "pork ribs", "sop"],
    productType: "Best Seller",
    image: null,
    variants: [{ id: "", title: "Default Title", availableForSale: true, price: 50000, currencyCode: "IDR" }],
    guaranteedBestSeller: true,
  },
  {
    id: "best-kapsim-1kg",
    title: "Kapsim 1kg",
    handle: "kapsim-1kg",
    description: "Best seller CIVO MEAT. Kapsim/shoulder 1kg untuk tumis, babi kecap, sup, dan masakan harian.",
    tags: ["best-seller", "kapsim", "shoulder", "pork shoulder", "kasim"],
    productType: "Best Seller",
    image: null,
    variants: [{ id: "", title: "Default Title", availableForSale: true, price: 80000, currencyCode: "IDR" }],
    guaranteedBestSeller: true,
  },
  {
    id: "best-samcan-import-1kg",
    title: "Samcan Import 1kg",
    handle: "samcan-import-1kg",
    description: "Best seller CIVO MEAT. Samcan import 1kg dengan potongan konsisten untuk grill, hotpot, Korean BBQ, dan masakan premium.",
    tags: ["best-seller", "samcan", "pork belly", "import", "wuhua rou"],
    productType: "Best Seller",
    image: null,
    variants: [{ id: "", title: "Default Title", availableForSale: true, price: 150000, currencyCode: "IDR" }],
    guaranteedBestSeller: true,
  },
];

function shopifySearchAliases(rawQuery) {
  const q = normalizeText(rawQuery);
  const aliases = new Set([String(rawQuery || "").trim()].filter(Boolean));
  const add = (arr) => arr.forEach((v) => aliases.add(v));

  if (/samcan|pork belly|wuhua/.test(q) && /lokal|local/.test(q)) {
    add(["Samcan Lokal 1kg", "Samcan Babi Pork Belly Lokal 1kg", "Pork Belly Lokal", "samcan lokal"]);
  }
  if (/giling|ground|minced|mince/.test(q)) {
    add(["Babi Giling 500g", "Daging Babi Giling 500g", "Babi Giling", "giling babi", "ground pork", "minced pork"]);
  }
  if (/paikut|bakut|bak kut|ribs?|iga|sop/.test(q)) {
    add(["Paikut Sop 500g", "Paikut Sop", "Paikut", "Bakut", "Bak Kut", "Pork Ribs Sop", "ribs chopped", "iga babi"]);
  }
  if (/kapsim|kasim|shoulder|collar/.test(q)) {
    add(["Kapsim 1kg", "Kapsim Babi 1kg", "Shoulder Babi 1kg", "Pork Shoulder", "kasim"]);
  }
  if (/samcan|pork belly|wuhua/.test(q) && /import|impor/.test(q)) {
    add(["Samcan Import 1kg", "Pork Belly Samcan Import 1kg", "Pork Belly Import", "Wuhua Rou Import"]);
  }

  // Generic category aliases. Shopify search can miss Indonesian category words, so we try common title variants too.
  if (/jeroan|organ|offal/.test(q)) {
    add(["jeroan", "organ", "offal", "jantung", "hati", "usus", "paru", "lidah", "ginjal", "kuping", "telinga", "pork organ"]);
  }
  if (/jantung|heart/.test(q)) add(["jantung", "jantung babi", "pork heart", "heart"]);
  if (/hati|liver|ati/.test(q)) add(["hati", "hati babi", "pork liver", "liver"]);
  if (/usus|intestine|intestines/.test(q)) add(["usus", "usus babi", "pork intestine", "intestine"]);
  if (/paru|lung/.test(q)) add(["paru", "paru babi", "pork lung", "lung"]);
  if (/ginjal|kidney/.test(q)) add(["ginjal", "ginjal babi", "pork kidney", "kidney"]);
  if (/lidah|tongue/.test(q)) add(["lidah", "lidah babi", "pork tongue", "tongue"]);
  if (/kuping|telinga|ear/.test(q)) add(["kuping", "telinga", "kuping babi", "pork ear", "ear"]);
  if (/kaki|feet|pork feet|kikil/.test(q)) add(["kaki babi", "pork feet", "pork trotter", "trotter", "kaki"]);
  if (/lemak|fat|minyak/.test(q)) add(["lemak babi", "pork fat", "fat", "lard"]);
  if (/kulit|skin/.test(q)) add(["kulit babi", "pork skin", "skin"]);
  if (/daging|meat/.test(q)) add(["daging babi", "pork meat", "pork"]);

  return Array.from(aliases).filter(Boolean).slice(0, 12);
}

function bestSellerFallbackForQuery(rawQuery) {
  const q = normalizeText(rawQuery);
  if (!q) return [];
  return GUARANTEED_BEST_SELLERS.filter((p) => {
    const text = normalizeText(`${p.title} ${p.handle} ${p.description} ${p.tags.join(" ")}`);
    if (/giling|ground|minced|mince/.test(q)) return /giling|ground|minced|mince/.test(text);
    if (/paikut|bakut|bak kut|ribs?|iga|sop/.test(q)) return /paikut|bakut|ribs?|sop|iga/.test(text);
    if (/kapsim|kasim|shoulder|collar/.test(q)) return /kapsim|kasim|shoulder/.test(text);
    if (/samcan|pork belly|wuhua/.test(q) && /import|impor/.test(q)) return /samcan/.test(text) && /import/.test(text);
    if (/samcan|pork belly|wuhua/.test(q) && /lokal|local/.test(q)) return /samcan/.test(text) && /lokal/.test(text);
    return text.includes(q);
  });
}

function productFromCatalogHint(hint) {
  if (!hint || !hint.name) return null;
  const priceText = String(hint.price || "").replace(",", ".");
  let price = 0;
  const m = priceText.match(/(\d+(?:\.\d+)?)/);
  if (m) price = Math.round(Number(m[1]) * (/rb/i.test(priceText) ? 1000 : 1));
  return {
    id: hint.id || hint.variantId || hint.name,
    title: hint.shopifyName || hint.name,
    handle: hint.id || normalizeText(hint.name).replace(/\s+/g, "-"),
    description: `Produk best seller CIVO MEAT${hint.unit ? ` ${hint.unit}` : ""}.`,
    tags: ["best-seller", ...(Array.isArray(hint.shopifyQueries) ? hint.shopifyQueries : [])],
    productType: "Best Seller",
    image: hint.image || null,
    variants: [{
      id: hint.variantId || "",
      title: "Default Title",
      availableForSale: hint.availableForSale !== false,
      price: price || 0,
      currencyCode: "IDR",
    }],
    catalogHint: true,
  };
}

function relevantCatalogHintProducts(catalogHints, rawQuery) {
  const q = normalizeText(rawQuery);
  if (!Array.isArray(catalogHints) || !q) return [];
  return catalogHints
    .map(productFromCatalogHint)
    .filter(Boolean)
    .filter((p) => {
      const text = normalizeText(`${p.title} ${p.handle} ${p.description} ${p.tags.join(" ")}`);
      return q.split(" ").some((term) => term.length >= 3 && text.includes(term)) ||
        (/giling|ground|minced|mince/.test(q) && /giling|ground|minced|mince/.test(text)) ||
        (/paikut|bakut|ribs?|iga|sop/.test(q) && /paikut|bakut|ribs?|iga|sop/.test(text)) ||
        (/kapsim|kasim|shoulder/.test(q) && /kapsim|kasim|shoulder/.test(text));
    });
}

function mergeProductLists(...lists) {
  const merged = new Map();
  for (const list of lists) {
    for (const product of Array.isArray(list) ? list : []) {
      if (!product) continue;
      const key = product.id || product.handle || normalizeText(product.title);
      if (!key) continue;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, product);
      } else {
        // Prefer Shopify products with real variant ids/images over hints/fallbacks.
        const hasRealVariant = product.variants?.some((v) => v?.id);
        const existingRealVariant = existing.variants?.some((v) => v?.id);
        if ((hasRealVariant && !existingRealVariant) || (product.image && !existing.image)) {
          merged.set(key, { ...existing, ...product });
        }
      }
    }
  }
  return Array.from(merged.values());
}

const PRODUCT_SEARCH_STOP_WORDS = new Set([
  "ada", "apa", "apakah", "berapa", "harga", "mau", "saya", "aku", "kak", "pak", "civo",
  "iya", "ya", "ok", "oke", "boleh", "checkout", "beli", "ambil", "masukkan", "masukin",
  "ke", "keranjang", "tolong", "dong", "nih", "itu", "yang", "untuk", "buat", "produk", "ready",
  "stok", "stock", "punya", "tersedia", "cari", "carikan", "jual", "jualan", "daging", "babi"
]);

function productSearchText(product) {
  const variants = Array.isArray(product?.variants) ? product.variants.map((v) => v?.title || "").join(" ") : "";
  return normalizeText([
    product?.title,
    product?.handle,
    product?.description,
    product?.productType,
    Array.isArray(product?.tags) ? product.tags.join(" ") : "",
    variants,
  ].filter(Boolean).join(" "));
}

function expandedQueryTerms(rawQuery) {
  const q = normalizeText(rawQuery);
  const terms = new Set(q.split(" ").filter((w) => w.length >= 3 && !PRODUCT_SEARCH_STOP_WORDS.has(w)));
  const add = (...items) => items.forEach((item) => String(item || "").split(/\s+/).forEach((w) => {
    const n = normalizeText(w);
    if (n && n.length >= 3 && !PRODUCT_SEARCH_STOP_WORDS.has(n)) terms.add(n);
  }));

  if (/jeroan|organ|offal/.test(q)) add("jeroan", "organ", "offal", "jantung", "heart", "hati", "liver", "usus", "intestine", "paru", "lung", "ginjal", "kidney", "lidah", "tongue", "kuping", "telinga", "ear");
  if (/jantung|heart/.test(q)) add("jantung", "heart");
  if (/hati|liver|ati/.test(q)) add("hati", "liver", "ati");
  if (/usus|intestine/.test(q)) add("usus", "intestine");
  if (/paru|lung/.test(q)) add("paru", "lung");
  if (/ginjal|kidney/.test(q)) add("ginjal", "kidney");
  if (/lidah|tongue/.test(q)) add("lidah", "tongue");
  if (/kuping|telinga|ear/.test(q)) add("kuping", "telinga", "ear");
  if (/kaki|feet|trotter|kikil/.test(q)) add("kaki", "feet", "trotter", "kikil");
  if (/lemak|fat|lard/.test(q)) add("lemak", "fat", "lard");
  if (/kulit|skin/.test(q)) add("kulit", "skin");

  return Array.from(terms);
}

function scoreProductForQuery(product, rawQuery) {
  const q = normalizeText(rawQuery);
  const text = productSearchText(product);
  if (!q || !text) return 0;
  let score = 0;
  const terms = expandedQueryTerms(rawQuery);

  if (text.includes(q)) score += 80;
  for (const term of terms) {
    if (text.includes(term)) score += term.length >= 6 ? 18 : 10;
  }

  const phraseChecks = [
    [/jantung|heart/, /jantung|heart/],
    [/hati|liver|ati/, /hati|liver|ati/],
    [/usus|intestine/, /usus|intestine/],
    [/paru|lung/, /paru|lung/],
    [/ginjal|kidney/, /ginjal|kidney/],
    [/lidah|tongue/, /lidah|tongue/],
    [/kuping|telinga|ear/, /kuping|telinga|ear/],
    [/kaki|feet|trotter|kikil/, /kaki|feet|trotter|kikil/],
    [/giling|ground|minced|mince/, /giling|ground|minced|mince/],
    [/paikut|bakut|ribs?|iga|sop/, /paikut|bakut|ribs?|iga|sop/],
    [/kapsim|kasim|shoulder|collar/, /kapsim|kasim|shoulder|collar/],
    [/samcan|pork\s*belly|wuhua/, /samcan|pork\s*belly|wuhua/],
  ];
  for (const [queryRe, textRe] of phraseChecks) {
    if (queryRe.test(q) && textRe.test(text)) score += 50;
  }

  if (/jeroan|organ|offal/.test(q) && /jantung|heart|hati|liver|usus|intestine|paru|lung|ginjal|kidney|lidah|tongue|kuping|telinga|ear/.test(text)) score += 45;
  if (product?.variants?.some((v) => v?.availableForSale !== false)) score += 3;
  if (product?.image) score += 1;
  return score;
}

function rankProductsForQuery(products, rawQuery, limit = 12) {
  const q = normalizeText(rawQuery);
  if (!q) return (Array.isArray(products) ? products : []).slice(0, limit);
  return (Array.isArray(products) ? products : [])
    .map((product) => ({ product, score: scoreProductForQuery(product, rawQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.product);
}






const SHOPIFY_FALLBACK_PRODUCTS = [
  {
    id: "gid://shopify/Product/8979847381146",
    title: "Samcan Babi Pork Belly Lokal 1kg Frozen Vacuum Pack",
    handle: "samcan-babi-pork-belly-lokal-1kg-frozen-vacuum-pack",
    description: "Samcan Pork Belly Lokal 1kg Frozen Vacuum Pack",
    tags: [],
    productType: "",
    image: "https://cdn.shopify.com/s/files/1/0755/6287/7082/files/rn-image_picker_lib_temp_97c57387-c29b-42ee-b35f-5aef1a5b05d0.jpg?v=1781663022",
    variants: [{ id: "gid://shopify/ProductVariant/48252265136282", title: "Default Title", availableForSale: true, price: 122000, currencyCode: "IDR" }],
  },
  {
    id: "gid://shopify/Product/9000013562010",
    title: "Samcan Kulit / Pork Belly / Wuhua Rou - 1kg",
    handle: "jual-daging-babi-samcan-kulit-pork-belly-wuhua-rou-1kg-1",
    description: "",
    tags: [],
    productType: "",
    image: "https://cdn.shopify.com/s/files/1/0755/6287/7082/files/SAMCANON1kg.png?v=1782372160",
    variants: [{ id: "gid://shopify/ProductVariant/48497419419802", title: "Default Title", availableForSale: true, price: 139000, currencyCode: "IDR" }],
  },
  {
    id: "gid://shopify/Product/9000009859226",
    title: "Pork Belly Samcan Daging Babi Import Wuhua Rou - 1kg",
    handle: "pork-belly-samcan-daging-babi-import-wuhua-rou-1kg",
    description: "",
    tags: [],
    productType: "",
    image: "https://cdn.shopify.com/s/files/1/0755/6287/7082/files/SAMCAN1kg.png?v=1782372745",
    variants: [{ id: "gid://shopify/ProductVariant/48497412604058", title: "Default Title", availableForSale: true, price: 152000, currencyCode: "IDR" }],
  },
  {
    id: "gid://shopify/Product/9000009498778",
    title: "Samcan Babi Pork Belly IMPORT without Skin (Skin Off) - 1kg",
    handle: "samcan-babi-pork-belly-import-without-skin-skin-off-1kg",
    description: "",
    tags: [],
    productType: "",
    image: null,
    variants: [{ id: "gid://shopify/ProductVariant/48497412243610", title: "Default Title", availableForSale: true, price: 159000, currencyCode: "IDR" }],
  },
  {
    id: "gid://shopify/Product/9000013299866",
    title: "Pork Belly Slice / SamGyeopSal Korean Bbq - Samcan Babi Iris tipis - 500gram",
    handle: "pork-belly-slice-samgyeopsal-korean-bbq-samcan-babi-iris-tipis-500gram",
    description: "",
    tags: [],
    productType: "",
    image: null,
    variants: [{ id: "gid://shopify/ProductVariant/48497419157658", title: "Default Title", availableForSale: true, price: 68000, currencyCode: "IDR" }],
  },
  {
    id: "gid://shopify/Product/9000010547354",
    title: "SAMGYEOPSAL IMPORT Samcan Pork Belly Import Slice TIPIS 2mm 500gr",
    handle: "samgyeopsal-import-samcan-pork-belly-import-slice-tipis-2mm-500gr",
    description: "",
    tags: [],
    productType: "",
    image: null,
    variants: [{ id: "gid://shopify/ProductVariant/48497413292186", title: "Default Title", availableForSale: true, price: 86000, currencyCode: "IDR" }],
  },
  {
    id: "gid://shopify/Product/9000008974490",
    title: "SAMGYEOPSAL IMPORT Samcan Pork Belly Import Slice TEBAL 8-10mm 500gr",
    handle: "samgyeopsal-import-samcan-pork-belly-import-slice-tebal-8-10mm-500gr",
    description: "",
    tags: [],
    productType: "",
    image: null,
    variants: [{ id: "gid://shopify/ProductVariant/48497411063962", title: "Default Title", availableForSale: true, price: 86000, currencyCode: "IDR" }],
  },
  {
    id: "gid://shopify/Product/9000009957530",
    title: "Daging Babi Samcan Pork Belly Potong Dadu / Babi Kecap 500gr",
    handle: "daging-babi-samcan-pork-belly-potong-dadu-babi-kecap-500gr",
    description: "",
    tags: [],
    productType: "",
    image: null,
    variants: [{ id: "gid://shopify/ProductVariant/48497412669594", title: "Default Title", availableForSale: true, price: 72500, currencyCode: "IDR" }],
  },
  {
    id: "gid://shopify/Product/8999675855002",
    title: "500g Streaky bacon / smoked bacon - 500g",
    handle: "500g-streaky-bacon-smoked-bacon-500g",
    description: "Smoked Bacon / Smoked Pork Belly 500g. Samcan Babi Asap Iris Tipis 3mm.",
    tags: [],
    productType: "Baso & Daging Olahan Lainnya",
    image: "https://cdn.shopify.com/s/files/1/0755/6287/7082/files/8dfd479d-64c8-4187-a0de-2eea472e518f.jpg?v=1782185272",
    variants: [{ id: "gid://shopify/ProductVariant/48496503423130", title: "Default Title", availableForSale: true, price: 60000, currencyCode: "IDR" }],
  },
];

function fallbackProductsForQuery(rawQuery) {
  const q = normalizeText(rawQuery);
  if (!q) return SHOPIFY_FALLBACK_PRODUCTS.slice(0, 8);

  const aliases = {
    samcan: ["samcan", "pork belly", "belly", "wuhua", "samgyeopsal"],
    "pork belly": ["samcan", "pork belly", "belly", "wuhua", "samgyeopsal"],
    belly: ["samcan", "pork belly", "belly", "wuhua", "samgyeopsal"],
    bbq: ["samgyeopsal", "slice", "bbq", "pork belly", "samcan"],
    barbeque: ["samgyeopsal", "slice", "bbq", "pork belly", "samcan"],
    bacon: ["bacon", "smoked"],
    giling: ["giling", "ground", "minced", "mince"],
    "babi giling": ["giling", "ground", "minced", "mince"],
    paikut: ["paikut", "bakut", "ribs", "iga", "sop"],
    bakut: ["paikut", "bakut", "ribs", "iga", "sop"],
    kapsim: ["kapsim", "kasim", "shoulder", "collar"],
    shoulder: ["kapsim", "kasim", "shoulder", "collar"],
    kecap: ["kecap", "dadu"],
  };

  const terms = new Set(q.split(" ").filter(Boolean));
  for (const [key, values] of Object.entries(aliases)) {
    if (q.includes(key)) values.forEach((v) => terms.add(v));
  }

  const scored = SHOPIFY_FALLBACK_PRODUCTS.map((product) => {
    const text = normalizeText(`${product.title} ${product.handle} ${product.description} ${product.productType} ${product.tags.join(" ")}`);
    let score = 0;
    for (const term of terms) {
      if (term && text.includes(term)) score += term.length > 5 ? 3 : 1;
    }
    return { product, score };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.product);

  return scored.length ? scored.slice(0, 8) : SHOPIFY_FALLBACK_PRODUCTS.slice(0, 8);
}

function extractSearchQuery(messages) {
  const recent = messages.slice(-6);
  const latestUser = [...recent].reverse().find((m) => m.role !== "assistant")?.content || "";
  const allText = normalizeText(recent.map((m) => m.content).join(" "));
  const latestText = normalizeText(latestUser);

  const productKeywords = [
    "samcan",
    "pork belly",
    "belly",
    "bacon",
    "bacon bits",
    "giling",
    "ground",
    "ribs",
    "rib",
    "iga",
    "paikut",
    "bakut",
    "kapsim",
    "collar",
    "moksal",
    "shoulder",
    "loin",
    "karbonat",
    "paha",
    "slice",
    "bbq",
    "barbeque",
    "sop",
    "steak",
    "jeroan",
    "organ",
    "offal",
    "jantung",
    "heart",
    "hati",
    "liver",
    "ati",
    "usus",
    "intestine",
    "paru",
    "lung",
    "ginjal",
    "kidney",
    "lidah",
    "tongue",
    "kuping",
    "telinga",
    "ear",
    "kaki",
    "trotter",
    "feet",
    "lemak",
    "fat",
    "kulit",
    "skin",
  ];

  for (const keyword of productKeywords) {
    if (latestText.includes(keyword)) return keyword;
  }

  for (const keyword of productKeywords) {
    if (allText.includes(keyword)) return keyword;
  }

  const stopWords = new Set([
    "ada", "apa", "berapa", "harga", "mau", "saya", "aku", "kak", "pak", "civo",
    "iya", "ya", "ok", "oke", "boleh", "checkout", "beli", "ambil", "masukkan",
    "ke", "keranjang", "tolong", "dong", "nih", "itu", "yang", "untuk", "buat",
  ]);

  const words = latestText
    .split(" ")
    .filter((w) => w.length >= 3 && !stopWords.has(w))
    .slice(0, 4);

  return words.join(" ");
}

function formatRupiahShort(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n)) return "";
  if (n >= 1000000) {
    const juta = n / 1000000;
    return `${Number.isInteger(juta) ? juta : juta.toFixed(1)}jt`;
  }
  if (n >= 1000) {
    const rb = n / 1000;
    return `${Number.isInteger(rb) ? rb : rb.toFixed(1)}rb`;
  }
  return String(n);
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body;
}

function normalizeShopDomain(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function getNumericVariantId(gid) {
  const value = String(gid || "");
  const match = value.match(/ProductVariant\/(\d+)/);
  if (match && match[1]) return match[1];
  if (/^\d+$/.test(value)) return value;
  return "";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const _productCache = new Map();
const PRODUCT_CACHE_TTL = 45000;
function getCachedProducts(key) {
  const item = _productCache.get(key);
  if (!item || Date.now() - item.time > PRODUCT_CACHE_TTL) return null;
  return item.value;
}
function setCachedProducts(key, value) {
  if (_productCache.size > 20) _productCache.clear();
  _productCache.set(key, { value, time: Date.now() });
}

function buildCartPermalinkFromCommands(commands) {
  const shop = normalizeShopDomain(process.env.SHOPIFY_CART_DOMAIN || SHOPIFY_STORE_DOMAIN || "civo-meat.myshopify.com");
  const items = commands
    .map((cmd) => {
      const id = getNumericVariantId(cmd.variantId);
      const qty = Math.max(1, Math.min(Number(cmd.quantity || 1), 99));
      return id ? `${id}:${qty}` : "";
    })
    .filter(Boolean)
    .join(",");
  return shop && items ? `https://${shop}/cart/${items}` : "";
}

async function shopifyGraphQL(query, variables = {}) {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_STOREFRONT_ACCESS_TOKEN) {
    throw new Error("Shopify environment variables belum lengkap.");
  }

  const response = await fetchWithTimeout(
    `https://${SHOPIFY_STORE_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_ACCESS_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    },
    8000
  );

  const data = await response.json();

  if (!response.ok || data.errors) {
    const message = JSON.stringify(data.errors || data);
    throw new Error(`Shopify API error ${response.status}: ${message}`);
  }

  return data.data;
}

async function runSingleShopifyProductSearch(queryText, first = 20) {
  const query = `
    query SearchProducts($query: String, $first: Int!) {
      products(first: $first, query: $query) {
        edges {
          node {
            id
            title
            handle
            description
            tags
            productType
            featuredImage {
              url
              altText
            }
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  availableForSale
                  price {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const safeFirst = Math.max(1, Math.min(Number(first || 20), 250));
  const data = await shopifyGraphQL(query, { query: queryText || null, first: safeFirst });

  return data.products.edges.map((edge) => {
    const product = edge.node;

    return {
      id: product.id,
      title: product.title,
      handle: product.handle,
      description: product.description || "",
      tags: product.tags || [],
      productType: product.productType || "",
      image: product.featuredImage?.url || null,
      variants: product.variants.edges.map((variantEdge) => {
        const variant = variantEdge.node;
        return {
          id: variant.id,
          title: variant.title,
          availableForSale: !!variant.availableForSale,
          price: Number(variant.price.amount),
          currencyCode: variant.price.currencyCode,
        };
      }),
    };
  });
}

async function fetchCatalogProducts() {
  const cacheKey = "v509:catalog:250";
  const cached = getCachedProducts(cacheKey);
  if (cached) return cached;
  const products = await runSingleShopifyProductSearch("", 250);
  setCachedProducts(cacheKey, products);
  return products;
}

async function searchShopifyProducts(rawQuery) {
  const queryText = String(rawQuery || "").trim();
  const cacheKey = `v509:${queryText.toLowerCase()}`;
  const cached = getCachedProducts(cacheKey);
  if (cached) return cached;

  const aliases = shopifySearchAliases(queryText);
  let products = [];

  for (const q of aliases) {
    try {
      const result = await runSingleShopifyProductSearch(q, 20);
      products = mergeProductLists(products, result);
      if (products.length >= 12 && aliases.length > 2) break;
    } catch (error) {
      console.warn("Shopify alias search skipped:", q, error.message);
    }
  }

  let ranked = rankProductsForQuery(products, queryText, 12);

  // Critical production fallback: if Shopify's query search misses a product title/category,
  // fetch the broader Storefront catalog and locally rank it. This is what catches queries like "jeroan jantung".
  if (queryText && ranked.length < 3) {
    try {
      const catalog = await fetchCatalogProducts();
      const rankedCatalog = rankProductsForQuery(catalog, queryText, 12);
      ranked = mergeProductLists(ranked, rankedCatalog).slice(0, 12);
    } catch (catalogError) {
      console.warn("Shopify catalog fallback skipped:", catalogError.message);
    }
  }

  if (ranked.length === 0) {
    ranked = rankProductsForQuery(fallbackProductsForQuery(queryText), queryText, 8);
  }

  ranked = mergeProductLists(ranked, bestSellerFallbackForQuery(queryText));
  setCachedProducts(cacheKey, ranked);
  return ranked;
}

async function createShopifyCart(variantId, quantity) {
  const qty = Math.max(1, Math.min(Number(quantity || 1), 99));

  const mutation = `
    mutation CartCreate($lines: [CartLineInput!]!) {
      cartCreate(input: { lines: $lines }) {
        cart {
          id
          checkoutUrl
          cost {
            subtotalAmount {
              amount
              currencyCode
            }
            totalAmount {
              amount
              currencyCode
            }
          }
          lines(first: 20) {
            edges {
              node {
                quantity
                merchandise {
                  ... on ProductVariant {
                    id
                    title
                    product {
                      title
                    }
                    price {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyGraphQL(mutation, {
    lines: [
      {
        merchandiseId: variantId,
        quantity: qty,
      },
    ],
  });

  const result = data.cartCreate;

  if (result.userErrors && result.userErrors.length > 0) {
    throw new Error(JSON.stringify(result.userErrors));
  }

  return result.cart;
}

function buildProductContext(products) {
  if (!products || products.length === 0) {
    return "Tidak ada produk Shopify yang cocok ditemukan untuk query customer saat ini.";
  }

  return products
    .slice(0, 8)
    .map((product, index) => {
      const variants = product.variants
        .map((variant, vIndex) => {
          return [
            `Varian ${vIndex + 1}`,
            `variantId=${variant.id || "belum_terhubung"}`,
            `namaVarian=${variant.title}`,
            `harga=${formatRupiahShort(variant.price)} (${variant.price} ${variant.currencyCode})`,
            `availableForSale=${variant.availableForSale}`,
          ].join(" | ");
        })
        .join("\n    ");

      return [
        `${index + 1}. ${product.title}`,
        product.description ? `   Deskripsi: ${product.description}` : "   Deskripsi: -",
        product.productType ? `   Tipe: ${product.productType}` : "   Tipe: -",
        product.guaranteedBestSeller || product.catalogHint ? "   Catatan: produk ini termasuk 5 best seller display Pak Civo; jangan jawab tidak ada kecuali availableForSale=false." : "",
        product.tags?.length ? `   Tags: ${product.tags.join(", ")}` : "   Tags: -",
        `   Handle: ${product.handle}`,
        `   Varian:\n    ${variants}`,
      ].join("\n");
    })
    .join("\n\n");
}

// ── FAQ TEMPLATES ─────────────────────────────────────────────
// Jawaban instan tanpa LLM call. Keyword matching → skip Gemini = 0ms delay.
// Setiap entry: { keywords: [...], reply: "..." }
// Match logic: ALL keywords in entry must appear in normalized user message.
const FAQ_TEMPLATES = [
  // ── GREETING ──
  {
    keywords: ["halo"],
    reply: "Halo Kak! 👋 Selamat datang di CIVO MEAT. Mau cari daging apa hari ini? Pak Civo siap bantu pilihkan yang pas! 😊",
  },
  {
    keywords: ["hai"],
    reply: "Hai Kak! 👋 Ada yang bisa Pak Civo bantu? Mau cari produk daging babi atau butuh rekomendasi masakan? 😊",
  },

  // ── PENGIRIMAN / DELIVERY ──
  {
    keywords: ["ongkir"],
    reply: "Ongkir tergantung lokasi Kak, dihitung otomatis pas checkout Shopify. Untuk area Jakarta & Tangerang biasanya terjangkau — mau Pak Civo buatkan checkout dulu biar keliatan ongkirnya? 😊",
  },
  {
    keywords: ["pengiriman", "berapa", "lama"],
    reply: "Pengiriman cepat same-day/instant khusus area Jakarta & Tangerang Kak. Untuk luar area, Pak Civo sarankan cek cabang terdekat atau hubungi admin dulu supaya tidak salah estimasi 📦",
  },
  {
    keywords: ["kirim", "luar", "kota"],
    reply: "Untuk luar Jakarta & Tangerang, jangan langsung checkout dulu Kak. Lebih aman cek cabang terdekat atau hubungi admin CIVO agar pengiriman frozen-nya sesuai area 📦",
  },
  {
    keywords: ["jam", "cutoff"],
    reply: "Cutoff order same-day jam 14:00, instant delivery jam 16:00 Kak. Lewat dari itu, dikirim besok paginya ya 📦",
  },
  {
    keywords: ["same", "day"],
    reply: "Same-day delivery bisa Kak! Pastikan order sebelum jam 14:00 ya. Untuk instant delivery, cutoff jam 16:00 🚀",
  },

  // ── PEMBAYARAN ──
  {
    keywords: ["bayar", "gimana"],
    reply: "Pembayaran lewat checkout Shopify Kak — bisa transfer bank, e-wallet, atau QRIS. Tinggal pilih pas di halaman checkout 💳",
  },
  {
    keywords: ["qris"],
    reply: "QRIS tersedia Kak! Pas checkout Shopify, pilih metode pembayaran QRIS — tinggal scan dari e-wallet atau m-banking mana aja 💳",
  },
  {
    keywords: ["transfer", "bank"],
    reply: "Transfer bank bisa Kak, tersedia di halaman checkout Shopify. Support BCA, Mandiri, BNI, dan bank lainnya 💳",
  },

  // ── CABANG / LOKASI ──
  {
    keywords: ["cabang", "mana"],
    reply: "CIVO MEAT punya 8 cabang Kak: Tangerang, Serpong, Jakarta Barat, Jakarta Pusat, Jakarta Utara (Sunter), Bandung, Semarang, dan Surabaya 📍 Mau tahu alamat cabang yang mana?",
  },
  {
    keywords: ["alamat"],
    reply: "Mau tahu alamat cabang mana Kak? Kita ada di: Tangerang, Serpong, Jakarta Barat, Jakarta Pusat, Sunter, Bandung, Semarang, Surabaya. Sebut kotanya ya! 📍",
  },

  // ── MINIMUM ORDER ──
  {
    keywords: ["minimum", "order"],
    reply: "Tidak ada minimum order Kak! Mau beli 500g satu pack juga boleh 👍 Tapi kalau belanja Rp500rb ke atas dapet diskon 3% otomatis lho 😉",
  },
  {
    keywords: ["minimal", "belanja"],
    reply: "Nggak ada minimal belanja Kak! Bebas mau order berapa aja. Oh ya, Rp500rb ke atas otomatis dapet diskon 3% 😉",
  },

  // ── KOMPLAIN ──
  {
    keywords: ["komplain"],
    reply: "Kalau ada keluhan, langsung foto produknya dan kirim ke WhatsApp admin 0817-1717-9291 ya Kak. Kita proses dalam 2×24 jam. CIVO MEAT jamin kualitas! 🙏",
  },
  {
    keywords: ["rusak"],
    reply: "Waduh maaf Kak 🙏 Langsung foto produknya kirim ke WA admin 0817-1717-9291 ya, kita proses penggantian dalam 2×24 jam!",
  },

  // ── PENYIMPANAN ──
  {
    keywords: ["simpan", "berapa", "lama"],
    reply: "Produk frozen vacuum pack kita tahan 3-6 bulan di freezer Kak. Setelah dicairkan, sebaiknya dimasak dalam 24 jam ya ❄️",
  },
  {
    keywords: ["freezer"],
    reply: "Simpan di freezer ya Kak, tahan 3-6 bulan dalam kemasan vacuum. Kalau mau pakai, pindahin ke chiller semalaman untuk thawing pelan-pelan — hasilnya lebih bagus ❄️",
  },

  // ── SAMCAN ON vs OFF ──
  {
    keywords: ["beda", "samcan"],
    reply: "SamcanOn = Pork Belly dengan kulit — cocok buat Sio Bak, Babi Hong, Samcan Goreng Crispy. SamcanOff = tanpa kulit — pas buat Samgyeopsal Korean BBQ, slice tipis. Dua-duanya enak Kak, tergantung masakan! 🥩",
  },
  {
    keywords: ["samcan", "kulit"],
    reply: "SamcanOn (dengan kulit) cocok buat masakan yang butuh kulit crispy: Sio Bak, Babi Hong, Samcan Goreng. SamcanOff (tanpa kulit) lebih pas buat Korean BBQ Samgyeopsal 🥩 Mau yang mana Kak?",
  },

  // ── CARA ORDER ──
  {
    keywords: ["cara", "order"],
    reply: "Gampang Kak! Tinggal bilang aja mau produk apa dan berapa banyak, Pak Civo buatkan link checkout Shopify-nya langsung. Atau bisa order langsung di toko Shopify kita juga 🛒",
  },
  {
    keywords: ["cara", "beli"],
    reply: "Bilang aja mau beli apa Kak, Pak Civo siapkan link checkout-nya! Atau bisa langsung ke Shopify store kita. Gampang banget 🛒",
  },

  // ── DISKON ──
  {
    keywords: ["diskon"],
    reply: "Ada diskon otomatis Kak! 🎉 Belanja Rp500rb ke atas diskon 3%, Rp750rb ke atas 4%, Rp1jt ke atas dapet 5%. Makin banyak makin hemat! 😊",
  },
  {
    keywords: ["promo"],
    reply: "Promo kita: diskon otomatis mulai belanja Rp500rb (3%), Rp750rb (4%), Rp1jt (5%) Kak! Plus frozen vacuum pack tahan 3-6 bulan, jadi bisa stok sekalian biar makin hemat 🎉",
  },

  // ── HALAL ──
  {
    keywords: ["halal"],
    reply: "Produk CIVO MEAT adalah daging babi Kak, jadi non-halal ya. Kita spesialis daging babi premium sejak 2016 🥩",
  },

  // ── WHATSAPP ──
  {
    keywords: ["whatsapp"],
    reply: "Hubungi admin CIVO MEAT di WhatsApp 0817-1717-9291 ya Kak! Untuk order bisa langsung lewat Pak Civo di sini juga 📱",
  },
  {
    keywords: ["kontak"],
    reply: "WhatsApp admin: 0817-1717-9291. Atau langsung chat sama Pak Civo di sini buat order dan tanya-tanya ya Kak! 📱",
  },

  // ── RESEP SINGKAT ──
  {
    keywords: ["resep", "sio", "bak"],
    reply: "Sio Bak 101 Kak 👨‍🍳: SamcanOn (kulit wajib!) → siram kulit air panas → keringkan → tusuk-tusuk kulit pakai garpu → olesi cuka + garam di kulit → bumbu bawang putih+five spice di daging → oven 180°C 1 jam → broil 5 menit sampai kulit melepuh. Gampang dan hasilnya WOW! Mau Pak Civo carikan SamcanOn Kulit?",
  },
  {
    keywords: ["resep", "babi", "kecap"],
    reply: "Babi Kecap classic 👨‍🍳: Samcan potong dadu → goreng sebentar → tumis bawang putih+jahe → masukkan kecap manis+kecap asin+gula → masak pelan sampai empuk dan caramelized. Produknya udah ready Kak: Samcan Potong Dadu 500g. Mau dibuatkan checkout? 🥩",
  },
];

// Match FAQ: semua keywords harus ada di pesan user (normalized)
function matchFAQ(userMessage) {
  const normalized = normalizeText(userMessage);
  for (const faq of FAQ_TEMPLATES) {
    if (faq.keywords.every(kw => normalized.includes(kw))) {
      return faq.reply;
    }
  }
  return null;
}
// ─────────────────────────────────────────────────────────────

function buildSystemPrompt(productContext) {
  return `Kamu adalah PAK CIVO 👨‍🍳, AI sales assistant CIVO MEAT, penjual daging babi premium sejak 2016.

BAHASA & GAYA:
- Pakai Bahasa Indonesia santai, profesional, hangat.
- Panggil customer "Kak".
- Jawaban sangat pendek: maksimal 2-3 kalimat.
- Emoji secukupnya.
- Jangan bertele-tele.

ATURAN SUMBER DATA PRODUK:
- Produk, harga, availability, dan varian HANYA boleh berasal dari DATA PRODUK SHOPIFY di bawah.
- Jangan memakai daftar produk lama, jangan mengarang harga, jangan mengarang stok.
- Jangan tampilkan SKU ke customer.
- DATA PRODUK SHOPIFY sudah berisi hasil search spesifik + catalog-wide fallback dari Shopify. Jawab berdasarkan data ini. Jangan menjawab “tidak ada” bila ada produk yang relevan di data, termasuk kategori jeroan/jantung/hati/usus/paru/lidah/kaki/kulit/lemak. Kalau data tetap tidak berisi produk relevan, bilang “Pak Civo belum ketemu di katalog yang terbaca” dan minta kata kunci lain. KECUALI untuk 5 best seller display: Samcan Lokal 1kg, Babi Giling 500g, Paikut Sop 500g, Kapsim 1kg, Samcan Import 1kg — produk ini wajib dianggap ada bila muncul di DATA PRODUK SHOPIFY/hint best seller dan availableForSale bukan false.
- Kalau availableForSale=false, jelaskan bahwa produk sedang tidak bisa dibeli.

ATURAN MENJAWAB PRODUK:
- Kalau customer tanya produk spesifik atau kategori seperti jeroan, sebutkan maksimal 2 pilihan paling relevan dari DATA PRODUK SHOPIFY.
- Setiap menyebut produk, sertakan harga singkat, contoh: "Bacon 500g 60rb".
- Boleh jelaskan beda produk berdasarkan title, description, productType, dan tags Shopify.
- Kalau description Shopify kosong, jangan mengarang terlalu detail. Jelaskan secara umum dan singkat.

ATURAN CHECKOUT SHOPIFY:
- Checkout sekarang harus lewat Shopify, bukan WhatsApp admin.
- Jika customer baru tertarik, tanya konfirmasi dulu: "Mau Pak Civo buatkan checkout Shopify sekarang, Kak?"
- Jika customer sudah jelas konfirmasi beli/checkout/ambil/masukkan/iya/ok/boleh dan produk sudah jelas, sisipkan command internal persis format:
  <<SHOPIFY_CART|VARIANT_ID|QTY>>
- Ganti VARIANT_ID dengan variantId dari DATA PRODUK SHOPIFY. Jika variantId tertulis "belum_terhubung" atau kosong, jangan buat command checkout; arahkan customer klik tombol + Keranjang/product card.
- QTY harus angka. Jika customer tidak menyebut jumlah, pakai 1.
- Command internal jangan dijelaskan ke customer.
- Setelah command, tulis natural: "Siap Kak, Pak Civo buatkan link checkout Shopify-nya ya."

ATURAN SALES:
- Bantu customer memilih produk berdasarkan masakan, jumlah orang, dan budget.
- Untuk upsell, jangan menjual “lebih mahal”; jelaskan “lebih cocok” atau “hasil lebih juicy/premium” jika memang sesuai data produk.
- Untuk BBQ, tanyakan Korean BBQ atau Western BBQ jika belum jelas.
- Untuk jumlah orang, bantu estimasi: BBQ 200-250g/orang, masakan berkuah 150-200g/orang.
- Ajakan checkout harus natural, jangan memaksa.

STRATEGI SOFT-SELLING (pilih MAX 1 hook per jawaban, taruh di AKHIR, max 1 kalimat):

HOOK YANG BISA DIPAKAI:
- SOCIAL PROOF: "Customer BBQ biasanya sekalian ambil [produk pelengkap] buat variasi Kak"
- LOSS AVERSION: "Sayang Kak totalnya tinggal dikit lagi 500rb — diskon 3% langsung aktif"
- ANCHORING: frame harga per porsi/per orang supaya terasa murah vs makan di luar
- RECIPROCITY: kasih 1 tip masak singkat → sambung ke produk tambahan
- YES-LADDER: SETELAH customer confirm beli, tawarkan 1 add-on kecil
- KONTRAS: bantu lihat beda 2 opsi tanpa merendahkan — "Lokal lebih lean, Import lebih marbling"

CROSS-SELL MAP (referensi, jangan tampilkan ke customer):
Samcan → Sayur Asin / PorkRibs | PorkRibs → SamcanOn | Samgyeopsal → Moksal Slice | Kapsim → Samgyeopsal | PorkLoin → Samcan | Giling → PorkRibs | Bacon → PorkBelly

DISKON LADDER (sebut HANYA kalau total mendekati/melewati threshold):
Rp500rb=3% | Rp750rb=4% | Rp1jt=5%

ATURAN KERAS:
- Jawab pertanyaan DULU, hook di akhir (1 kalimat).
- Customer tolak → STOP. Jangan maksa/ulangi hook.
- Jangan bohong soal stok atau buat fake urgency.
- SamcanOn vs SamcanOff: jelaskan fakta, JANGAN rekomendasikan salah satu.

FAKTA CIVO MEAT (gunakan saat customer tanya):
- 8 cabang: Tangerang, Serpong, JakBar, JakPus, Sunter, Bandung, Semarang, Surabaya.
- Pengiriman cepat same-day/instant khusus Jakarta & Tangerang; cutoff same-day 14:00, instant 16:00.
- Pembayaran: transfer bank, e-wallet, QRIS via checkout Shopify.
- Tidak ada minimum order.
- Diskon otomatis: Rp500rb=3%, Rp750rb=4%, Rp1jt=5%.
- Frozen vacuum tahan 3-6 bulan di freezer.
- Komplain: foto + WA admin 0817-1717-9291, diproses 2×24 jam.
- Produk non-halal (daging babi).
- Estimasi porsi: BBQ 200-250g/orang, berkuah 150-200g/orang.
- SamcanOn (kulit) → Sio Bak, Babi Hong, Crispy. SamcanOff (tanpa kulit) → Samgyeopsal Korean BBQ.

DATA PRODUK SHOPIFY SAAT INI:
${productContext}`;
}

async function callGemini(systemPrompt, contents) {
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    try {
      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: {
            temperature: 0.38,
            maxOutputTokens: 300,
          },
        }),
      }, 9000);

      if (response.status === 503 || response.status === 429) {
        console.warn(`Model ${model} unavailable (${response.status}), trying next...`);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Model ${model} error ${response.status}:`, errText);
        continue;
      }

      const data = await response.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (text) return text;
    } catch (error) {
      console.error(`Model ${model} fetch error:`, error.message);
      continue;
    }
  }

  return null;
}

async function processShopifyCartCommands(reply) {
  const commandRegex = /<<SHOPIFY_CART\|([^|>]+)\|(\d+)>>/g;
  const matches = [...String(reply || "").matchAll(commandRegex)];
  let cleanReply = String(reply || "").replace(commandRegex, "").replace(/\n{3,}/g, "\n\n").trim();

  if (matches.length === 0) {
    return { reply: cleanReply, checkoutUrl: null, cart: null };
  }

  // Faster than Storefront cartCreate: build Shopify cart permalink directly.
  const merged = new Map();
  for (const match of matches) {
    const variantId = String(match[1] || "").trim();
    const quantity = Math.max(1, Math.min(Number(match[2] || 1), 99));
    if (!variantId || !getNumericVariantId(variantId)) continue;
    merged.set(variantId, (merged.get(variantId) || 0) + quantity);
  }

  const commands = Array.from(merged.entries()).map(([variantId, quantity]) => ({
    variantId,
    quantity: Math.min(quantity, 99),
  }));

  const checkoutUrl = buildCartPermalinkFromCommands(commands);
  if (checkoutUrl) {
    cleanReply = `${cleanReply}\n\n🛒 Checkout Shopify:\n${checkoutUrl}`;
  }

  return {
    reply: cleanReply,
    checkoutUrl: checkoutUrl || null,
    cart: checkoutUrl ? { checkoutUrl, lines: commands } : null,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  cleanupRateMap();

  const rl = checkRateLimit(req);
  if (!rl.allowed) {
    return res.status(429).json({
      error: "Terlalu banyak permintaan. Coba lagi dalam 1 menit ya Kak 😊",
      reply: "Maaf Kak, terlalu banyak pesan! Tunggu sebentar ya 🙏",
    });
  }

  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      error: "GEMINI_API_KEY belum terpasang di server.",
      reply: "Konfigurasi AI belum lengkap, Kak.",
    });
  }

  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_STOREFRONT_ACCESS_TOKEN) {
    return res.status(500).json({
      error: "Shopify env belum lengkap.",
      reply: "Konfigurasi produk Shopify belum lengkap, Kak.",
    });
  }

  try {
    const { messages, catalogHints } = parseBody(req);

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Pesan tidak boleh kosong" });
    }

    const trimmedMessages = messages.slice(-MAX_HISTORY);

    // ── FAQ INTERCEPTOR: jawaban instan tanpa LLM ──
    const latestUserMsg = [...trimmedMessages].reverse().find(m => m.role === "user")?.content || "";
    const faqReply = matchFAQ(latestUserMsg);
    if (faqReply && trimmedMessages.length <= 2) {
      // Hanya intercept di awal percakapan (1-2 pesan pertama).
      // Kalau sudah deep conversation, tetap pakai LLM biar kontekstual.
      return res.status(200).json({
        role: "assistant",
        reply: faqReply,
        checkoutUrl: null,
        cart: null,
        faqHit: true,
      });
    }

    const searchQuery = extractSearchQuery(trimmedMessages);

    let products = [];
    try {
      products = await searchShopifyProducts(searchQuery);
      products = mergeProductLists(products, relevantCatalogHintProducts(catalogHints, searchQuery));
      products = rankProductsForQuery(products, searchQuery, 12);

      // Fallback: jika customer bertanya umum atau query tidak cocok, ambil produk awal.
      if (products.length === 0 && searchQuery) {
        products = await searchShopifyProducts("");
      }
    } catch (shopifyError) {
      console.error("Shopify product fetch error:", shopifyError.message);
      products = mergeProductLists(fallbackProductsForQuery(searchQuery), relevantCatalogHintProducts(catalogHints, searchQuery), bestSellerFallbackForQuery(searchQuery));
    }

    if (!products.length) {
      products = mergeProductLists(fallbackProductsForQuery(searchQuery), relevantCatalogHintProducts(catalogHints, searchQuery), bestSellerFallbackForQuery(searchQuery));
    }

    const productContext = buildProductContext(products);
    const systemPrompt = buildSystemPrompt(productContext);

    const contents = trimmedMessages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: String(message.content || "") }],
    }));

    const text = await callGemini(systemPrompt, contents);

    if (!text) {
      return res.status(200).json({
        role: "assistant",
        reply: "Maaf Kak, Pak Civo sedang ramai sebentar 😅 Coba lagi ya.",
      });
    }

    const processed = await processShopifyCartCommands(text);

    return res.status(200).json({
      role: "assistant",
      reply: processed.reply,
      checkoutUrl: processed.checkoutUrl,
      cart: processed.cart,
      productsUsed: products.map((product) => ({
        id: product.id,
        title: product.title,
        handle: product.handle,
        description: product.description || "",
        productType: product.productType || "",
        tags: product.tags || [],
        image: product.image || null,
        variants: product.variants.map((variant) => ({
          id: variant.id,
          title: variant.title,
          price: variant.price,
          currencyCode: variant.currencyCode,
          availableForSale: variant.availableForSale,
        })),
      })),
    });
  } catch (error) {
    console.error("Chat handler error:", error);
    return res.status(200).json({
      role: "assistant",
      reply: "Maaf Kak, ada gangguan sebentar 🙏 Coba kirim ulang pertanyaannya ya.",
    });
  }
};
