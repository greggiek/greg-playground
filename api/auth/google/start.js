const { requireManager } = require("../../../lib/auth");
const { env, signState } = require("../../../lib/google");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!(await requireManager(req, res))) return;
  try {
    const state = signState({ userId: req.crmUser.id, user: req.crmUser.name, email: req.crmUser.email, expiresAt: Date.now() + 10 * 60 * 1000 });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", env("GOOGLE_CLIENT_ID"));
    url.searchParams.set("redirect_uri", env("GOOGLE_REDIRECT_URI"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("login_hint", req.crmUser.email);
    url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/gmail.send");
    url.searchParams.set("state", state);
    return res.status(200).json({ url: url.toString() });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
