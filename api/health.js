module.exports = function handler(req, res) {
  res.status(200).json({ ok: true, shopifyConfigured: Boolean(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET) });
};
