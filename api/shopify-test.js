export default async function handler(req, res) {
  try {
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

    const query = `
      query {
        products(first: 5) {
          edges {
            node {
              id
              title
              handle
              description
              featuredImage {
                url
                altText
              }
              variants(first: 5) {
                edges {
                  node {
                    id
                    title
                    sku
                    availableForSale
                    quantityAvailable
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

    const response = await fetch(`https://${shop}/api/${version}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": token
      },
      body: JSON.stringify({ query })
    });

    const data = await response.json();

    if (!response.ok || data.errors) {
      return res.status(500).json({
        ok: false,
        status: response.status,
        errors: data.errors || data
      });
    }

    return res.status(200).json({
      ok: true,
      shop,
      products: data.data.products.edges.map(edge => edge.node)
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
