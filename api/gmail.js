const { requireManager } = require("../lib/auth");
const { gmailConnection } = require("../lib/google");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!(await requireManager(req, res))) return;
  try {
    const connection = await gmailConnection(req.crmUser.email);
    return res.status(200).json({ connected: Boolean(connection), email: req.crmUser.email, connectedAt: connection?.connected_at || null, user: req.crmUser.name });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
