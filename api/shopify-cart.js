export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "Method not allowed"
      });
    }

    const shop = process.env.SHOPIFY_STORE_DOMAIN;
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

    const { lines } = req.body || {};

    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Missing cart lines"
      });
    }

    const cleanLines = lines.map((line) => {
      const quantity = Math.max(1, Math.min(Number(line.quantity || 1), 99));

      return {
        merchandiseId: line.variantId,
        quantity
      };
    });

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

    const response = await fetch(`https://${shop}/api/${version}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Shopify-Storefront-Private-Token": token
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          lines: cleanLines
        }
      })
    });

    const data = await response.json();

    if (!response.ok || data.errors) {
      return res.status(response.status || 500).json({
        ok: false,
        status: response.status,
        errors: data.errors || data
      });
    }

    const payload = data.data.cartCreate;

    if (payload.userErrors && payload.userErrors.length > 0) {
      return res.status(400).json({
        ok: false,
        errors: payload.userErrors
      });
    }

    return res.status(200).json({
      ok: true,
      cart: payload.cart,
      checkoutUrl: payload.cart.checkoutUrl
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
