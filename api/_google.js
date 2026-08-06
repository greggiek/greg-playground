const crypto = require("crypto");
const { gmailSupabaseRest } = require("./_supabase");

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signState(payload) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", env("GOOGLE_CLIENT_SECRET")).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyState(state) {
  const [encoded, signature] = String(state || "").split(".");
  if (!encoded || !signature) throw new Error("Invalid Google authorization state.");
  const expected = crypto.createHmac("sha256", env("GOOGLE_CLIENT_SECRET")).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) throw new Error("Invalid Google authorization state.");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!payload.expiresAt || Date.now() > payload.expiresAt) throw new Error("Google authorization expired. Please try again.");
  return payload;
}

function encryptToken(token) {
  const key = crypto.createHash("sha256").update(env("GOOGLE_CLIENT_SECRET")).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptToken(value) {
  const [ivPart, tagPart, encryptedPart] = String(value || "").split(".");
  if (!ivPart || !tagPart || !encryptedPart) throw new Error("Stored Gmail token is invalid. Reconnect Gmail.");
  const key = crypto.createHash("sha256").update(env("GOOGLE_CLIENT_SECRET")).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedPart, "base64url")), decipher.final()]).toString("utf8");
}

async function gmailConnection() {
  const email = encodeURIComponent(env("GMAIL_SENDER_EMAIL").toLowerCase());
  const rows = await gmailSupabaseRest(`crm_gmail_connections?email=eq.${email}&select=email,connected_at,updated_at&limit=1`);
  return rows?.[0] || null;
}

async function gmailAccessToken() {
  const email = encodeURIComponent(env("GMAIL_SENDER_EMAIL").toLowerCase());
  const rows = await gmailSupabaseRest(`crm_gmail_connections?email=eq.${email}&select=refresh_token_encrypted&limit=1`);
  if (!rows?.[0]) throw new Error("Gmail is not connected.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: decryptToken(rows[0].refresh_token_encrypted), grant_type: "refresh_token" }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw new Error(body.error_description || "Could not refresh Gmail access.");
  return body.access_token;
}

module.exports = { env, signState, verifyState, encryptToken, decryptToken, gmailConnection, gmailAccessToken };
