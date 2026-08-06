const crypto = require("crypto");
const { gmailSupabaseRest } = require("./supabase");

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

async function gmailConnection(senderEmail) {
  const email = encodeURIComponent(String(senderEmail).toLowerCase());
  const rows = await gmailSupabaseRest(`crm_gmail_connections?email=eq.${email}&select=email,scopes,connected_at,updated_at&limit=1`);
  return rows?.[0] || null;
}

async function gmailAccessToken(senderEmail) {
  const email = encodeURIComponent(String(senderEmail).toLowerCase());
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

function hasCalendarScope(connection) {
  return (connection?.scopes || []).some((scope) => [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.events.owned",
  ].includes(scope));
}

function nextDate(date) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

async function createCalendarTaskEvent(ownerEmail, task, prospect) {
  const connection = await gmailConnection(ownerEmail);
  if (!connection) throw new Error(`${ownerEmail} has not connected Google.`);
  if (!hasCalendarScope(connection)) throw new Error(`${ownerEmail} must reconnect Google to enable Calendar.`);
  const accessToken = await gmailAccessToken(ownerEmail);
  const details = [task.notes, prospect ? `Contact: ${prospect.contact_name || prospect.company_name} (${prospect.company_name})` : "", `CRM task: ${process.env.CRM_APP_URL || "https://greg-playground.vercel.app"}`].filter(Boolean).join("\n\n");
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ summary: task.title, description: details, start: { date: task.due_date }, end: { date: nextDate(task.due_date) }, transparency: "transparent", extendedProperties: { private: { crmTaskId: task.id } } }),
  });
  const body = await response.json();
  if (!response.ok || !body.id) throw new Error(body.error?.message || "Google Calendar could not create the event.");
  return body;
}

async function deleteCalendarTaskEvent(ownerEmail, eventId) {
  if (!ownerEmail || !eventId) return;
  const accessToken = await gmailAccessToken(ownerEmail);
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error?.message || "Google Calendar could not delete the event.");
  }
}

module.exports = { env, signState, verifyState, encryptToken, decryptToken, gmailConnection, gmailAccessToken, hasCalendarScope, createCalendarTaskEvent, deleteCalendarTaskEvent };
