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

    if (action === "updateProspect") {
      const patch = { company_name: data.companyName, contact_name: data.contactName || "", email: data.email || "", phone: data.phone || "", address: data.address || "", stage: data.stage, estimated_value: Number(data.estimatedValue || 0), owner_name: data.owner };
      const [prospect] = await supabaseRest(`crm_prospects?id=eq.${encodeURIComponent(data.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
      if (data.oldStage && data.oldStage !== data.stage) await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify({ prospect_id: data.id, activity_type: "stage", body: `Moved from ${data.oldStage} to ${data.stage}.`, user_name: data.user || "Greg" }) });
      return res.status(200).json({ prospect });
    }

    if (action === "addNote") {
      const [activity] = await supabaseRest("crm_activities", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ prospect_id: data.prospectId, activity_type: "note", body: data.note, user_name: data.user || "Greg" }) });
      if (data.reminderDate) await supabaseRest("crm_reminders", { method: "POST", body: JSON.stringify({ prospect_id: data.prospectId, activity_id: activity.id, due_date: data.reminderDate, note: data.note }) });
      return res.status(201).json({ activity });
    }

    if (action === "completeReminder") {
      await supabaseRest(`crm_reminders?id=eq.${encodeURIComponent(data.id)}`, { method: "PATCH", body: JSON.stringify({ completed: true, completed_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
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

    if (action === "markQuoteConverted") {
      const [quote] = await supabaseRest(`crm_quotes?id=eq.${encodeURIComponent(data.quoteId)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "converted", shopify_draft_order_id: data.shopifyDraftOrderId, shopify_draft_order_name: data.shopifyDraftOrderName, shopify_invoice_url: data.invoiceUrl }) });
      return res.status(200).json({ quote });
    }

    return res.status(400).json({ error: "Unknown CRM action." });
  } catch (error) {
    console.error("CRM API failed:", error);
    return res.status(500).json({ error: error.message || "CRM database request failed." });
  }
};
