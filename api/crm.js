const { requireCrmAccess, requireManager } = require("../lib/auth");
const { supabaseRest } = require("../lib/supabase");

const OWNERS = new Set(["Greg", "Craig", "Rep 1"]);
function validOwner(value) { return OWNERS.has(value) ? value : "Greg"; }
function isManager(user) { return user.role === "manager"; }

async function getProspect(id) {
  if (!id) return null;
  const rows = await supabaseRest(`crm_prospects?id=eq.${encodeURIComponent(id)}&select=id,owner_name`);
  return rows?.[0] || null;
}

async function canAccessProspect(user, prospectId) {
  const prospect = await getProspect(prospectId);
  return Boolean(prospect && (isManager(user) || prospect.owner_name === user.name));
}

async function requireProspectAccess(user, prospectId, res) {
  if (await canAccessProspect(user, prospectId)) return true;
  res.status(403).json({ error: "You do not have access to this account." });
  return false;
}

module.exports = async function handler(req, res) {
  const user = requireCrmAccess(req, res);
  if (!user) return;
  try {
    if (req.method === "GET") {
      const select = encodeURIComponent("*,crm_activities(*),crm_reminders(*),crm_quotes(*,crm_quote_lines(*))");
      const ownerFilter = isManager(user) ? "" : `owner_name=eq.${encodeURIComponent(user.name)}&`;
      const prospects = await supabaseRest(`crm_prospects?${ownerFilter}select=${select}&order=created_at.desc`);
      return res.status(200).json({ prospects, currentUser: user });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
    const { action, data = {} } = req.body || {};

    if (action === "createProspect") {
      const owner = isManager(user) ? validOwner(data.owner) : user.name;
      const [prospect] = await supabaseRest("crm_prospects", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ company_name: data.companyName, contact_name: data.contactName || "", email: data.email || "", phone: data.phone || "", address: data.address || "", stage: data.stage || "New Lead", estimated_value: Number(data.estimatedValue || 0), owner_name: owner, created_by: user.name }),
      });
      await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify({ prospect_id: prospect.id, activity_type: "created", body: data.notes || "Created prospect.", user_name: user.name }) });
      return res.status(201).json({ prospect });
    }

    if (action === "updateProspect") {
      if (!await requireProspectAccess(user, data.id, res)) return;
      const owner = isManager(user) ? validOwner(data.owner) : user.name;
      const patch = { company_name: data.companyName, contact_name: data.contactName || "", email: data.email || "", phone: data.phone || "", address: data.address || "", stage: data.stage, estimated_value: Number(data.estimatedValue || 0), owner_name: owner };
      const [prospect] = await supabaseRest(`crm_prospects?id=eq.${encodeURIComponent(data.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
      if (data.oldStage && data.oldStage !== data.stage) await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify({ prospect_id: data.id, activity_type: "stage", body: `Moved from ${data.oldStage} to ${data.stage}.`, user_name: user.name }) });
      return res.status(200).json({ prospect });
    }

    if (action === "updateOwner") {
      if (!requireManager(req, res)) return;
      if (!data.id || !OWNERS.has(data.owner)) return res.status(400).json({ error: "Choose Greg, Craig, or Rep 1 as the account owner." });
      const [prospect] = await supabaseRest(`crm_prospects?id=eq.${encodeURIComponent(data.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ owner_name: data.owner }) });
      if (!prospect) return res.status(404).json({ error: "Prospect not found." });
      await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify({ prospect_id: data.id, activity_type: "owner", body: `Account owner changed from ${data.oldOwner || "Unassigned"} to ${data.owner}.`, user_name: user.name }) });
      return res.status(200).json({ prospect });
    }

    if (action === "addNote") {
      if (!await requireProspectAccess(user, data.prospectId, res)) return;
      const [activity] = await supabaseRest("crm_activities", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ prospect_id: data.prospectId, activity_type: "note", body: data.note, user_name: user.name }) });
      if (data.reminderDate) await supabaseRest("crm_reminders", { method: "POST", body: JSON.stringify({ prospect_id: data.prospectId, activity_id: activity.id, due_date: data.reminderDate, note: data.note }) });
      return res.status(201).json({ activity });
    }

    if (action === "completeReminder") {
      const reminders = await supabaseRest(`crm_reminders?id=eq.${encodeURIComponent(data.id)}&select=prospect_id`);
      if (!reminders?.[0] || !await requireProspectAccess(user, reminders[0].prospect_id, res)) return;
      await supabaseRest(`crm_reminders?id=eq.${encodeURIComponent(data.id)}`, { method: "PATCH", body: JSON.stringify({ completed: true, completed_at: new Date().toISOString() }) });
      return res.status(200).json({ ok: true });
    }

    if (action === "deleteProspect") {
      if (!requireManager(req, res)) return;
      if (!data.id) return res.status(400).json({ error: "Prospect ID is required." });
      await supabaseRest(`crm_prospects?id=eq.${encodeURIComponent(data.id)}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }

    if (action === "saveQuote") {
      if (!await requireProspectAccess(user, data.prospectId, res)) return;
      const total = (data.lines || []).reduce((sum, line) => sum + Number(line.unitPrice) * Number(line.qty), 0);
      const [quote] = await supabaseRest("crm_quotes", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ prospect_id: data.prospectId, quote_number: data.quoteNumber, status: "draft", subtotal: total, total, customer_message: data.customerMessage || "", created_by: user.name }),
      });
      const lines = (data.lines || []).map((line, position) => ({ quote_id: quote.id, shopify_variant_id: line.productId, product_title: line.title, variant_title: line.variant || "", sku: line.sku || "", unit_price: Number(line.unitPrice), quantity: Number(line.qty), position }));
      if (lines.length) await supabaseRest("crm_quote_lines", { method: "POST", body: JSON.stringify(lines) });
      await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify({ prospect_id: data.prospectId, activity_type: "quote", body: `Saved CRM quote ${data.quoteNumber} — $${total.toFixed(2)}`, user_name: user.name }) });
      return res.status(201).json({ quote: { ...quote, crm_quote_lines: lines } });
    }

    if (action === "deleteQuote") {
      if (!requireManager(req, res)) return;
      if (!data.quoteId) return res.status(400).json({ error: "Quote ID is required." });
      const deleted = await supabaseRest(`crm_quotes?id=eq.${encodeURIComponent(data.quoteId)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      const quote = deleted?.[0];
      if (!quote) return res.status(404).json({ error: "Quote not found." });
      await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify({ prospect_id: quote.prospect_id, activity_type: "quote_deleted", body: `Deleted CRM quote ${quote.quote_number}.`, user_name: user.name }) });
      return res.status(200).json({ ok: true });
    }

    if (action === "markQuoteConverted") {
      if (!requireManager(req, res)) return;
      const [quote] = await supabaseRest(`crm_quotes?id=eq.${encodeURIComponent(data.quoteId)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "converted", shopify_draft_order_id: data.shopifyDraftOrderId, shopify_draft_order_name: data.shopifyDraftOrderName, shopify_invoice_url: data.invoiceUrl }) });
      return res.status(200).json({ quote });
    }

    return res.status(400).json({ error: "Unknown CRM action." });
  } catch (error) {
    console.error("CRM API failed:", error);
    return res.status(500).json({ error: error.message || "CRM database request failed." });
  }
};
