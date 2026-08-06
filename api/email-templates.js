const { requireCrmAccess, requireManager } = require("../lib/auth");
const { supabaseRest } = require("../lib/supabase");

module.exports = async function handler(req, res) {
  const user = requireCrmAccess(req, res);
  if (!user || !requireManager(req, res)) return;
  try {
    if (req.method === "GET") {
      const templates = await supabaseRest("crm_email_templates?select=*&order=updated_at.desc");
      return res.status(200).json({ templates });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
    const { action, data = {} } = req.body || {};
    if (action === "save") {
      const name = String(data.name || "").trim();
      const subject = String(data.subject || "").trim();
      const body = String(data.body || "").trim();
      if (!name || !subject || !body) return res.status(400).json({ error: "Template name, subject, and message are required." });
      if (name.length > 120 || subject.length > 300 || body.length > 20000) return res.status(400).json({ error: "Template content is too long." });
      const payload = { name, subject, body, created_by: user.name, updated_at: new Date().toISOString() };
      const path = data.id ? `crm_email_templates?id=eq.${encodeURIComponent(data.id)}` : "crm_email_templates";
      const method = data.id ? "PATCH" : "POST";
      const rows = await supabaseRest(path, { method, headers: { Prefer: "return=representation" }, body: JSON.stringify(payload) });
      return res.status(data.id ? 200 : 201).json({ template: rows?.[0] });
    }
    if (action === "delete") {
      if (!data.id) return res.status(400).json({ error: "Template ID is required." });
      await supabaseRest(`crm_email_templates?id=eq.${encodeURIComponent(data.id)}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Unknown template action." });
  } catch (error) {
    console.error("Email template API failed:", error);
    return res.status(500).json({ error: error.message || "Email template request failed." });
  }
};
