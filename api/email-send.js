const crypto = require("crypto");
const { requireManager } = require("../lib/auth");
const { gmailSupabaseRest } = require("../lib/supabase");
const { env, gmailAccessToken } = require("../lib/google");

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function appOrigin(req) {
  return `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
}

function validRecipient(item) {
  const email = String(item?.email || item?.recipientEmail || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email, name: String(item?.name || item?.recipientName || "").trim() } : null;
}

async function sendOne({ req, accessToken, campaignId, recipient, subject, plainBody }) {
  const messageId = crypto.randomUUID();
  const openToken = crypto.randomUUID();
  const unsubscribeToken = crypto.randomUUID();
  const origin = appOrigin(req);
  const links = [];
  const escaped = escapeHtml(plainBody).replace(/https?:\/\/[^\s<]+/g, (url) => {
    const cleanUrl = url.replace(/[),.!?]+$/, "");
    const token = crypto.randomUUID();
    links.push({ id: crypto.randomUUID(), message_id: messageId, token, url: cleanUrl });
    return `<a href="${origin}/api/email-track?type=click&token=${token}">${escapeHtml(cleanUrl)}</a>${escapeHtml(url.slice(cleanUrl.length))}`;
  }).replaceAll("\n", "<br>");
  const unsubscribeUrl = `${origin}/api/email-track?type=unsubscribe&token=${unsubscribeToken}`;
  const html = `${escaped}<hr style="margin-top:28px;border:0;border-top:1px solid #ddd"><p style="font-size:12px;color:#666">Bargain Moulding · <a href="${unsubscribeUrl}">Unsubscribe</a></p><img src="${origin}/api/email-track?type=open&token=${openToken}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px">`;
  const boundary = `bargain_${crypto.randomBytes(12).toString("hex")}`;
  const mime = [
    `From: Bargain Moulding <${env("GMAIL_SENDER_EMAIL")}>`,
    `To: ${recipient.name ? `${recipient.name.replace(/[\r\n]/g, "")} <${recipient.email}>` : recipient.email}`,
    `Subject: ${subject.replace(/[\r\n]/g, " ")}`,
    "MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "", `${plainBody}\n\nUnsubscribe: ${unsubscribeUrl}`,
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "", html, `--${boundary}--`, "",
  ].join("\r\n");

  await gmailSupabaseRest("crm_email_messages", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id: messageId, campaign_id: campaignId, recipient_email: recipient.email, recipient_name: recipient.name, subject, status: "queued", open_token: openToken, unsubscribe_token: unsubscribeToken, created_by: req.crmUser.name }) });
  if (links.length) await gmailSupabaseRest("crm_email_links", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(links) });
  try {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ raw: Buffer.from(mime, "utf8").toString("base64url") }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message || "Gmail send failed.");
    await gmailSupabaseRest(`crm_email_messages?id=eq.${messageId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", gmail_message_id: body.id, sent_at: new Date().toISOString() }) });
    return { email: recipient.email, status: "sent" };
  } catch (error) {
    await gmailSupabaseRest(`crm_email_messages?id=eq.${messageId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "failed", error: error.message }) });
    return { email: recipient.email, status: "failed", error: error.message };
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!requireManager(req, res)) return;
  const subject = String(req.body?.subject || "").trim();
  const plainBody = String(req.body?.body || "").trim();
  const campaignName = String(req.body?.campaignName || subject || "Email campaign").trim();
  const rawRecipients = Array.isArray(req.body?.recipients) ? req.body.recipients : [req.body];
  const unique = new Map(rawRecipients.map(validRecipient).filter(Boolean).map((item) => [item.email, item]));
  const recipients = [...unique.values()];
  if (!recipients.length || !subject || !plainBody) return res.status(400).json({ error: "At least one valid recipient, a subject, and a message are required." });
  if (recipients.length > 25) return res.status(400).json({ error: "Campaigns are limited to 25 recipients during beta." });
  if (subject.length > 300 || plainBody.length > 20000 || campaignName.length > 120) return res.status(400).json({ error: "Campaign content is too long." });

  try {
    const unsubscribedRows = await gmailSupabaseRest("crm_email_unsubscribes?select=email");
    const unsubscribed = new Set(unsubscribedRows.map((row) => String(row.email).toLowerCase()));
    const eligible = recipients.filter((recipient) => !unsubscribed.has(recipient.email));
    if (!eligible.length) return res.status(400).json({ error: "All selected recipients have unsubscribed." });
    const campaignId = crypto.randomUUID();
    await gmailSupabaseRest("crm_email_campaigns", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ id: campaignId, name: campaignName, subject, body: plainBody, status: "sending", total_recipients: eligible.length, created_by: req.crmUser.name }) });
    const accessToken = await gmailAccessToken();
    const results = [];
    for (const recipient of eligible) results.push(await sendOne({ req, accessToken, campaignId, recipient, subject, plainBody }));
    const failures = results.filter((item) => item.status === "failed").length;
    await gmailSupabaseRest(`crm_email_campaigns?id=eq.${campaignId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: failures ? "completed_with_errors" : "completed", completed_at: new Date().toISOString() }) });
    return res.status(200).json({ ok: true, campaignId, sent: results.length - failures, failed: failures, skippedUnsubscribed: recipients.length - eligible.length, results });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
