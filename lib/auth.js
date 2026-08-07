const crypto = require("crypto");
const { supabaseRest } = require("./supabase");

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function sessionSecret() {
  const secret = process.env.CRM_SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error("Missing CRM session secret.");
  return secret;
}

function signSession(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, email: user.email, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifySession(value) {
  try {
    const [payload, signature] = String(value || "").split(".");
    if (!payload || !signature) return null;
    const expected = crypto.createHmac("sha256", sessionSecret()).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.expiresAt > Date.now() ? session : null;
  } catch (_) { return null; }
}

function sessionCookie(user) {
  return `bargain_crm_session=${signSession(user)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
}

function clearSessionCookie() {
  return "bargain_crm_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

function cookieValue(req, name) {
  const match = String(req.headers.cookie || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
}

async function sessionUser(req) {
  const session = verifySession(cookieValue(req, "bargain_crm_session"));
  if (!session) return null;
  const rows = await supabaseRest(`crm_users?id=eq.${encodeURIComponent(session.id)}&email=eq.${encodeURIComponent(String(session.email).toLowerCase())}&active=eq.true&select=id,name,email,role&limit=1`);
  return rows?.[0] || null;
}

function legacyProfiles() {
  return [
    { name: "Greg", email: process.env.CRM_GREG_EMAIL || process.env.GMAIL_SENDER_EMAIL || "greg@bargainmoulding.com", role: "manager", code: process.env.CRM_GREG_ACCESS_CODE || process.env.CRM_ACCESS_CODE },
    { name: "Craig", email: process.env.CRM_CRAIG_EMAIL || "craig@bargainmoulding.com", role: "manager", code: process.env.CRM_CRAIG_ACCESS_CODE },
    { name: "Rep 1", email: process.env.CRM_REP1_EMAIL || "rep1@bargainmoulding.com", role: "sales_rep", code: process.env.CRM_REP1_ACCESS_CODE },
  ].filter((profile) => profile.code);
}

async function requireCrmAccess(req, res) {
  try {
    const signedInUser = await sessionUser(req);
    if (signedInUser) {
      req.crmUser = signedInUser;
      return signedInUser;
    }
  } catch (_) {}
  const provided = String(req.headers["x-crm-access-code"] || "");
  if (!provided) {
    res.status(401).json({ error: "Invalid CRM access code." });
    return false;
  }
  const accessCodeHash = hashCode(provided);
  try {
    const rows = await supabaseRest(`crm_users?access_code_hash=eq.${accessCodeHash}&active=eq.true&select=id,name,email,role&limit=1`);
    if (rows?.[0]) {
      req.crmUser = rows[0];
      return req.crmUser;
    }
  } catch (_) {}

  const legacy = legacyProfiles().find((profile) => provided === profile.code);
  if (!legacy) {
    res.status(401).json({ error: "Invalid CRM access code." });
    return false;
  }
  const id = crypto.randomUUID();
  try {
    const rows = await supabaseRest("crm_users?on_conflict=email", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ id, name: legacy.name, email: legacy.email.toLowerCase(), role: legacy.role, access_code_hash: accessCodeHash, active: true, updated_at: new Date().toISOString() }),
    });
    req.crmUser = rows?.[0] || { id, name: legacy.name, email: legacy.email.toLowerCase(), role: legacy.role };
  } catch (_) {
    req.crmUser = { id, name: legacy.name, email: legacy.email.toLowerCase(), role: legacy.role };
  }
  return req.crmUser;
}

async function requireManager(req, res) {
  const user = req.crmUser || await requireCrmAccess(req, res);
  if (!user) return false;
  if (user.role !== "manager") {
    res.status(403).json({ error: "Manager access required." });
    return false;
  }
  return user;
}

module.exports = { requireCrmAccess, requireManager, hashCode, sessionUser, sessionCookie, clearSessionCookie };
