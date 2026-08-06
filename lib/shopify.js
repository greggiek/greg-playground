const SHOPIFY_API_VERSION = "2026-07";

let cachedToken = null;
let tokenExpiresAt = 0;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} environment variable.`);
  return value;
}

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;

  const shop = requiredEnv("SHOPIFY_STORE_DOMAIN");
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: requiredEnv("SHOPIFY_CLIENT_ID"),
      client_secret: requiredEnv("SHOPIFY_CLIENT_SECRET"),
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || "Shopify authentication failed.");
  }
  cachedToken = body.access_token;
  tokenExpiresAt = Date.now() + Number(body.expires_in || 3600) * 1000;
  return cachedToken;
}

async function shopifyGraphql(query, variables = {}) {
  const shop = requiredEnv("SHOPIFY_STORE_DOMAIN");
  const response = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": await getAccessToken(),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (!response.ok || body.errors) {
    throw new Error(body.errors?.map((error) => error.message).join("; ") || `Shopify returned ${response.status}.`);
  }
  return body.data;
}

module.exports = { shopifyGraphql };
