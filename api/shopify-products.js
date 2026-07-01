// api/shopify-products.js
// v6.0.8 — Shopify showroom search with public-product JSON image enrichment for Pak Civo Live

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shopifySearchAliases(rawQuery) {
  const q = normalizeText(rawQuery);
  const aliases = new Set([String(rawQuery || "").trim()].filter(Boolean));
  const add = (arr) => arr.forEach((v) => aliases.add(v));

  if (/samcan|pork belly|wuhua/.test(q) && /lokal|local/.test(q)) add(["Samcan Lokal 1kg", "Samcan Babi Pork Belly Lokal 1kg", "Pork Belly Lokal", "samcan lokal"]);
  if (/giling|ground|minced|mince/.test(q)) add(["Babi Giling 500g", "Daging Babi Giling 500g", "Babi Giling", "giling babi", "ground pork", "minced pork"]);
  if (/paikut|bakut|bak kut|ribs?|iga|sop/.test(q)) add(["Paikut Sop 500g", "Paikut Sop", "Paikut", "Bakut", "Bak Kut", "Pork Ribs Sop", "ribs chopped", "iga babi"]);
  if (/kapsim|kasim|shoulder|collar/.test(q)) add(["Kapsim 1kg", "Kapsim Babi 1kg", "Shoulder Babi 1kg", "Pork Shoulder", "kasim"]);
  if (/samcan|pork belly|wuhua/.test(q) && /import|impor/.test(q)) add(["Samcan Import 1kg", "Pork Belly Samcan Import 1kg", "Pork Belly Import", "Wuhua Rou Import"]);

  if (/jeroan|organ|offal/.test(q)) add(["jeroan", "organ", "offal", "jantung", "hati", "usus", "paru", "lidah", "ginjal", "kuping", "telinga", "pork organ"]);
  if (/jantung|heart/.test(q)) add(["jantung", "jantung babi", "pork heart", "heart"]);
  if (/hati|liver|ati/.test(q)) add(["hati", "hati babi", "pork liver", "liver"]);
  if (/usus|intestine|intestines/.test(q)) add(["usus", "usus babi", "pork intestine", "intestine"]);
  if (/paru|lung/.test(q)) add(["paru", "paru babi", "pork lung", "lung"]);
  if (/ginjal|kidney/.test(q)) add(["ginjal", "ginjal babi", "pork kidney", "kidney"]);
  if (/lidah|tongue/.test(q)) add(["lidah", "lidah babi", "pork tongue", "tongue"]);
  if (/kuping|telinga|ear/.test(q)) add(["kuping", "telinga", "kuping babi", "pork ear", "ear"]);
  if (/kaki|feet|trotter|kikil/.test(q)) add(["kaki babi", "pork feet", "pork trotter", "trotter", "kaki"]);
  if (/lemak|fat|lard/.test(q)) add(["lemak babi", "pork fat", "fat", "lard"]);
  if (/kulit|skin/.test(q)) add(["kulit babi", "pork skin", "skin"]);
  if (/daging|meat/.test(q)) add(["daging babi", "pork meat", "pork"]);

  return Array.from(aliases).filter(Boolean).slice(0, 12);
}

function mergeProducts(...lists) {
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
        merged.set(key, {
          ...existing,
          ...product,
          image: product.image || existing.image || null,
          featuredImage: product.featuredImage || existing.featuredImage || null,
          images: Array.isArray(product.images) && product.images.length ? product.images : existing.images,
          variants: Array.isArray(product.variants) && product.variants.length ? product.variants : existing.variants
        });
      }
    }
  }
  return Array.from(merged.values());
}

const STOP_WORDS = new Set(["ada", "apa", "apakah", "berapa", "harga", "mau", "kak", "pak", "civo", "produk", "ready", "stok", "stock", "punya", "tersedia", "cari", "carikan", "jual", "jualan", "daging", "babi", "yang", "untuk", "buat"]);

function productSearchText(product) {
  const variants = Array.isArray(product?.variants) ? product.variants.map((v) => v?.title || "").join(" ") : "";
  return normalizeText([product?.title, product?.handle, product?.description, product?.productType, Array.isArray(product?.tags) ? product.tags.join(" ") : "", variants].filter(Boolean).join(" "));
}

function expandedTerms(rawQuery) {
  const q = normalizeText(rawQuery);
  const terms = new Set(q.split(" ").filter((w) => w.length >= 3 && !STOP_WORDS.has(w)));
  const add = (...items) => items.forEach((item) => String(item || "").split(/\s+/).forEach((w) => {
    const n = normalizeText(w);
    if (n && n.length >= 3 && !STOP_WORDS.has(n)) terms.add(n);
  }));
  if (/jeroan|organ|offal/.test(q)) add("jeroan", "organ", "offal", "jantung", "heart", "hati", "liver", "usus", "intestine", "paru", "lung", "ginjal", "kidney", "lidah", "tongue", "kuping", "telinga", "ear");
  if (/jantung|heart/.test(q)) add("jantung", "heart");
  if (/hati|liver|ati/.test(q)) add("hati", "liver", "ati");
  if (/usus|intestine/.test(q)) add("usus", "intestine");
  if (/paru|lung/.test(q)) add("paru", "lung");
  if (/ginjal|kidney/.test(q)) add("ginjal", "kidney");
  if (/lidah|tongue/.test(q)) add("lidah", "tongue");
  if (/kuping|telinga|ear/.test(q)) add("kuping", "telinga", "ear");
  return Array.from(terms);
}

function scoreProduct(product, rawQuery) {
  const q = normalizeText(rawQuery);
  const text = productSearchText(product);
  if (!q || !text) return 0;
  let score = text.includes(q) ? 80 : 0;
  for (const term of expandedTerms(rawQuery)) if (text.includes(term)) score += term.length >= 6 ? 18 : 10;
  const checks = [
    [/jantung|heart/, /jantung|heart/], [/hati|liver|ati/, /hati|liver|ati/], [/usus|intestine/, /usus|intestine/],
    [/paru|lung/, /paru|lung/], [/ginjal|kidney/, /ginjal|kidney/], [/lidah|tongue/, /lidah|tongue/],
    [/kuping|telinga|ear/, /kuping|telinga|ear/], [/giling|ground|minced|mince/, /giling|ground|minced|mince/],
    [/paikut|bakut|ribs?|iga|sop/, /paikut|bakut|ribs?|iga|sop/], [/kapsim|kasim|shoulder|collar/, /kapsim|kasim|shoulder|collar/],
    [/samcan|pork\s*belly|wuhua/, /samcan|pork\s*belly|wuhua/]
  ];
  for (const [queryRe, textRe] of checks) if (queryRe.test(q) && textRe.test(text)) score += 50;
  if (/jeroan|organ|offal/.test(q) && /jantung|heart|hati|liver|usus|intestine|paru|lung|ginjal|kidney|lidah|tongue|kuping|telinga|ear/.test(text)) score += 45;
  if (product?.variants?.some((v) => v?.availableForSale !== false)) score += 3;
  if (product?.image) score += 1;
  return score;
}

function rankProducts(products, rawQuery, limit = 20) {
  if (!rawQuery) return (Array.isArray(products) ? products : []).slice(0, limit);
  return (Array.isArray(products) ? products : [])
    .map((product) => ({ product, score: scoreProduct(product, rawQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.product);
}

const SHOWROOM_SLOTS = [
  {
    slotKey: "samcan-lokal-1kg",
    label: "Samcan Lokal 1kg",
    queries: ["Samcan Lokal 1kg", "Samcan Babi Pork Belly Lokal 1kg", "Pork Belly Lokal", "samcan lokal"],
    must: [/samcan|pork\s*belly|wuhua/],
    prefer: [/lokal|local/],
    exclude: [/import|impor|slice|samgyeopsal|skin\s*off|without\s*skin|tanpa\s*kulit|tipis|tebal/]
  },
  {
    slotKey: "babi-giling-500g",
    label: "Babi Giling 500g",
    queries: ["Babi Giling 500g", "Daging Babi Giling 500g", "Babi Giling", "giling babi", "ground pork", "minced pork"],
    must: [/babi\s*giling|giling\s*babi|ground|minced|mince/],
    prefer: [/500\s*g|500\s*gr|500g/],
    exclude: []
  },
  {
    slotKey: "paikut-sop-500g",
    label: "Paikut Sop 500g",
    queries: ["Paikut Sop 500g", "Paikut Sop", "Paikut", "Bakut", "Bak Kut", "Pork Ribs Sop", "ribs chopped", "iga babi"],
    must: [/paikut|bakut|bak\s*kut|ribs?|iga/],
    prefer: [/sop|soup|chopped|potong|500\s*g|500g/],
    exclude: [/bbq|barbeque|grill|import|impor/]
  },
  {
    slotKey: "kapsim-1kg",
    label: "Kapsim 1kg",
    queries: ["Kapsim 1kg", "Kapsim Babi 1kg", "Shoulder Babi 1kg", "Pork Shoulder", "kasim", "collar"],
    must: [/kapsim|kasim|shoulder|collar/],
    prefer: [/1\s*kg|1000\s*g|1kg/],
    exclude: []
  },
  {
    slotKey: "samcan-import-1kg",
    label: "Samcan Import 1kg",
    queries: ["Samcan Import 1kg", "Pork Belly Samcan Import 1kg", "Pork Belly Import", "Wuhua Rou Import"],
    must: [/samcan|pork\s*belly|wuhua/],
    prefer: [/import|impor/],
    exclude: [/lokal|local|slice|samgyeopsal|skin\s*off|without\s*skin|tanpa\s*kulit|tipis|tebal/]
  }
];

function productHasImage(product) {
  if (product?.image) return true;
  if (product?.featuredImage?.url) return true;
  if (Array.isArray(product?.images) && product.images.some((img) => img?.url || img)) return true;
  if (Array.isArray(product?.variants) && product.variants.some((variant) => variant?.image || variant?.image?.url)) return true;
  return false;
}

function normalizeShopifyImageUrl(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const clean = value.trim();
    if (!clean) return "";
    if (/^https?:\/\//i.test(clean)) return clean;
    if (/^\/\//.test(clean)) return `https:${clean}`;
    if (/^\//.test(clean)) return `https://${process.env.SHOPIFY_PUBLIC_STORE_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN || "civo-meat.myshopify.com"}${clean}`;
    return "";
  }
  if (typeof value === "object") {
    return normalizeShopifyImageUrl(
      value.url || value.src || value.originalSrc || value.transformedSrc || value.secure_url || value.image || value.featured_image || value.featuredImage
    );
  }
  return "";
}

function firstImageFromAnyProductShape(product) {
  const direct = normalizeShopifyImageUrl(
    product?.image || product?.featuredImage || product?.featured_image || product?.featuredImageUrl || product?.imageUrl || product?.src
  );
  if (direct) return direct;

  if (Array.isArray(product?.images)) {
    for (const image of product.images) {
      const url = normalizeShopifyImageUrl(image);
      if (url) return url;
    }
  }

  if (Array.isArray(product?.variants)) {
    for (const variant of product.variants) {
      const url = normalizeShopifyImageUrl(variant?.image || variant?.featured_image || variant?.featuredImage || variant?.imageUrl);
      if (url) return url;
    }
  }

  return "";
}

function numericIdFromGid(value) {
  const match = String(value || "").match(/\/(\d+)$/);
  return match ? match[1] : String(value || "");
}

async function fetchPublicProductJson(shop, handle) {
  if (!shop || !handle) return null;
  const url = `https://${shop}/products/${encodeURIComponent(handle)}.js`;
  const response = await fetch(url, {
    method: "GET",
    headers: { "Accept": "application/json,text/javascript,*/*" }
  });
  if (!response.ok) return null;
  return await response.json();
}

async function enrichProductImageFromPublicJson(product, { shop }) {
  if (!product || !product.handle) return product;

  // Storefront API images are already Shopify images. The public .js endpoint is
  // used only when Storefront returns product data but image fields are empty.
  if (firstImageFromAnyProductShape(product)) return product;

  try {
    const publicProduct = await fetchPublicProductJson(shop, product.handle);
    if (!publicProduct) return product;

    const publicImages = []
      .concat(Array.isArray(publicProduct.images) ? publicProduct.images : [])
      .concat(publicProduct.featured_image ? [publicProduct.featured_image] : [])
      .map((image) => normalizeShopifyImageUrl(image))
      .filter(Boolean)
      .filter((value, index, array) => array.indexOf(value) === index);

    const primaryImage = normalizeShopifyImageUrl(publicProduct.featured_image) || publicImages[0] || "";
    if (!primaryImage) return product;

    const publicVariants = Array.isArray(publicProduct.variants) ? publicProduct.variants : [];
    const variantImageByNumericId = new Map();
    for (const variant of publicVariants) {
      const vImage = normalizeShopifyImageUrl(variant?.featured_image || variant?.image || variant?.image_url) || primaryImage;
      if (variant?.id && vImage) variantImageByNumericId.set(String(variant.id), vImage);
    }

    const variants = Array.isArray(product.variants) ? product.variants.map((variant) => {
      const currentImage = normalizeShopifyImageUrl(variant?.image || variant?.featuredImage || variant?.featured_image);
      const numericId = numericIdFromGid(variant?.id);
      return {
        ...variant,
        image: currentImage || variantImageByNumericId.get(numericId) || primaryImage,
        imageAltText: variant?.imageAltText || publicProduct.title || product.title || ""
      };
    }) : [];

    return {
      ...product,
      image: primaryImage,
      featuredImage: { url: primaryImage, altText: publicProduct.title || product.title || "" },
      images: publicImages.map((url) => ({ url, altText: publicProduct.title || product.title || "" })),
      variants
    };
  } catch (error) {
    console.warn("Public Shopify product image enrichment skipped:", product.handle, error.message);
    return product;
  }
}

async function enrichProductsWithPublicImages(products, { shop }) {
  const list = Array.isArray(products) ? products : [];
  return Promise.all(list.map((product) => enrichProductImageFromPublicJson(product, { shop })));
}

function hasAvailableVariant(product) {
  return Array.isArray(product?.variants) && product.variants.some((variant) => variant?.id && variant.availableForSale !== false);
}

function scoreShowroomProduct(product, slot) {
  const text = productSearchText(product);
  const title = normalizeText(product?.title || "");
  if (!text) return -999;

  let score = 0;
  if (hasAvailableVariant(product)) score += 15;
  if (productHasImage(product)) score += 35;
  if (/1\s*kg|1000\s*g|1kg/.test(text) && /1kg/.test(normalizeText(slot.label))) score += 8;
  if (/500\s*g|500\s*gr|500g/.test(text) && /500g/.test(normalizeText(slot.label))) score += 8;

  for (const re of slot.must || []) score += re.test(text) ? 80 : -120;
  for (const re of slot.prefer || []) if (re.test(text)) score += 35;
  for (const re of slot.exclude || []) if (re.test(text)) score -= 90;

  for (const query of slot.queries || []) {
    const q = normalizeText(query);
    if (!q) continue;
    if (title === q) score += 80;
    else if (title.includes(q) || text.includes(q)) score += 45;
  }
  return score;
}

function pickShowroomProducts(products) {
  const pool = Array.isArray(products) ? products : [];
  const used = new Set();
  return SHOWROOM_SLOTS.map((slot) => {
    let best = null;
    let bestScore = -999;
    for (const product of pool) {
      const key = product?.id || product?.handle || product?.title;
      if (!key || used.has(key)) continue;
      const score = scoreShowroomProduct(product, slot);
      if (score > bestScore) {
        best = product;
        bestScore = score;
      }
    }
    if (!best || bestScore < 25) return null;
    used.add(best.id || best.handle || best.title);
    return { ...best, slotKey: slot.slotKey, slotLabel: slot.label, showroomScore: bestScore };
  }).filter(Boolean);
}

async function fetchShowroomProducts({ shop, token, version }) {
  let products = [];

  // First fetch the whole available catalog so the product card photos come from
  // the same Shopify objects customers see in the store.
  try {
    products = mergeProducts(products, await fetchShopifyProducts({ shop, token, version, shopifyQuery: "", first: 250 }));
  } catch (error) {
    console.warn("Showroom full catalog fetch failed:", error.message);
  }

  // Then fetch exact aliases per showroom slot. This protects the 5 main cards
  // when Shopify search ranking does not put the intended product in the first page.
  for (const slot of SHOWROOM_SLOTS) {
    for (const q of slot.queries.slice(0, 4)) {
      try {
        products = mergeProducts(products, await fetchShopifyProducts({ shop, token, version, shopifyQuery: q, first: 20 }));
      } catch (error) {
        console.warn("Showroom alias skipped:", q, error.message);
      }
    }
  }

  const picked = pickShowroomProducts(products);
  return enrichProductsWithPublicImages(picked, { shop });
}

function mapProducts(data) {
  return data.data.products.edges.map((edge) => {
    const product = edge.node;
    const images = (product.images?.edges || [])
      .map((imageEdge) => ({
        url: imageEdge.node?.url || "",
        altText: imageEdge.node?.altText || ""
      }))
      .filter((image) => image.url);
    const featuredImageUrl = product.featuredImage?.url || images[0]?.url || null;

    return {
      id: product.id,
      title: product.title,
      handle: product.handle,
      onlineStoreUrl: product.onlineStoreUrl || (product.handle ? `https://${process.env.SHOPIFY_PUBLIC_STORE_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN || "civo-meat.myshopify.com"}/products/${product.handle}` : ""),
      description: product.description,
      tags: product.tags || [],
      productType: product.productType || "",
      image: featuredImageUrl,
      featuredImage: product.featuredImage ? {
        url: product.featuredImage.url || "",
        altText: product.featuredImage.altText || ""
      } : null,
      images,
      variants: product.variants.edges.map((variantEdge) => {
        const variant = variantEdge.node;
        return {
          id: variant.id,
          title: variant.title,
          availableForSale: variant.availableForSale,
          price: Number(variant.price.amount),
          currencyCode: variant.price.currencyCode,
          image: variant.image?.url || null,
          imageAltText: variant.image?.altText || ""
        };
      })
    };
  });
}

async function fetchShopifyProducts({ shop, token, version, shopifyQuery, first = 20 }) {
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
            featuredImage { url altText }
            images(first: 10) {
              edges {
                node { url altText }
              }
            }
            variants(first: 10) {
              edges {
                node {
                  id
                  title
                  availableForSale
                  price { amount currencyCode }
                  image { url altText }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch(`https://${shop}/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token
    },
    body: JSON.stringify({
      query,
      variables: { query: shopifyQuery || null, first: Math.max(1, Math.min(Number(first || 20), 250)) }
    })
  });

  const data = await response.json();
  if (!response.ok || data.errors) {
    const error = new Error("Shopify search failed");
    error.status = response.status || 500;
    error.details = data.errors || data;
    throw error;
  }
  return mapProducts(data);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).json({ ok: true });
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const shop = process.env.SHOPIFY_STORE_DOMAIN;
    const token = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
    const version = process.env.SHOPIFY_API_VERSION || "2026-04";

    if (!shop || !token) {
      return res.status(500).json({ ok: false, error: "Missing Shopify env variables", hasShop: !!shop, hasToken: !!token });
    }

    const rawQuery = String(req.query.q || "").trim();
    const wantsShowroom = String(req.query.showroom || req.query.mode || "") === "1" || String(req.query.mode || "").toLowerCase() === "showroom";

    if (wantsShowroom) {
      const showroomProducts = await fetchShowroomProducts({ shop, token, version });
      return res.status(200).json({
        ok: true,
        mode: "showroom",
        count: showroomProducts.length,
        products: showroomProducts
      });
    }

    const aliases = rawQuery ? shopifySearchAliases(rawQuery) : [""];
    let products = [];

    for (const q of aliases) {
      try {
        const result = await fetchShopifyProducts({ shop, token, version, shopifyQuery: q, first: 20 });
        products = mergeProducts(products, result);
        if (products.length >= 12 && rawQuery) break;
      } catch (error) {
        if (q === aliases[0]) throw error;
        console.warn("Alias product query skipped:", q, error.message);
      }
    }

    let ranked = rawQuery ? rankProducts(products, rawQuery, 20) : products.slice(0, 20);

    if (rawQuery && ranked.length < 3) {
      const catalog = await fetchShopifyProducts({ shop, token, version, shopifyQuery: "", first: 250 });
      ranked = mergeProducts(ranked, rankProducts(catalog, rawQuery, 20)).slice(0, 20);
    }

    ranked = await enrichProductsWithPublicImages(ranked, { shop });
    return res.status(200).json({ ok: true, query: rawQuery, aliasesUsed: aliases, count: ranked.length, products: ranked });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message, errors: error.details || undefined });
  }
};
