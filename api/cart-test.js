export default async function handler(req, res) {
  const baseUrl = `https://${req.headers.host}`;

  const response = await fetch(`${baseUrl}/api/shopify-cart`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      lines: [
        {
          variantId: "gid://shopify/ProductVariant/48252265136282",
          quantity: 1
        }
      ]
    })
  });

  const data = await response.json();

  return res.status(response.status).json(data);
}
