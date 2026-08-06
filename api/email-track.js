const { gmailSupabaseRest } = require("../lib/supabase");

const pixel = Buffer.from("R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=", "base64");

function sendPixel(res) {
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  return res.status(200).send(pixel);
}

module.exports = async function handler(req, res) {
  const token = String(req.query?.token || "");
  const type = String(req.query?.type || "");

  if (type === "open") {
    try {
      if (/^[0-9a-f-]{36}$/i.test(token)) {
        await gmailSupabaseRest(`crm_email_messages?open_token=eq.${encodeURIComponent(token)}&first_opened_at=is.null`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ first_opened_at: new Date().toISOString() }),
        });
      }
    } catch (_) {}
    return sendPixel(res);
  }

  if (type === "click") {
    if (!/^[0-9a-f-]{36}$/i.test(token)) return res.status(404).send("Link not found.");
    try {
      const rows = await gmailSupabaseRest(`crm_email_links?token=eq.${encodeURIComponent(token)}&select=id,message_id,url&limit=1`);
      const link = rows?.[0];
      if (!link) return res.status(404).send("Link not found.");
      const now = new Date().toISOString();
      await Promise.all([
        gmailSupabaseRest(`crm_email_links?id=eq.${link.id}&first_clicked_at=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ first_clicked_at: now }) }),
        gmailSupabaseRest(`crm_email_messages?id=eq.${link.message_id}&first_clicked_at=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ first_clicked_at: now }) }),
      ]);
      return res.redirect(302, link.url);
    } catch (_) {
      return res.status(404).send("Link not found.");
    }
  }

  if (type === "unsubscribe") {
    if (!/^[0-9a-f-]{36}$/i.test(token)) return res.status(404).send("Unsubscribe link not found.");
    try {
      const rows = await gmailSupabaseRest(`crm_email_messages?unsubscribe_token=eq.${encodeURIComponent(token)}&select=recipient_email,campaign_id&limit=1`);
      const message = rows?.[0];
      if (!message) return res.status(404).send("Unsubscribe link not found.");
      await gmailSupabaseRest("crm_email_unsubscribes", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ email: message.recipient_email.toLowerCase(), token, source_campaign_id: message.campaign_id, unsubscribed_at: new Date().toISOString() }) });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send("<!doctype html><meta name=viewport content='width=device-width'><title>Unsubscribed</title><main style='max-width:560px;margin:80px auto;font:18px system-ui;padding:24px'><h1>You’re unsubscribed</h1><p>You will no longer receive campaign emails from Bargain Moulding.</p></main>");
    } catch (_) {
      return res.status(500).send("We could not process this request. Please contact Bargain Moulding.");
    }
  }

  return res.status(404).send("Tracking event not found.");
};
