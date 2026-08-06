const crypto = require("crypto");
const { supabaseRest } = require("./supabase");

function hashCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function legacyProfiles() {
  return [
    { name: "Greg", email: process.env.CRM_GREG_EMAIL || process.env.GMAIL_SENDER_EMAIL || "greg@bargainmoulding.com", role: "manager", code: process.env.CRM_GREG_ACCESS_CODE || process.env.CRM_ACCESS_CODE },
    { name: "Craig", email: process.env.CRM_CRAIG_EMAIL || "craig@bargainmoulding.com", role: "manager", code: process.env.CRM_CRAIG_ACCESS_CODE },
    { name: "Rep 1", email: process.env.CRM_REP1_EMAIL || "rep1@bargainmoulding.com", role: "sales_rep", code: process.env.CRM_REP1_ACCESS_CODE },
  ].filter((profile) => profile.code);
}

async function requireCrmAccess(req, res) {
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

module.exports = { requireCrmAccess, requireManager, hashCode };
