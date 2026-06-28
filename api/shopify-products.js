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

    const rawQuery = String(req.query.q || "").trim();

    const shopifyQuery = rawQuery
      ? rawQuery
      : "";

    const query = `
      query SearchProducts($query: String) {
        products(first: 20, query: $query) {
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

    const response = await fetch(`https://${shop}/api/${version}/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Shopify-Storefront-Private-Token": token
      },
      body: JSON.stringify({
        query,
        variables: {
          query: shopifyQuery
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

    const products = data.data.products.edges.map((edge) => {
      const product = edge.node;

      return {
        id: product.id,
        title: product.title,
        handle: product.handle,
        description: product.description,
        tags: product.tags || [],
        productType: product.productType || "",
        image: product.featuredImage?.url || null,
        variants: product.variants.edges.map((variantEdge) => {
          const variant = variantEdge.node;

          return {
            id: variant.id,
            title: variant.title,
            sku: variant.sku,
            availableForSale: variant.availableForSale,
            price: Number(variant.price.amount),
            currencyCode: variant.price.currencyCode
          };
        })
      };
    });

    return res.status(200).json({
      ok: true,
      query: rawQuery,
      count: products.length,
      products
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}
