// api/chat.js
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

const MAX_HISTORY = 8;

const MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-1.5-flash",
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
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

async function shopifyGraphQL(query, variables = {}) {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_STOREFRONT_ACCESS_TOKEN) {
    throw new Error("Shopify environment variables belum lengkap.");
  }

  const response = await fetch(
    `https://${SHOPIFY_STORE_DOMAIN}/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": SHOPIFY_STOREFRONT_ACCESS_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    }
  );

  const data = await response.json();

  if (!response.ok || data.errors) {
    const message = JSON.stringify(data.errors || data);
    throw new Error(`Shopify API error ${response.status}: ${message}`);
  }

  return data.data;
}

async function searchShopifyProducts(rawQuery) {
  const queryText = String(rawQuery || "").trim();

  const query = `
    query SearchProducts($query: String) {
      products(first: 12, query: $query) {
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
                  sku
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

  const data = await shopifyGraphQL(query, { query: queryText || null });

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
          sku: variant.sku || null,
          availableForSale: !!variant.availableForSale,
          price: Number(variant.price.amount),
          currencyCode: variant.price.currencyCode,
        };
      }),
    };
  });
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
            `variantId=${variant.id}`,
            `namaVarian=${variant.title}`,
            `harga=${formatRupiahShort(variant.price)} (${variant.price} ${variant.currencyCode})`,
            `availableForSale=${variant.availableForSale}`,
            variant.sku ? `sku=${variant.sku}` : "sku=-",
          ].join(" | ");
        })
        .join("\n    ");

      return [
        `${index + 1}. ${product.title}`,
        product.description ? `   Deskripsi: ${product.description}` : "   Deskripsi: -",
        product.productType ? `   Tipe: ${product.productType}` : "   Tipe: -",
        product.tags?.length ? `   Tags: ${product.tags.join(", ")}` : "   Tags: -",
        `   Handle: ${product.handle}`,
        `   Varian:\n    ${variants}`,
      ].join("\n");
    })
    .join("\n\n");
}

function buildSystemPrompt(productContext) {
  return `Kamu adalah PAK CIVO 👨‍🍳, AI sales assistant CIVO MEAT, penjual daging babi premium sejak 2016.

BAHASA & GAYA:
- Pakai Bahasa Indonesia santai, profesional, hangat.
- Panggil customer "Kak".
- Jawaban pendek: maksimal 3-4 kalimat.
- Emoji secukupnya.
- Jangan bertele-tele.

ATURAN SUMBER DATA PRODUK:
- Produk, harga, availability, dan varian HANYA boleh berasal dari DATA PRODUK SHOPIFY di bawah.
- Jangan memakai daftar produk lama, jangan mengarang harga, jangan mengarang stok.
- Jangan tampilkan SKU ke customer.
- Kalau produk tidak ditemukan di DATA PRODUK SHOPIFY, bilang belum ketemu dan minta kata kunci lain.
- Kalau availableForSale=false, jelaskan bahwa produk sedang tidak bisa dibeli.

ATURAN MENJAWAB PRODUK:
- Kalau customer tanya produk spesifik, sebutkan maksimal 3 pilihan paling relevan.
- Setiap menyebut produk, sertakan harga singkat, contoh: "Bacon 500g 60rb".
- Boleh jelaskan beda produk berdasarkan title, description, productType, dan tags Shopify.
- Kalau description Shopify kosong, jangan mengarang terlalu detail. Jelaskan secara umum dan singkat.

ATURAN CHECKOUT SHOPIFY:
- Checkout sekarang harus lewat Shopify, bukan WhatsApp admin.
- Jika customer baru tertarik, tanya konfirmasi dulu: "Mau Pak Civo buatkan checkout Shopify sekarang, Kak?"
- Jika customer sudah jelas konfirmasi beli/checkout/ambil/masukkan/iya/ok/boleh dan produk sudah jelas, sisipkan command internal persis format:
  <<SHOPIFY_CART|VARIANT_ID|QTY>>
- Ganti VARIANT_ID dengan variantId dari DATA PRODUK SHOPIFY.
- QTY harus angka. Jika customer tidak menyebut jumlah, pakai 1.
- Command internal jangan dijelaskan ke customer.
- Setelah command, tulis natural: "Siap Kak, Pak Civo buatkan link checkout Shopify-nya ya."

ATURAN SALES:
- Bantu customer memilih produk.
- Untuk BBQ, tanyakan Korean BBQ atau Western BBQ jika belum jelas.
- Untuk jumlah orang, bantu estimasi: BBQ 200-250g/orang, masakan berkuah 150-200g/orang.
- Ajakan checkout harus natural, jangan memaksa.

DATA PRODUK SHOPIFY SAAT INI:
${productContext}`;
}

async function callGemini(systemPrompt, contents) {
  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: {
            temperature: 0.45,
            maxOutputTokens: 700,
          },
        }),
      });

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
  const commands = [...reply.matchAll(commandRegex)];

  let cleanReply = reply.replace(commandRegex, "").replace(/\n{3,}/g, "\n\n").trim();

  if (commands.length === 0) {
    return {
      reply: cleanReply,
      checkoutUrl: null,
      cart: null,
    };
  }

  const first = commands[0];
  const variantId = first[1];
  const quantity = Number(first[2] || 1);

  try {
    const cart = await createShopifyCart(variantId, quantity);
    const checkoutUrl = cart.checkoutUrl;

    cleanReply = `${cleanReply}\n\n🛒 Checkout Shopify:\n${checkoutUrl}`;

    return {
      reply: cleanReply,
      checkoutUrl,
      cart,
    };
  } catch (error) {
    console.error("Cart create error:", error.message);
    return {
      reply:
        cleanReply +
        "\n\nMaaf Kak, link checkout Shopify belum berhasil dibuat. Coba ulangi sebentar lagi ya.",
      checkoutUrl: null,
      cart: null,
    };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Pesan tidak boleh kosong" });
    }

    const trimmedMessages = messages.slice(-MAX_HISTORY);
    const searchQuery = extractSearchQuery(trimmedMessages);

    let products = [];
    try {
      products = await searchShopifyProducts(searchQuery);

      // Fallback: jika customer bertanya umum atau query tidak cocok, ambil produk awal.
      if (products.length === 0 && searchQuery) {
        products = await searchShopifyProducts("");
      }
    } catch (shopifyError) {
      console.error("Shopify product fetch error:", shopifyError.message);
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
        title: product.title,
        variants: product.variants.map((variant) => ({
          id: variant.id,
          price: variant.price,
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
