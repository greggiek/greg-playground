const { shopifyGraphql } = require("../lib/shopify");
const { requireCrmAccess, requireManager } = require("../lib/auth");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  if (!(await requireCrmAccess(req, res))) return;
  if (!(await requireManager(req, res))) return;
  try {
    const { prospect, lines } = req.body || {};
    if (!prospect?.companyName || !Array.isArray(lines) || !lines.length) {
      return res.status(400).json({ error: "A prospect and at least one line item are required." });
    }
    const lineItems = lines.map((line) => ({
      variantId: String(line.productId),
      quantity: Math.max(1, Number(line.qty) || 1),
    }));
    const data = await shopifyGraphql(`
      mutation CreateDraftOrder($input: DraftOrderInput!) {
        draftOrderCreate(input: $input) {
          draftOrder { id name invoiceUrl status totalPriceSet { shopMoney { amount currencyCode } } }
          userErrors { field message }
        }
      }
    `, {
      input: {
        lineItems,
        email: prospect.email || undefined,
        note: `Bargain CRM quote for ${prospect.companyName}${prospect.contactName ? ` — ${prospect.contactName}` : ""}`,
        tags: ["Bargain CRM"],
      },
    });
    const payload = data.draftOrderCreate;
    if (payload.userErrors.length) {
      return res.status(400).json({ error: payload.userErrors.map((item) => item.message).join("; ") });
    }
    res.status(200).json({ draftOrder: payload.draftOrder });
  } catch (error) {
    console.error("Draft order creation failed:", error);
    res.status(500).json({ error: error.message || "Could not create Shopify draft order." });
  }
};
