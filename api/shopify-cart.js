module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Method not allowed"
      });
    }

    const rawShop = process.env.SHOPIFY_STORE_DOMAIN || "";
    const shop = rawShop
      .replace(/^https?:\/\//i, "")
      .replace(/\/$/, "")
      .trim();
    const token = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
    const version = process.env.SHOPIFY_API_VERSION || "2026-04";

    if (!shop || !token) {
      return res.status(500).json({
        ok: false,
        error: "Missing Shopify env variables",
        hasShop: !!shop,
        hasToken: !!token
      });
    }

    let body = req.body || {};

    // Vercel normally parses JSON, but this protects us if req.body arrives as a string/buffer.
    if (typeof body === "string") {
      try {
        body = JSON.parse(body || "{}");
      } catch (e) {
        return res.status(400).json({
          ok: false,
          error: "Invalid JSON body"
        });
      }
    }

    if (Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(body.toString("utf8") || "{}");
      } catch (e) {
        return res.status(400).json({
          ok: false,
          error: "Invalid JSON body buffer"
        });
      }
    }

    let lines = body.lines;

    // Backward compatibility: allow { variantId, merchandiseId, quantity }
    if (!Array.isArray(lines) && (body.variantId || body.merchandiseId)) {
      lines = [
        {
          merchandiseId: body.merchandiseId || body.variantId,
          quantity: Number(body.quantity || 1)
        }
      ];
    }

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Missing cart lines",
        receivedKeys: Object.keys(body || {})
      });
    }

    const cleanLines = lines
      .map((line) => {
        const merchandiseId = line.merchandiseId || line.variantId;
        const quantity = Math.max(1, Math.min(Number(line.quantity || 1), 99));

        if (!merchandiseId || typeof merchandiseId !== "string") {
          return null;
        }

        return {
          merchandiseId,
          quantity
        };
      })
      .filter(Boolean);

    if (cleanLines.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "No valid Shopify variant IDs provided"
      });
    }

    const mutation = `
      mutation CartCreate($input: CartInput!) {
        cartCreate(input: $input) {
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
                      availableForSale
                      product {
                        title
                        handle
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

    const shopifyRes = await fetch(`https://${shop}/api/${version}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": token
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            lines: cleanLines
          }
        }
      })
    });

    const rawText = await shopifyRes.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (e) {
      return res.status(502).json({
        ok: false,
        error: "Shopify returned non-JSON response",
        status: shopifyRes.status,
        body: rawText.slice(0, 500)
      });
    }

    if (!shopifyRes.ok || data.errors) {
      return res.status(shopifyRes.status || 500).json({
        ok: false,
        status: shopifyRes.status,
        errors: data.errors || data,
        shop,
        apiVersion: version
      });
    }

    const payload = data?.data?.cartCreate;

    if (!payload) {
      return res.status(500).json({
        ok: false,
        error: "Invalid Shopify cartCreate response",
        data
      });
    }

    if (payload.userErrors && payload.userErrors.length > 0) {
      return res.status(400).json({
        ok: false,
        userErrors: payload.userErrors,
        errors: payload.userErrors
      });
    }

    const checkoutUrl = payload.cart?.checkoutUrl || null;

    if (!checkoutUrl) {
      return res.status(500).json({
        ok: false,
        error: "Shopify cart created but checkoutUrl is missing",
        cart: payload.cart
      });
    }

    return res.status(200).json({
      ok: true,
      cart: payload.cart,
      checkoutUrl
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Unknown server error"
    });
  }
};
