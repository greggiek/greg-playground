const { requireManager } = require("../lib/auth");
const { gmailSupabaseRest } = require("../lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!(await requireManager(req, res))) return;
  try {
    const senderEmail = encodeURIComponent(req.crmUser.email.toLowerCase());
    const [messages, campaigns, unsubscribes] = await Promise.all([
      gmailSupabaseRest(`crm_email_messages?sender_email=eq.${senderEmail}&select=id,campaign_id,recipient_email,recipient_name,subject,status,sent_at,first_opened_at,first_clicked_at,created_at&order=created_at.desc&limit=5000`),
      gmailSupabaseRest(`crm_email_campaigns?sender_email=eq.${senderEmail}&select=id,name,subject,status,total_recipients,created_at,completed_at&order=created_at.desc&limit=500`),
      gmailSupabaseRest("crm_email_unsubscribes?select=email,unsubscribed_at&order=unsubscribed_at.desc&limit=5000"),
    ]);
    const sent = messages.filter((m) => m.status === "sent");
    const campaignResults = campaigns.map((campaign) => {
      const rows = messages.filter((message) => message.campaign_id === campaign.id);
      const accepted = rows.filter((message) => message.status === "sent");
      return { ...campaign, sent: accepted.length, failed: rows.filter((message) => message.status === "failed").length, opened: accepted.filter((message) => message.first_opened_at).length, clicked: accepted.filter((message) => message.first_clicked_at).length };
    });
    return res.status(200).json({ summary: { sent: sent.length, opened: sent.filter((m) => m.first_opened_at).length, clicked: sent.filter((m) => m.first_clicked_at).length, unsubscribed: unsubscribes.length }, campaigns: campaignResults, messages });
  } catch (error) { return res.status(500).json({ error: error.message }); }
};
