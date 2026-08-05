module.exports = function handler(req, res) {
  let supabaseProject = null;
  let gmailSupabaseProject = null;
  try {
    supabaseProject = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname.split(".")[0] : null;
  } catch (_) {}
  try {
    gmailSupabaseProject = process.env.GMAIL_SUPABASE_URL ? new URL(process.env.GMAIL_SUPABASE_URL).hostname.split(".")[0] : null;
  } catch (_) {}
  res.status(200).json({ ok: true, shopifyConfigured: Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET), supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY), supabaseProject, gmailSupabaseConfigured: Boolean(process.env.GMAIL_SUPABASE_URL && process.env.GMAIL_SUPABASE_SECRET_KEY), gmailSupabaseProject, accessProtected: Boolean(process.env.CRM_ACCESS_CODE || process.env.CRM_GREG_ACCESS_CODE || process.env.CRM_CRAIG_ACCESS_CODE || process.env.CRM_REP1_ACCESS_CODE) });
};
