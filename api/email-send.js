const crypto = require("crypto");
const { requireManager } = require("./_auth");
const { gmailSupabaseRest } = require("./_supabase");
const { env, gmailAccessToken } = require("./_google");

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function appOrigin(req) {
  return `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

function encodeMime(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireManager(req, res)) return;
  const recipientEmail = String(req.body?.recipientEmail || "").trim().toLowerCase();
  const recipientName = String(req.body?.recipientName || "").trim();
  const subject = String(req.body?.subject || "").trim();
  const plainBody = String(req.body?.body || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail) || !subject || !plainBody) return res.status(400).json({ error: "A valid recipient, subject, and message are required." });
  if (subject.length > 300 || plainBody.length > 20000) return res.status(400).json({ error: "Email is too long." });

  const messageId = crypto.randomUUID();
  const openToken = crypto.randomUUID();
  const origin = appOrigin(req);
  const links = [];
  const escaped = escapeHtml(plainBody).replace(/https?:\/\/[^\s<]+/g, (url) => {
    const cleanUrl = url.replace(/[),.!?]+$/, "");
    const token = crypto.randomUUID();
    links.push({ id: crypto.randomUUID(), message_id: messageId, token, url: cleanUrl });
    return `<a href="${origin}/api/email-track/click?token=${token}">${escapeHtml(cleanUrl)}</a>${escapeHtml(url.slice(cleanUrl.length))}`;
  }).replaceAll("\n", "<br>");
  const html = `${escaped}<img src="${origin}/api/email-track/open?token=${openToken}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">`;
  const boundary = `bargain_${crypto.randomBytes(12).toString("hex")}`;
  const mime = [
    `From: Bargain Moulding <${env("GMAIL_SENDER_EMAIL")}>`,
    `To: ${recipientName ? `${recipientName.replace(/[\r\n]/g, "")} <${recipientEmail}>` : recipientEmail}`,
    `Subject: ${subject.replace(/[\r\n]/g, " ")}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", plainBody,
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", html,
    `--${boundary}--`, "",
  ].join("\r\n");

  await gmailSupabaseRest("crm_email_messages", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id: messageId, recipient_email: recipientEmail, recipient_name: recipientName, subject, status: "queued", open_token: openToken, created_by: req.crmUser.name }) });
  if (links.length) await gmailSupabaseRest("crm_email_links", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(links) });
  try {
    const accessToken = await gmailAccessToken();
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: encodeMime(mime) }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Gmail send failed.");
    await gmailSupabaseRest(`crm_email_messages?id=eq.${messageId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", gmail_message_id: body.id, sent_at: new Date().toISOString() }) });
    return res.status(200).json({ ok: true, messageId });
  } catch (error) {
    await gmailSupabaseRest(`crm_email_messages?id=eq.${messageId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "failed", error: error.message }) });
    return res.status(500).json({ error: error.message });
  }
};
