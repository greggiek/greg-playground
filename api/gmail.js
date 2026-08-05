const { requireManager } = require("./_auth");
const { gmailConnection, env } = require("./_google");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!requireManager(req, res)) return;
  try {
    const connection = await gmailConnection();
    return res.status(200).json({ connected: Boolean(connection), email: env("GMAIL_SENDER_EMAIL"), connectedAt: connection?.connected_at || null });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
