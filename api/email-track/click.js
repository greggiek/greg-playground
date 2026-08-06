const { gmailSupabaseRest } = require("../../_supabase");

module.exports = async function handler(req, res) {
  const token = String(req.query?.token || "");
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
};
