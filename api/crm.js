const { requireCrmAccess } = require("./_auth");
const { supabaseRest } = require("./_supabase");

module.exports = async function handler(req, res) {
  if (!requireCrmAccess(req, res)) return;
  try {
    if (req.method === "GET") {
      const select = encodeURIComponent("*,crm_activities(*),crm_reminders(*),crm_quotes(*,crm_quote_lines(*))");
      const prospects = await supabaseRest(`crm_prospects?select=${select}&order=created_at.desc`);
      return res.status(200).json({ prospects });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
    const { action, data = {} } = req.body || {};

    if (action === "createProspect") {
      const [prospect] = await supabaseRest("crm_prospects", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ company_name: data.companyName, contact_name: data.contactName || "", email: data.email || "", phone: data.phone || "", address: data.address || "", stage: data.stage || "New Lead", estimated_value: Number(data.estimatedValue || 0), owner_name: data.owner || "Greg", created_by: data.createdBy || "Greg" }),
      });
      await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify({ prospect_id: prospect.id, activity_type: "created", body: data.notes || "Created prospect.", user_name: data.createdBy || "Greg" }) });
      return res.status(201).json({ prospect });
    }

    if (action === "saveQuote") {
      const total = (data.lines || []).reduce((sum, line) => sum + Number(line.unitPrice) * Number(line.qty), 0);
      const [quote] = await supabaseRest("crm_quotes", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ prospect_id: data.prospectId, quote_number: data.quoteNumber, status: "draft", subtotal: total, total, customer_message: data.customerMessage || "", created_by: data.createdBy || "Greg" }),
      });
      const lines = (data.lines || []).map((line, position) => ({ quote_id: quote.id, shopify_variant_id: line.productId, product_title: line.title, variant_title: line.variant || "", sku: line.sku || "", unit_price: Number(line.unitPrice), quantity: Number(line.qty), position }));
      if (lines.length) await supabaseRest("crm_quote_lines", { method: "POST", body: JSON.stringify(lines) });
      await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify({ prospect_id: data.prospectId, activity_type: "quote", body: `Saved CRM quote ${data.quoteNumber} — $${total.toFixed(2)}`, user_name: data.createdBy || "Greg" }) });
      return res.status(201).json({ quote: { ...quote, crm_quote_lines: lines } });
    }

    return res.status(400).json({ error: "Unknown CRM action." });
  } catch (error) {
    console.error("CRM API failed:", error);
    return res.status(500).json({ error: error.message || "CRM database request failed." });
  }
};
