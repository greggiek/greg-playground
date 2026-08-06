const { gmailSupabaseRest } = require("../../_supabase");
const pixel = Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64");

module.exports = async function handler(req, res) {
  try {
    const token = String(req.query?.token || "");
    if (/^[0-9a-f-]{36}$/i.test(token)) await gmailSupabaseRest(`crm_email_messages?open_token=eq.${encodeURIComponent(token)}&first_opened_at=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ first_opened_at: new Date().toISOString() }) });
  } catch (_) {}
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  return res.status(200).send(pixel);
};
