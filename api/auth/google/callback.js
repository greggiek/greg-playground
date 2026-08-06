const { gmailSupabaseRest } = require("../../../lib/supabase");
const { env, verifyState, encryptToken } = require("../../../lib/google");

function appUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${host}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed.");
  const destination = new URL(appUrl(req));
  try {
    if (req.query.error) throw new Error(`Google authorization was cancelled: ${req.query.error}`);
    const state = verifyState(req.query.state);
    if (!req.query.code) throw new Error("Google did not return an authorization code.");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: env("GOOGLE_CLIENT_ID"),
        client_secret: env("GOOGLE_CLIENT_SECRET"),
        redirect_uri: env("GOOGLE_REDIRECT_URI"),
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokens.error_description || "Google token exchange failed.");
    if (!tokens.refresh_token) throw new Error("Google did not issue a refresh token. Reconnect and approve access again.");
    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const googleUser = await userResponse.json();
    if (!userResponse.ok) throw new Error("Could not verify the connected Google account.");
    const expectedEmail = String(state.email || "").toLowerCase();
    if (!expectedEmail) throw new Error("CRM user email is missing. Sign in and try again.");
    if (String(googleUser.email || "").toLowerCase() !== expectedEmail) throw new Error(`Please connect ${expectedEmail}, not ${googleUser.email || "that account"}.`);
    await gmailSupabaseRest("crm_gmail_connections?on_conflict=email", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        email: expectedEmail,
        refresh_token_encrypted: encryptToken(tokens.refresh_token),
        scopes: String(tokens.scope || "").split(" ").filter(Boolean),
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    });
    destination.searchParams.set("gmail", "connected");
  } catch (error) {
    destination.searchParams.set("gmail", "error");
    destination.searchParams.set("message", error.message);
  }
  return res.redirect(302, destination.toString());
};
