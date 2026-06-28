// api/lead.js
// PakCivo Lead Capture -> Shopify Customer
// CommonJS / Vercel Serverless Function / Node.js 20

let cachedAdminToken = null;
let cachedAdminTokenExpiresAt = 0;

function normalizeIndonesianWhatsApp(input) {
  let raw = String(input || "").trim();

  // Remove spaces, hyphens, brackets, dots, etc.
  raw = raw.replace(/[^\d+]/g, "");

  // +62812... -> 62812...
  if (raw.startsWith("+")) raw = raw.slice(1);

  // 00812... is not valid for ID WA; let validation catch it unless it is 0062...
  if (raw.startsWith("0062")) raw = raw.slice(2);

  // 0812... -> 62812...
  if (raw.startsWith("0")) raw = "62" + raw.slice(1);

  // 812... -> 62812...
  if (raw.startsWith("8")) raw = "62" + raw;

  // Basic Indonesian mobile number validation
  if (!/^62\d{8,15}$/.test(raw)) {
    return null;
  }

  return "+" + raw;
}

function cleanName(input) {
  return String(input || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .slice(0, 80);
}

function splitName(fullName) {
  const parts = fullName.split(" ").filter(Boolean);
  if (parts.length <= 1) {
    return { firstName: parts[0] || "Customer", lastName: "" };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

async function getAdminAccessToken() {
  // Optional fallback for old Admin-created custom apps.
  // For new Dev Dashboard apps, use Client ID + Secret below.
  const directToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (directToken) return directToken;

  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_ADMIN_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_ADMIN_CLIENT_SECRET;

  if (!shop || !clientId || !clientSecret) {
    throw new Error("Missing Shopify Admin credentials in Vercel Environment Variables");
  }

  const now = Date.now();
  if (cachedAdminToken && cachedAdminTokenExpiresAt > now + 60 * 1000) {
    return cachedAdminToken;
  }

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json"
    },
    body
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    throw new Error(`Failed to get Shopify Admin access token: ${JSON.stringify(data)}`);
  }

  cachedAdminToken = data.access_token;
  const expiresInSeconds = Number(data.expires_in || 86399);
  cachedAdminTokenExpiresAt = Date.now() + expiresInSeconds * 1000;

  return cachedAdminToken;
}

async function shopifyAdminGraphQL(query, variables) {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_API_VERSION || "2026-04";
  const token = await getAdminAccessToken();

  const response = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.errors) {
    throw new Error(JSON.stringify(data.errors || data));
  }

  return data.data;
}

module.exports = async function handler(req, res) {
  // Keep permissive during testing. After stable, restrict to your Shopify page/domain.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });
  }

  try {
    const { name, whatsapp, source } = req.body || {};

    const customerName = cleanName(name);
    const normalizedPhone = normalizeIndonesianWhatsApp(whatsapp);

    if (!customerName || customerName.length < 2) {
      return res.status(400).json({
        ok: false,
        error: "Nama wajib diisi minimal 2 huruf."
      });
    }

    if (!normalizedPhone) {
      return res.status(400).json({
        ok: false,
        error: "Nomor WhatsApp tidak valid. Contoh: 081280799493"
      });
    }

    const { firstName, lastName } = splitName(customerName);

    const mutation = `
      mutation PakCivoCustomerSet(
        $identifier: CustomerSetIdentifiers,
        $input: CustomerSetInput!
      ) {
        customerSet(identifier: $identifier, input: $input) {
          customer {
            id
            firstName
            lastName
            phone
            tags
            note
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const nowIso = new Date().toISOString();
    const cleanSource = String(source || "tokopakcivo").replace(/[<>]/g, "").slice(0, 60);

    const variables = {
      identifier: {
        phone: normalizedPhone
      },
      input: {
        firstName,
        lastName,
        phone: normalizedPhone,
        locale: "id",
        note: [
          "Lead masuk dari PakCivo Live.",
          `Source: ${cleanSource}`,
          `Last seen: ${nowIso}`,
          "Consent: Customer submitted name and WhatsApp before starting chat."
        ].join("\n"),
        tags: [
          "pakcivo-lead",
          "tokopakcivo-chat"
        ]
      }
    };

    const data = await shopifyAdminGraphQL(mutation, variables);
    const result = data.customerSet;

    if (result.userErrors && result.userErrors.length > 0) {
      return res.status(400).json({
        ok: false,
        errors: result.userErrors
      });
    }

    return res.status(200).json({
      ok: true,
      customer: result.customer,
      lead: {
        name: customerName,
        whatsapp: normalizedPhone
      }
    });
  } catch (error) {
    console.error("Lead handler error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Lead capture failed"
    });
  }
};
