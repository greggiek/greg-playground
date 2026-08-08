const { shopifyGraphql } = require("../lib/shopify");
const { requireCrmAccess } = require("../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  if (!(await requireCrmAccess(req, res))) return;
  try {
    if (req.query.mode === "collections") {
      const data = await shopifyGraphql(`
        query CrmQuoteCollections {
          collections(first: 100, sortKey: TITLE) {
            nodes {
              id title handle
              crmVisible: metafield(namespace: "custom", key: "show_in_crm_quote_builder") { value }
            }
          }
        }
      `);
      const collections = data.collections.nodes
        .filter((collection) => String(collection.crmVisible?.value).toLowerCase() === "true")
        .map(({ id, title, handle }) => ({ id, title, handle }));
      return res.status(200).json({ collections });
    }

    const search = String(req.query.search || "").trim().slice(0, 100);
    const queryText = search ? search.replace(/[\\:*()]/g, " ").trim() : "";
    const collectionId = String(req.query.collection || "").match(/(?:Collection\/)?(\d+)$/)?.[1] || "";
    const filters = [collectionId ? `collection:${collectionId}` : "", queryText].filter(Boolean).join(" AND ");
    const data = await shopifyGraphql(`
      query ProductVariants($query: String!) {
        productVariants(first: 25, query: $query) {
          nodes {
            id title sku price inventoryQuantity
            product { title status }
          }
        }
      }
    `, { query: filters });

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
