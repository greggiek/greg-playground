const { gmailSupabaseRest, supabaseRest } = require("../../../lib/supabase");
const { sessionCookie } = require("../../../lib/auth");
const { env, verifyState, encryptToken } = require("../../../lib/google");

function appUrl(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  return `${protocol}://${host}`;
}

function cookieValue(req, name) {
  const match = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method not allowed.");
  const destination = new URL(appUrl(req));
  try {
    if (req.query.error) throw new Error(`Google authorization was cancelled: ${req.query.error}`);
    const state = verifyState(req.query.state);
    if (!state.nonce || cookieValue(req, "bargain_oauth_nonce") !== state.nonce) throw new Error("Google sign-in session expired. Please try again.");
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
    if (!googleUser.email_verified) throw new Error("Google could not verify this email address.");
    const googleEmail = String(googleUser.email || "").toLowerCase();
    const expectedEmail = String(state.email || googleEmail).toLowerCase();
    if (googleEmail !== expectedEmail) throw new Error(`Please connect ${expectedEmail}, not ${googleUser.email || "that account"}.`);
    const users = await supabaseRest(`crm_users?email=eq.${encodeURIComponent(googleEmail)}&active=eq.true&select=id,name,email,role&limit=1`);
    const crmUser = users?.[0];
    if (!crmUser) throw new Error(`${googleEmail} is not an active Bargain CRM user. Ask a manager to add this account.`);
    await supabaseRest(`crm_users?id=eq.${encodeURIComponent(crmUser.id)}`, { method: "PATCH", body: JSON.stringify({ last_login_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
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
    res.setHeader("Set-Cookie", [sessionCookie(crmUser), "bargain_oauth_nonce=; Path=/api/auth/google/callback; HttpOnly; Secure; SameSite=Lax; Max-Age=0"]);
    res.setHeader("Cache-Control", "private, no-store");
    destination.searchParams.set("login", "connected");
    destination.searchParams.set("gmail", "connected");
  } catch (error) {
    destination.searchParams.set("gmail", "error");
    destination.searchParams.set("message", error.message);
  }
  return res.redirect(302, destination.toString());
};
