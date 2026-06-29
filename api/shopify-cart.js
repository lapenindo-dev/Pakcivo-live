function parseRequestBody(req) {
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
    .replace(/\/$/, "");
}

function getNumericVariantId(gid) {
  const value = String(gid || "");
  const match = value.match(/ProductVariant\/(\d+)/);
  if (match && match[1]) return match[1];
  if (/^\d+$/.test(value)) return value;
  return "";
}

function buildCartPermalink(shop, lines) {
  const domain = normalizeShopDomain(
    process.env.SHOPIFY_CART_DOMAIN ||
    process.env.SHOPIFY_PUBLIC_STORE_DOMAIN ||
    process.env.SHOPIFY_STORE_DOMAIN ||
    shop
  );

  const items = lines
    .map((line) => {
      const numericId = getNumericVariantId(line.merchandiseId || line.variantId);
      const quantity = Math.max(1, Math.min(Number(line.quantity || 1), 99));
      return numericId ? `${numericId}:${quantity}` : "";
    })
    .filter(Boolean)
    .join(",");

  if (!domain || !items) return "";
  return `https://${domain}/cart/${items}`;
}

function normalizeLines(body) {
  let lines = body.lines;

  if (!Array.isArray(lines) && body.variantId) {
    lines = [{ merchandiseId: body.variantId, quantity: Number(body.quantity || 1) }];
  }

  if (!Array.isArray(lines)) return [];

  return lines
    .map((line) => {
      const merchandiseId = line.merchandiseId || line.variantId;
      const quantity = Math.max(1, Math.min(Number(line.quantity || 1), 99));
      if (!merchandiseId || typeof merchandiseId !== "string") return null;
      return { merchandiseId, quantity };
    })
    .filter(Boolean);
}

async function createCartWithStorefrontApi({ shop, token, version, lines }) {
  const mutation = `
    mutation CartCreate($input: CartInput!) {
      cartCreate(input: $input) {
        cart {
          id
          checkoutUrl
          cost {
            subtotalAmount { amount currencyCode }
            totalAmount { amount currencyCode }
          }
          lines(first: 20) {
            edges {
              node {
                quantity
                merchandise {
                  ... on ProductVariant {
                    id
                    title
                    availableForSale
                    product { title handle }
                    price { amount currencyCode }
                  }
                }
              }
            }
          }
        }
        userErrors { field message }
      }
    }
  `;

  const response = await fetch(`https://${shop}/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token
    },
    body: JSON.stringify({ query: mutation, variables: { input: { lines } } })
  });

  let data;
  const text = await response.text();
  try { data = text ? JSON.parse(text) : {}; }
  catch (_) { data = { nonJsonResponse: text.slice(0, 500) }; }

  return { response, data };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const shop = normalizeShopDomain(process.env.SHOPIFY_STORE_DOMAIN);
  const token = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN || process.env.SHOPIFY_STOREFRONT_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || "2026-04";

  const body = parseRequestBody(req);
  const lines = normalizeLines(body);

  if (!lines.length) {
    return res.status(400).json({ ok: false, error: "Missing cart lines" });
  }

  const fallbackCheckoutUrl = buildCartPermalink(shop, lines);

  if (!shop) {
    return res.status(500).json({
      ok: false,
      error: "Missing SHOPIFY_STORE_DOMAIN",
      fallbackCheckoutUrl
    });
  }

  // If Storefront token is missing, still return Shopify cart permalink so checkout can work.
  if (!token) {
    if (fallbackCheckoutUrl) {
      return res.status(200).json({
        ok: true,
        mode: "cart-permalink-no-token",
        checkoutUrl: fallbackCheckoutUrl,
        cartUrl: fallbackCheckoutUrl,
        warning: "Missing SHOPIFY_STOREFRONT_ACCESS_TOKEN. Using Shopify cart permalink fallback."
      });
    }
    return res.status(500).json({ ok: false, error: "Missing SHOPIFY_STOREFRONT_ACCESS_TOKEN" });
  }

  try {
    const { response, data } = await createCartWithStorefrontApi({ shop, token, version, lines });

    const payload = data?.data?.cartCreate;
    const userErrors = payload?.userErrors || [];
    const apiErrors = data?.errors || [];
    const checkoutUrl = payload?.cart?.checkoutUrl || "";

    if (response.ok && checkoutUrl && userErrors.length === 0 && apiErrors.length === 0) {
      return res.status(200).json({
        ok: true,
        mode: "storefront-cart",
        cart: payload.cart,
        checkoutUrl
      });
    }

    // Hard fallback: even when cartCreate fails because of Storefront permission/version/scope,
    // Shopify cart permalink can still add the variant to the Online Store cart.
    if (fallbackCheckoutUrl) {
      return res.status(200).json({
        ok: true,
        mode: "cart-permalink-fallback",
        checkoutUrl: fallbackCheckoutUrl,
        cartUrl: fallbackCheckoutUrl,
        storefrontError: {
          status: response.status,
          errors: apiErrors,
          userErrors,
          raw: data?.nonJsonResponse ? data.nonJsonResponse : undefined
        }
      });
    }

    return res.status(response.status || 500).json({
      ok: false,
      error: "Shopify cartCreate failed and fallback URL could not be built",
      status: response.status,
      errors: apiErrors,
      userErrors,
      raw: data
    });
  } catch (error) {
    if (fallbackCheckoutUrl) {
      return res.status(200).json({
        ok: true,
        mode: "cart-permalink-fallback-exception",
        checkoutUrl: fallbackCheckoutUrl,
        cartUrl: fallbackCheckoutUrl,
        warning: error.message
      });
    }

    return res.status(500).json({ ok: false, error: error.message });
  }
};
