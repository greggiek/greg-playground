const { shopifyGraphql } = require("./_shopify");
const { requireCrmAccess } = require("./_auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!requireCrmAccess(req, res)) return;
  try {
    const search = String(req.query.search || "").trim().slice(0, 100);
    const queryText = search ? search.replace(/[\\:*()]/g, " ").trim() : "";
    const data = await shopifyGraphql(`
      query ProductVariants($query: String!) {
        productVariants(first: 25, query: $query) {
          nodes {
            id title sku price inventoryQuantity
            product { title status }
          }
        }
      }
    `, { query: queryText });

    const products = data.productVariants.nodes
      .filter((variant) => variant.product.status === "ACTIVE")
      .map((variant) => ({
        id: variant.id,
        title: variant.product.title,
        variant: variant.title,
        sku: variant.sku || "No SKU",
        price: Number(variant.price),
        inventoryQuantity: variant.inventoryQuantity,
      }));
    res.status(200).json({ products });
  } catch (error) {
    console.error("Product search failed:", error);
    res.status(500).json({ error: error.message || "Could not load Shopify products." });
  }
};
