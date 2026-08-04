module.exports = function handler(req, res) {
  res.status(200).json({ ok: true, shopifyConfigured: Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET), supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY), accessProtected: Boolean(process.env.CRM_ACCESS_CODE || process.env.CRM_GREG_ACCESS_CODE || process.env.CRM_CRAIG_ACCESS_CODE || process.env.CRM_REP1_ACCESS_CODE) });
};
