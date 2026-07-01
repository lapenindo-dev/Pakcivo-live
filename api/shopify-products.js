// api/shopify-products.js
// v6.0.9 — Shopify showroom with Storefront + public catalog fallback images for Pak Civo Live

const DEFAULT_SHOPIFY_DOMAIN = "civo-meat.myshopify.com";
const DEFAULT_API_VERSION = "2026-04";
const FETCH_TIMEOUT_MS = 9000;

function normalizeShopDomain(value) {
  return String(value || DEFAULT_SHOPIFY_DOMAIN)
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\s+/g, "") || DEFAULT_SHOPIFY_DOMAIN;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function numericIdFromGid(value) {
  const match = String(value || "").match(/\/(\d+)$/);
  return match ? match[1] : String(value || "");
}

function safeNumber(value) {
  const n = Number(String(value || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function uniqueBy(items, keyFn) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function shopifySearchAliases(rawQuery) {
  const q = normalizeText(rawQuery);
  const aliases = new Set([String(rawQuery || "").trim()].filter(Boolean));
  const add = (arr) => arr.forEach((v) => aliases.add(v));

  if (/samcan|pork belly|wuhua/.test(q) && /lokal|local/.test(q)) add(["Samcan Lokal 1kg", "Pork Belly Lokal", "samcan lokal", "Samcan Babi", "Pork Belly"]);
  if (/giling|ground|minced|mince/.test(q)) add(["Babi Giling 500g", "Daging Babi Giling", "Babi Giling", "giling babi", "ground pork", "minced pork"]);
  if (/paikut|bakut|bak kut|ribs?|iga|sop/.test(q)) add(["Paikut Sop 500g", "Paikut Sop", "Paikut", "Bakut", "Bak Kut", "Pork Ribs", "iga babi"]);
  if (/kapsim|kasim|shoulder|collar/.test(q)) add(["Kapsim 1kg", "Kapsim Babi", "Shoulder Babi", "Pork Shoulder", "kasim"]);
  if (/samcan|pork belly|wuhua/.test(q) && /import|impor/.test(q)) add(["Samcan Import 1kg", "Pork Belly Import", "Pork Belly Samcan Import", "Wuhua Rou Import"]);
  if (/samcan|pork belly|wuhua/.test(q)) add(["samcan", "pork belly", "porkbelly", "wuhua", "perut babi"]);

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

  return Array.from(aliases).filter(Boolean).slice(0, 14);
}

function normalizeShopifyImageUrl(value, shop = DEFAULT_SHOPIFY_DOMAIN) {
  if (!value) return "";
  if (typeof value === "string") {
    const clean = value.trim();
    if (!clean) return "";
    if (/^https?:\/\//i.test(clean)) return clean;
    if (/^\/\//.test(clean)) return `https:${clean}`;
    if (/^\//.test(clean)) return `https://${normalizeShopDomain(shop)}${clean}`;
    return "";
  }
  if (typeof value === "object") {
    return normalizeShopifyImageUrl(
      value.url || value.src || value.originalSrc || value.transformedSrc || value.secure_url || value.image || value.featured_image || value.featuredImage || value.image_url,
      shop
    );
  }
  return "";
}

function firstImageFromAnyProductShape(product, shop = DEFAULT_SHOPIFY_DOMAIN) {
  const direct = normalizeShopifyImageUrl(
    product?.image || product?.featuredImage || product?.featured_image || product?.featuredImageUrl || product?.imageUrl || product?.src,
    shop
  );
  if (direct) return direct;

  if (Array.isArray(product?.images)) {
    for (const image of product.images) {
      const url = normalizeShopifyImageUrl(image, shop);
      if (url) return url;
    }
  }

  if (Array.isArray(product?.variants)) {
    for (const variant of product.variants) {
      const url = normalizeShopifyImageUrl(variant?.image || variant?.featured_image || variant?.featuredImage || variant?.imageUrl || variant?.image_url, shop);
      if (url) return url;
    }
  }

  return "";
}

function productHasImage(product) {
  return Boolean(firstImageFromAnyProductShape(product));
}

function productKey(product) {
  return product?.handle || numericIdFromGid(product?.id) || normalizeText(product?.title);
}

function mergeProducts(...lists) {
  const merged = new Map();
  for (const list of lists) {
    for (const product of Array.isArray(list) ? list : []) {
      if (!product) continue;
      const key = productKey(product);
      if (!key) continue;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, product);
      } else {
        const existingImage = firstImageFromAnyProductShape(existing);
        const incomingImage = firstImageFromAnyProductShape(product);
        merged.set(key, {
          ...existing,
          ...product,
          title: product.title || existing.title,
          handle: product.handle || existing.handle,
          description: product.description || existing.description,
          tags: Array.from(new Set([].concat(existing.tags || [], product.tags || []).filter(Boolean))),
          productType: product.productType || existing.productType,
          image: incomingImage || existingImage || product.image || existing.image || "",
          featuredImage: product.featuredImage || existing.featuredImage || (incomingImage || existingImage ? { url: incomingImage || existingImage, altText: product.title || existing.title || "" } : null),
          images: Array.isArray(product.images) && product.images.length ? product.images : existing.images,
          variants: Array.isArray(product.variants) && product.variants.length ? product.variants : existing.variants,
          onlineStoreUrl: product.onlineStoreUrl || existing.onlineStoreUrl
        });
      }
    }
  }
  return Array.from(merged.values());
}

const STOP_WORDS = new Set(["ada", "apa", "apakah", "berapa", "harga", "mau", "kak", "pak", "civo", "produk", "ready", "stok", "stock", "punya", "tersedia", "cari", "carikan", "jual", "jualan", "daging", "babi", "yang", "untuk", "buat"]);

function productSearchText(product) {
  const variants = Array.isArray(product?.variants) ? product.variants.map((v) => [v?.title, v?.sku].filter(Boolean).join(" ")).join(" ") : "";
  return normalizeText([product?.title, product?.handle, product?.description, product?.productType, Array.isArray(product?.tags) ? product.tags.join(" ") : product?.tags, variants].filter(Boolean).join(" "));
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
    [/samcan|pork\s*belly|porkbelly|wuhua|perut/, /samcan|pork\s*belly|porkbelly|wuhua|perut/]
  ];
  for (const [queryRe, textRe] of checks) if (queryRe.test(q) && textRe.test(text)) score += 50;
  if (/jeroan|organ|offal/.test(q) && /jantung|heart|hati|liver|usus|intestine|paru|lung|ginjal|kidney|lidah|tongue|kuping|telinga|ear/.test(text)) score += 45;
  if (Array.isArray(product?.variants) && product.variants.some((v) => v?.id && v.availableForSale !== false)) score += 3;
  if (productHasImage(product)) score += 8;
  return score;
}

function rankProducts(products, rawQuery, limit = 20) {
  if (!rawQuery) return (Array.isArray(products) ? products : []).slice(0, limit);
  const ranked = (Array.isArray(products) ? products : [])
    .map((product) => ({ product, score: scoreProduct(product, rawQuery) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.product);
  return ranked;
}

const SHOWROOM_SLOTS = [
  {
    slotKey: "samcan-lokal-1kg",
    label: "Samcan Lokal 1kg",
    queries: ["Samcan Lokal 1kg", "Samcan Babi", "Pork Belly Lokal", "Pork Belly", "samcan lokal", "perut babi"],
    must: [/samcan|pork\s*belly|porkbelly|wuhua|perut/],
    prefer: [/lokal|local|1\s*kg|1000\s*g|1kg/],
    exclude: [/import|impor|slice|samgyeopsal|skin\s*off|without\s*skin|tanpa\s*kulit|tipis|tebal/]
  },
  {
    slotKey: "babi-giling-500g",
    label: "Babi Giling 500g",
    queries: ["Babi Giling 500g", "Daging Babi Giling", "Babi Giling", "giling babi", "ground pork", "minced pork"],
    must: [/babi\s*giling|giling\s*babi|ground|minced|mince/],
    prefer: [/500\s*g|500\s*gr|500g/],
    exclude: []
  },
  {
    slotKey: "paikut-sop-500g",
    label: "Paikut Sop 500g",
    queries: ["Paikut Sop 500g", "Paikut Sop", "Paikut", "Bakut", "Bak Kut", "Pork Ribs", "iga babi"],
    must: [/paikut|bakut|bak\s*kut|ribs?|iga/],
    prefer: [/sop|soup|chopped|potong|500\s*g|500g/],
    exclude: [/bbq|barbeque|grill|import|impor/]
  },
  {
    slotKey: "kapsim-1kg",
    label: "Kapsim 1kg",
    queries: ["Kapsim 1kg", "Kapsim Babi", "Shoulder Babi", "Pork Shoulder", "kasim", "collar"],
    must: [/kapsim|kasim|shoulder|collar/],
    prefer: [/1\s*kg|1000\s*g|1kg/],
    exclude: []
  },
  {
    slotKey: "samcan-import-1kg",
    label: "Samcan Import 1kg",
    queries: ["Samcan Import 1kg", "Pork Belly Import", "Pork Belly Samcan Import", "Wuhua Rou Import"],
    must: [/samcan|pork\s*belly|porkbelly|wuhua|perut/],
    prefer: [/import|impor|1\s*kg|1000\s*g|1kg/],
    exclude: [/lokal|local|slice|samgyeopsal|skin\s*off|without\s*skin|tanpa\s*kulit|tipis|tebal/]
  }
];

function hasAvailableVariant(product) {
  return Array.isArray(product?.variants) && product.variants.some((variant) => variant?.id && variant.availableForSale !== false);
}

function scoreShowroomProduct(product, slot) {
  const text = productSearchText(product);
  const title = normalizeText(product?.title || "");
  if (!text) return -999;

  let score = 0;
  if (hasAvailableVariant(product)) score += 15;
  if (productHasImage(product)) score += 45;
  if (/1\s*kg|1000\s*g|1kg/.test(text) && /1kg/.test(normalizeText(slot.label))) score += 8;
  if (/500\s*g|500\s*gr|500g/.test(text) && /500g/.test(normalizeText(slot.label))) score += 8;

  for (const re of slot.must || []) score += re.test(text) ? 80 : -120;
  for (const re of slot.prefer || []) if (re.test(text)) score += 28;
  for (const re of slot.exclude || []) if (re.test(text)) score -= 90;

  for (const query of slot.queries || []) {
    const q = normalizeText(query);
    if (!q) continue;
    if (title === q) score += 80;
    else if (title.includes(q) || text.includes(q)) score += 45;
  }
  return score;
}

function sortShowroomFallback(products) {
  const patternScore = (product) => {
    const text = productSearchText(product);
    let score = 0;
    if (productHasImage(product)) score += 60;
    if (hasAvailableVariant(product)) score += 35;
    if (/samcan|pork\s*belly|porkbelly|perut/.test(text)) score += 45;
    if (/giling|ground|minced/.test(text)) score += 40;
    if (/paikut|bakut|ribs?|iga/.test(text)) score += 40;
    if (/kapsim|kasim|shoulder/.test(text)) score += 35;
    if (/import|impor/.test(text)) score += 10;
    if (/ayam|ikan|udang|sapi|sayur|sauce|bumbu/.test(text)) score -= 35;
    if (/slice|samgyeopsal|bacon|smoked/.test(text)) score -= 4;
    return score;
  };
  return (Array.isArray(products) ? products : [])
    .map((product) => ({ product, score: patternScore(product) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.product);
}

function pickShowroomProducts(products) {
  const pool = Array.isArray(products) ? products : [];
  const used = new Set();
  const picked = [];

  for (const slot of SHOWROOM_SLOTS) {
    let best = null;
    let bestScore = -999;
    for (const product of pool) {
      const key = productKey(product);
      if (!key || used.has(key)) continue;
      const score = scoreShowroomProduct(product, slot);
      if (score > bestScore) {
        best = product;
        bestScore = score;
      }
    }
    if (best && bestScore >= 20) {
      used.add(productKey(best));
      picked.push({ ...best, slotKey: slot.slotKey, slotLabel: slot.label, showroomScore: bestScore });
    }
  }

  if (picked.length < 5) {
    for (const product of sortShowroomFallback(pool)) {
      const key = productKey(product);
      if (!key || used.has(key)) continue;
      used.add(key);
      picked.push(product);
      if (picked.length >= 5) break;
    }
  }

  return picked.slice(0, 5);
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: options.headers || {},
      body: options.body,
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (error) { data = null; }
    return { ok: response.ok, status: response.status, data, text };
  } finally {
    clearTimeout(timer);
  }
}

function mapStorefrontProducts(data, shop) {
  const edges = data?.data?.products?.edges || [];
  return edges.map((edge) => {
    const product = edge.node;
    const images = (product.images?.edges || [])
      .map((imageEdge) => ({
        url: imageEdge.node?.url || "",
        altText: imageEdge.node?.altText || ""
      }))
      .filter((image) => image.url);
    const featuredImageUrl = product.featuredImage?.url || images[0]?.url || "";

    return {
      id: product.id,
      title: product.title,
      handle: product.handle,
      onlineStoreUrl: product.onlineStoreUrl || (product.handle ? `https://${shop}/products/${product.handle}` : ""),
      description: product.description,
      tags: product.tags || [],
      productType: product.productType || "",
      image: featuredImageUrl,
      featuredImage: featuredImageUrl ? { url: featuredImageUrl, altText: product.featuredImage?.altText || product.title || "" } : null,
      images,
      variants: (product.variants?.edges || []).map((variantEdge) => {
        const variant = variantEdge.node;
        return {
          id: variant.id,
          title: variant.title,
          availableForSale: variant.availableForSale,
          price: safeNumber(variant.price?.amount),
          currencyCode: variant.price?.currencyCode || "IDR",
          image: variant.image?.url || "",
          imageAltText: variant.image?.altText || ""
        };
      }),
      source: "storefront"
    };
  });
}

async function fetchStorefrontProducts({ shop, token, version, shopifyQuery, first = 20 }) {
  if (!token) return [];
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
            images(first: 12) { edges { node { url altText } } }
            variants(first: 20) {
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

  const result = await fetchJson(`https://${shop}/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token
    },
    body: JSON.stringify({
      query,
      variables: { query: String(shopifyQuery || ""), first: Math.max(1, Math.min(Number(first || 20), 250)) }
    })
  });

  if (!result.ok || result.data?.errors) {
    const error = new Error("Shopify Storefront search failed");
    error.status = result.status || 500;
    error.details = result.data?.errors || result.data || result.text?.slice(0, 300);
    throw error;
  }
  return mapStorefrontProducts(result.data, shop);
}

function mapPublicProduct(product, shop) {
  const imageByVariantId = new Map();
  const images = (Array.isArray(product?.images) ? product.images : [])
    .map((img) => {
      const url = normalizeShopifyImageUrl(img?.src || img, shop);
      if (url && Array.isArray(img?.variant_ids)) {
        img.variant_ids.forEach((id) => imageByVariantId.set(String(id), url));
      }
      return url ? { url, altText: img?.alt || product?.title || "" } : null;
    })
    .filter(Boolean);

  const featured = normalizeShopifyImageUrl(product?.image?.src || product?.featured_image || product?.image, shop) || images[0]?.url || "";
  const variants = (Array.isArray(product?.variants) ? product.variants : []).map((variant) => {
    const id = variant?.id ? String(variant.id) : "";
    const variantImage = normalizeShopifyImageUrl(variant?.featured_image || variant?.image || variant?.image_url, shop) || imageByVariantId.get(id) || featured;
    return {
      id: id ? `gid://shopify/ProductVariant/${id}` : "",
      title: variant?.title || "Default Title",
      sku: variant?.sku || "",
      availableForSale: variant?.available !== false,
      price: safeNumber(variant?.price),
      currencyCode: "IDR",
      image: variantImage,
      imageAltText: product?.title || ""
    };
  });

  const tags = Array.isArray(product?.tags)
    ? product.tags
    : String(product?.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean);

  return {
    id: product?.id ? `public-product-${product.id}` : `public-product-${product?.handle || product?.title || Math.random()}`,
    title: product?.title || "Produk CIVO MEAT",
    handle: product?.handle || "",
    onlineStoreUrl: product?.handle ? `https://${shop}/products/${product.handle}` : "",
    description: stripHtml(product?.body_html || product?.description || ""),
    tags,
    productType: product?.product_type || product?.productType || "",
    image: featured,
    featuredImage: featured ? { url: featured, altText: product?.title || "" } : null,
    images,
    variants,
    source: "public-products-json"
  };
}

async function fetchPublicProductsJson({ shop, publicShop }) {
  const domains = uniqueBy([shop, publicShop, DEFAULT_SHOPIFY_DOMAIN].map(normalizeShopDomain), (v) => v);
  const urls = [];
  for (const domain of domains) {
    urls.push(`https://${domain}/products.json?limit=250`);
    urls.push(`https://${domain}/collections/all/products.json?limit=250`);
  }

  let products = [];
  for (const url of uniqueBy(urls, (v) => v)) {
    try {
      const result = await fetchJson(url, { headers: { Accept: "application/json" } });
      const list = result.data?.products;
      if (result.ok && Array.isArray(list) && list.length) {
        const domain = normalizeShopDomain(new URL(url).hostname);
        products = mergeProducts(products, list.map((product) => mapPublicProduct(product, domain)));
      }
    } catch (error) {
      console.warn("Public Shopify products JSON skipped:", url, error.message);
    }
  }
  return products;
}

function handleFromUrl(url) {
  const clean = String(url || "");
  const match = clean.match(/\/products\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : "";
}

function mapSuggestProduct(product, shop) {
  const handle = product?.handle || handleFromUrl(product?.url || product?.online_store_url || product?.resource_url);
  const image = normalizeShopifyImageUrl(product?.image || product?.featured_image || product?.image_url, shop);
  const price = safeNumber(product?.price || product?.compare_at_price_min || product?.price_min);
  return {
    id: `suggest-${handle || normalizeText(product?.title)}`,
    title: product?.title || "Produk CIVO MEAT",
    handle,
    onlineStoreUrl: handle ? `https://${shop}/products/${handle}` : (product?.url ? `https://${shop}${product.url}` : ""),
    description: stripHtml(product?.body || product?.description || ""),
    tags: [],
    productType: product?.type || "",
    image,
    featuredImage: image ? { url: image, altText: product?.title || "" } : null,
    images: image ? [{ url: image, altText: product?.title || "" }] : [],
    variants: price ? [{ id: "", title: "", availableForSale: true, price, currencyCode: "IDR", image }] : [],
    source: "public-search-suggest"
  };
}

async function fetchPublicSearchSuggest({ publicShop, query }) {
  if (!query) return [];
  const shop = normalizeShopDomain(publicShop);
  const url = `https://${shop}/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=10&resources[options][unavailable_products]=show`;
  try {
    const result = await fetchJson(url, { headers: { Accept: "application/json" } });
    const list = result.data?.resources?.results?.products;
    if (!result.ok || !Array.isArray(list)) return [];
    return list.map((product) => mapSuggestProduct(product, shop));
  } catch (error) {
    console.warn("Public Shopify suggest skipped:", query, error.message);
    return [];
  }
}

async function fetchPublicProductJson(shop, handle) {
  if (!shop || !handle) return null;
  const url = `https://${normalizeShopDomain(shop)}/products/${encodeURIComponent(handle)}.js`;
  const result = await fetchJson(url, { headers: { Accept: "application/json,text/javascript,*/*" } });
  if (!result.ok || !result.data) return null;
  return result.data;
}

async function enrichProductImageFromPublicJson(product, { publicShop }) {
  if (!product || !product.handle) return product;
  if (firstImageFromAnyProductShape(product, publicShop)) return product;

  try {
    const publicProduct = await fetchPublicProductJson(publicShop, product.handle);
    if (!publicProduct) return product;
    const mapped = mapPublicProduct(publicProduct, normalizeShopDomain(publicShop));
    return mergeProducts([product], [mapped])[0] || product;
  } catch (error) {
    console.warn("Public Shopify product image enrichment skipped:", product.handle, error.message);
    return product;
  }
}

async function enrichProductsWithPublicImages(products, { publicShop }) {
  const list = Array.isArray(products) ? products : [];
  return Promise.all(list.map((product) => enrichProductImageFromPublicJson(product, { publicShop })));
}

async function fetchShowroomProducts({ shop, publicShop, token, version }) {
  let products = [];
  const diagnostics = { storefrontFull: 0, publicCatalog: 0, aliases: 0, suggest: 0 };

  try {
    const storefrontFull = await fetchStorefrontProducts({ shop, token, version, shopifyQuery: "", first: 250 });
    diagnostics.storefrontFull = storefrontFull.length;
    products = mergeProducts(products, storefrontFull);
  } catch (error) {
    console.warn("Showroom Storefront catalog skipped:", error.message);
  }

  try {
    const publicCatalog = await fetchPublicProductsJson({ shop, publicShop });
    diagnostics.publicCatalog = publicCatalog.length;
    products = mergeProducts(products, publicCatalog);
  } catch (error) {
    console.warn("Showroom public catalog skipped:", error.message);
  }

  for (const slot of SHOWROOM_SLOTS) {
    for (const q of slot.queries.slice(0, 5)) {
      try {
        const found = await fetchStorefrontProducts({ shop, token, version, shopifyQuery: q, first: 20 });
        diagnostics.aliases += found.length;
        products = mergeProducts(products, found);
      } catch (error) {
        console.warn("Showroom Storefront alias skipped:", q, error.message);
      }
      try {
        const suggested = await fetchPublicSearchSuggest({ publicShop, query: q });
        diagnostics.suggest += suggested.length;
        products = mergeProducts(products, suggested);
      } catch (error) {
        console.warn("Showroom public suggest skipped:", q, error.message);
      }
    }
  }

  products = await enrichProductsWithPublicImages(products, { publicShop });
  const picked = pickShowroomProducts(products);
  return { products: picked, diagnostics, totalPool: products.length };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).json({ ok: true });
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const shop = normalizeShopDomain(process.env.SHOPIFY_STORE_DOMAIN || DEFAULT_SHOPIFY_DOMAIN);
  const publicShop = normalizeShopDomain(process.env.SHOPIFY_PUBLIC_STORE_DOMAIN || process.env.SHOPIFY_CART_DOMAIN || process.env.SHOPIFY_STORE_DOMAIN || DEFAULT_SHOPIFY_DOMAIN);
  const token = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || process.env.SHOPIFY_STOREFRONT_TOKEN || "";
  const version = process.env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION;
  const debug = String(req.query.debug || "") === "1";

  try {
    const rawQuery = String(req.query.q || "").trim();
    const wantsShowroom = String(req.query.showroom || req.query.mode || "") === "1" || String(req.query.mode || "").toLowerCase() === "showroom";

    if (wantsShowroom) {
      const result = await fetchShowroomProducts({ shop, publicShop, token, version });
      return res.status(200).json({
        ok: true,
        mode: "showroom",
        count: result.products.length,
        products: result.products,
        ...(debug ? { debug: { shop, publicShop, hasToken: Boolean(token), totalPool: result.totalPool, diagnostics: result.diagnostics } } : {})
      });
    }

    const aliases = rawQuery ? shopifySearchAliases(rawQuery) : [""];
    let products = [];
    const diagnostics = { storefront: 0, publicCatalog: 0, suggest: 0 };

    for (const q of aliases) {
      try {
        const found = await fetchStorefrontProducts({ shop, token, version, shopifyQuery: q, first: rawQuery ? 30 : 60 });
        diagnostics.storefront += found.length;
        products = mergeProducts(products, found);
        if (rawQuery && products.length >= 20) break;
      } catch (error) {
        console.warn("Storefront product query skipped:", q, error.message);
      }
    }

    try {
      const publicCatalog = await fetchPublicProductsJson({ shop, publicShop });
      diagnostics.publicCatalog = publicCatalog.length;
      products = mergeProducts(products, rawQuery ? rankProducts(publicCatalog, rawQuery, 40) : publicCatalog.slice(0, 40));
    } catch (error) {
      console.warn("Public product catalog skipped:", error.message);
    }

    if (rawQuery) {
      for (const q of aliases.slice(0, 6)) {
        const suggested = await fetchPublicSearchSuggest({ publicShop, query: q });
        diagnostics.suggest += suggested.length;
        products = mergeProducts(products, suggested);
      }
    }

    let ranked = rawQuery ? rankProducts(products, rawQuery, 24) : products.slice(0, 24);
    if (rawQuery && ranked.length < 3 && products.length) ranked = products.slice(0, 24);
    ranked = await enrichProductsWithPublicImages(ranked, { publicShop });

    return res.status(200).json({
      ok: true,
      query: rawQuery,
      aliasesUsed: aliases,
      count: ranked.length,
      products: ranked,
      ...(debug ? { debug: { shop, publicShop, hasToken: Boolean(token), diagnostics } } : {})
    });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message, errors: error.details || undefined });
  }
};
