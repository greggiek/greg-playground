const { sessionUser, clearSessionCookie } = require("../../../lib/auth");
const { env, signState } = require("../../../lib/google");
const crypto = require("crypto");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (req.query.logout === "1") {
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ ok: true });
  }
  try {
    const user = await sessionUser(req);
    const nonce = crypto.randomBytes(24).toString("base64url");
    const state = signState({ purpose: req.query.mode === "login" ? "login" : "connect", nonce, userId: user?.id || null, email: user?.email || null, expiresAt: Date.now() + 10 * 60 * 1000 });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", env("GOOGLE_CLIENT_ID"));
    url.searchParams.set("redirect_uri", env("GOOGLE_REDIRECT_URI"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    if (user?.email) url.searchParams.set("login_hint", user.email);
    url.searchParams.set("scope", "openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events");
    url.searchParams.set("state", state);
    res.setHeader("Set-Cookie", `bargain_oauth_nonce=${nonce}; Path=/api/auth/google/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).json({ url: url.toString() });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
