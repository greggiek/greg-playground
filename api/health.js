const { gmailSupabaseRest } = require("./_supabase");

module.exports = async function handler(req, res) {
  let supabaseProject = null;
  let gmailSupabaseProject = null;
  try {
    supabaseProject = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname.split(".")[0] : null;
  } catch (_) {}
  try {
    gmailSupabaseProject = process.env.GMAIL_SUPABASE_URL ? new URL(process.env.GMAIL_SUPABASE_URL).hostname.split(".")[0] : null;
  } catch (_) {}
  const gmailKey = process.env.GMAIL_SUPABASE_SECRET_KEY || "";
  const gmailKeyType = gmailKey.startsWith("sb_secret_") ? "secret" : gmailKey.startsWith("sb_publishable_") ? "publishable" : gmailKey.split(".").length === 3 ? "legacy_jwt" : "unknown";
  let gmailDatabaseReachable = false;
  let gmailDatabaseError = null;
  if (process.env.GMAIL_SUPABASE_URL && gmailKey) {
    try {
      await gmailSupabaseRest("crm_gmail_connections?select=id&limit=0");
      gmailDatabaseReachable = true;
    } catch (error) {
      gmailDatabaseError = error.message;
    }
  }
  res.status(200).json({ ok: true, shopifyConfigured: Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET), supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY), supabaseProject, gmailSupabaseConfigured: Boolean(process.env.GMAIL_SUPABASE_URL && gmailKey), gmailSupabaseProject, gmailKeyType, gmailDatabaseReachable, gmailDatabaseError, accessProtected: Boolean(process.env.CRM_ACCESS_CODE || process.env.CRM_GREG_ACCESS_CODE || process.env.CRM_CRAIG_ACCESS_CODE || process.env.CRM_REP1_ACCESS_CODE) });
};
