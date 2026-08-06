const { requireManager } = require("./_auth");
const { gmailSupabaseRest } = require("./_supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!requireManager(req, res)) return;
  try {
    const messages = await gmailSupabaseRest("crm_email_messages?select=id,recipient_email,recipient_name,subject,status,sent_at,first_opened_at,first_clicked_at,created_at&order=created_at.desc&limit=100");
    const sent = messages.filter((m) => m.status === "sent");
    return res.status(200).json({ summary: { sent: sent.length, opened: sent.filter((m) => m.first_opened_at).length, clicked: sent.filter((m) => m.first_clicked_at).length }, messages });
  } catch (error) { return res.status(500).json({ error: error.message }); }
};
