// api/lead.js
// PakCivo Lead Capture API v3
// - Stores PakCivo lead as Shopify Customer
// - Handles duplicate phone numbers safely
// - Uses Shopify Admin API client credentials grant server-side only

let cachedAdminToken = null;
let cachedAdminTokenExpiresAt = 0;

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function setCors(req, res) {
  const allowedOrigin = cleanString(process.env.ALLOWED_ORIGIN || process.env.PUBLIC_SITE_ORIGIN);
  const origin = cleanString(req.headers.origin);
  res.setHeader("Access-Control-Allow-Origin", allowedOrigin && origin === allowedOrigin ? origin : "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function cleanString(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function splitName(fullName) {
  const cleaned = cleanString(fullName);
  const parts = cleaned.split(" ").filter(Boolean);

  if (parts.length <= 1) {
    return {
      firstName: parts[0] || "Customer",
      lastName: "Pakcivo"
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

function normalizeIndonesianWhatsApp(input) {
  let raw = String(input || "").trim();
  raw = raw.replace(/[^0-9+]/g, "");

  if (!raw) return null;

  if (raw.startsWith("+")) {
    raw = "+" + raw.slice(1).replace(/\+/g, "");
  }

  if (raw.startsWith("+62")) return raw;
  if (raw.startsWith("62")) return `+${raw}`;
  if (raw.startsWith("0")) return `+62${raw.slice(1)}`;
  if (raw.startsWith("8")) return `+62${raw}`;

  return raw.startsWith("+") ? raw : `+${raw}`;
}

function normalizeErrorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch (_) {
    return "Unknown error";
  }
}

function hasDuplicatePhoneError(userErrors) {
  const text = JSON.stringify(userErrors || []).toLowerCase();
  return text.includes("phone") && (text.includes("already been taken") || text.includes("has already been taken"));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body || "{}");
    } catch (_) {
      return {};
    }
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

async function verifyTurnstileToken(token, req) {
  const enabled = process.env.CAPTCHA_ENABLED === "true";
  const secret = cleanString(process.env.TURNSTILE_SECRET_KEY);
  if (!enabled) return { ok: true, skipped: true };
  if (!secret) throw new Error("Captcha aktif tetapi TURNSTILE_SECRET_KEY belum dikonfigurasi.");
  if (!token) return { ok: false, error: "Captcha belum valid. Coba centang/verifikasi ulang." };

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || "";
  const body = new URLSearchParams({ secret, response: String(token) });
  if (ip) body.set("remoteip", ip);

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    return { ok: false, error: "Captcha tidak valid. Coba ulangi verifikasi." };
  }
  return { ok: true };
}

async function getAdminAccessToken() {
  const directToken = cleanString(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN);
  if (directToken) return directToken;

  const shop = cleanString(process.env.SHOPIFY_STORE_DOMAIN);
  const clientId = cleanString(process.env.SHOPIFY_ADMIN_CLIENT_ID);
  const clientSecret = cleanString(process.env.SHOPIFY_ADMIN_CLIENT_SECRET);

  if (!shop || !clientId || !clientSecret) {
    throw new Error("Missing Shopify Admin credentials. Required: SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_CLIENT_ID, SHOPIFY_ADMIN_CLIENT_SECRET");
  }

  const now = Date.now();
  if (cachedAdminToken && cachedAdminTokenExpiresAt > now + 60_000) {
    return cachedAdminToken;
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret
  });

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { raw: text };
  }

  if (!response.ok || !data.access_token) {
    throw new Error(`Failed to get Shopify Admin access token: ${JSON.stringify(data)}`);
  }

  cachedAdminToken = data.access_token;
  cachedAdminTokenExpiresAt = Date.now() + Number(data.expires_in || 86399) * 1000;
  return cachedAdminToken;
}

async function shopifyAdminGraphQL(query, variables = {}) {
  const shop = cleanString(process.env.SHOPIFY_STORE_DOMAIN);
  const version = cleanString(process.env.SHOPIFY_API_VERSION) || "2026-04";
  const token = await getAdminAccessToken();

  const response = await fetch(`https://${shop}/admin/api/${version}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token
    },
    body: JSON.stringify({ query, variables })
  });

  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_) {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Shopify Admin GraphQL HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }

  if (payload.errors && payload.errors.length) {
    throw new Error(`Shopify Admin GraphQL errors: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data;
}

async function findCustomerByPhone(phone) {
  const query = `
    query PakCivoCustomerByPhone($identifier: CustomerIdentifierInput!) {
      customer: customerByIdentifier(identifier: $identifier) {
        id
        firstName
        lastName
        displayName
        tags
        defaultPhoneNumber {
          phoneNumber
        }
      }
    }
  `;

  const data = await shopifyAdminGraphQL(query, {
    identifier: { phoneNumber: phone }
  });

  return data && data.customer ? data.customer : null;
}

async function addTagsToCustomer(customerId) {
  const mutation = `
    mutation PakCivoTagsAdd($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) {
        node {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const data = await shopifyAdminGraphQL(mutation, {
    id: customerId,
    tags: ["pakcivo-lead", "tokopakcivo-chat"]
  });

  const userErrors = data?.tagsAdd?.userErrors || [];
  if (userErrors.length) {
    throw new Error(`Shopify tagsAdd userErrors: ${JSON.stringify(userErrors)}`);
  }

  return true;
}

function formatCustomer(customer, fallbackPhone) {
  const phone = customer?.phone || customer?.defaultPhoneNumber?.phoneNumber || fallbackPhone;
  return {
    id: customer?.id,
    firstName: customer?.firstName || "",
    lastName: customer?.lastName || "",
    phone,
    tags: customer?.tags || []
  };
}

async function createOrUpdateLeadCustomer({ name, whatsapp, source }) {
  const fullName = cleanString(name);
  const phone = normalizeIndonesianWhatsApp(whatsapp);
  const { firstName, lastName } = splitName(fullName);
  const cleanSource = cleanString(source) || "tokopakcivo";

  const mutation = `
    mutation PakCivoCustomerSet($identifier: CustomerSetIdentifiers, $input: CustomerSetInput!) {
      customerSet(identifier: $identifier, input: $input) {
        customer {
          id
          firstName
          lastName
          phone
          tags
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const input = {
    firstName,
    lastName,
    phone,
    locale: "id",
    note: `Lead masuk dari PakCivo Live.\nSource: ${cleanSource}\nLast seen: ${new Date().toISOString()}`,
    tags: ["pakcivo-lead", "tokopakcivo-chat"]
  };

  // Main path: true upsert by phone.
  const data = await shopifyAdminGraphQL(mutation, {
    identifier: { phone },
    input
  });

  const result = data?.customerSet;
  const userErrors = result?.userErrors || [];

  if (!userErrors.length && result?.customer) {
    return {
      status: "created_or_updated",
      customer: formatCustomer(result.customer, phone)
    };
  }

  // Fallback path: if Shopify says the phone exists, find existing customer and return success.
  // This prevents the frontend from blocking returning customers.
  if (hasDuplicatePhoneError(userErrors)) {
    const existing = await findCustomerByPhone(phone);
    if (existing?.id) {
      await addTagsToCustomer(existing.id);
      return {
        status: "existing_phone_reused",
        customer: formatCustomer(existing, phone)
      };
    }
  }

  throw new Error(`Shopify customerSet userErrors: ${JSON.stringify(userErrors)}`);
}

module.exports = async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return json(res, 200, { ok: true });
  }

  if (req.method !== "POST") {
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = await readBody(req);
    const name = cleanString(body.name);
    const whatsapp = cleanString(body.whatsapp || body.phone || body.wa);
    const phone = normalizeIndonesianWhatsApp(whatsapp);

    if (!name || name.length < 2) {
      return json(res, 400, { ok: false, error: "Nama wajib diisi." });
    }

    if (!phone || !phone.startsWith("+62") || phone.length < 10) {
      return json(res, 400, { ok: false, error: "Nomor WhatsApp tidak valid. Gunakan format 08xx atau +62xx." });
    }

    const captcha = await verifyTurnstileToken(body.turnstileToken, req);
    if (!captcha.ok) {
      return json(res, 400, { ok: false, error: captcha.error || "Captcha tidak valid." });
    }

    const result = await createOrUpdateLeadCustomer({
      name,
      whatsapp: phone,
      source: body.source || "pakcivo-live"
    });

    return json(res, 200, {
      ok: true,
      status: result.status,
      customer: result.customer,
      lead: {
        name,
        whatsapp: phone
      }
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      error: normalizeErrorMessage(error)
    });
  }
};
