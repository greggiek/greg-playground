const { requireCrmAccess, requireManager } = require("../lib/auth");
const { supabaseRest } = require("../lib/supabase");
const { createCalendarTaskEvent, deleteCalendarTaskEvent } = require("../lib/google");
const crypto = require("crypto");

const PRODUCT_INTERESTS = new Set(["Doors", "Moulding", "PVC", "Kitchen", "Entry Doors"]);
function cleanProductInterests(value) {
  return [...new Set(Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter((item) => PRODUCT_INTERESTS.has(item)) : [])];
}
function cleanProspectIds(value, limit = 250) {
  const ids = [...new Set(Array.isArray(value) ? value.map(String) : [])].filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id));
  return ids.slice(0, limit);
}
async function activeOwner(value, fallback = "Greg") {
  const name = String(value || "").trim();
  if (!name) return fallback;
  const rows = await supabaseRest(`crm_users?name=eq.${encodeURIComponent(name)}&active=eq.true&select=name&limit=1`);
  return rows?.[0]?.name || fallback;
}
function isManager(user) { return user.role === "manager"; }

function after(value, cutoff) { return value && new Date(value) >= cutoff; }

async function teamActivitySnapshot(prospects, tasks) {
  const [users, connections, messages] = await Promise.all([
    supabaseRest("crm_users?select=id,name,email,role,active,created_at,last_login_at&order=name.asc"),
    supabaseRest("crm_gmail_connections?select=email,scopes,connected_at"),
    supabaseRest("crm_email_messages?select=sender_email,status,sent_at,created_at&order=created_at.desc&limit=5000"),
  ]);
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const today = new Date().toISOString().slice(0, 10);
  const activities = prospects.flatMap((prospect) => prospect.crm_activities || []);
  const quotes = prospects.flatMap((prospect) => prospect.crm_quotes || []);
  return users.map((member) => {
    const memberTasks = tasks.filter((task) => task.assigned_to === member.name);
    const recentActivities = activities.filter((activity) => activity.user_name === member.name && after(activity.created_at, cutoff));
    const recentQuotes = quotes.filter((quote) => quote.created_by === member.name && after(quote.created_at, cutoff));
    const recentEmails = messages.filter((message) => message.sender_email?.toLowerCase() === member.email.toLowerCase() && message.status === "sent" && after(message.sent_at || message.created_at, cutoff));
    const timestamps = [member.last_login_at, ...recentActivities.map((item) => item.created_at), ...recentQuotes.map((item) => item.created_at), ...recentEmails.map((item) => item.sent_at || item.created_at), ...memberTasks.map((item) => item.completed_at || item.created_at)].filter(Boolean).sort();
    const connection = connections.find((item) => item.email.toLowerCase() === member.email.toLowerCase());
    return { ...member, contactsOwned: prospects.filter((item) => item.owner_name === member.name).length, openTasks: memberTasks.filter((item) => item.status === "open").length, overdueTasks: memberTasks.filter((item) => item.status === "open" && item.due_date < today).length, completedTasks30: memberTasks.filter((item) => item.status === "completed" && after(item.completed_at, cutoff)).length, activities30: recentActivities.length, quotes30: recentQuotes.length, emails30: recentEmails.length, lastActivityAt: timestamps.at(-1) || null, googleConnected: Boolean(connection), calendarConnected: Boolean(connection?.scopes?.some((scope) => scope.includes("calendar"))) };
  });
}

async function getDormantSettings() {
  const rows = await supabaseRest("crm_dormant_settings?id=eq.true&select=*&limit=1");
  return rows?.[0] || null;
}

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

async function getTask(id) {
  const rows = await supabaseRest(`crm_tasks?id=eq.${encodeURIComponent(id || "")}&select=id,assigned_to,google_calendar_event_id,calendar_owner_email&limit=1`);
  return rows?.[0] || null;
}

async function calendarOwnerEmail(user, assignedTo) {
  if (assignedTo === user.name) return user.email;
  const rows = await supabaseRest(`crm_users?name=eq.${encodeURIComponent(assignedTo)}&active=eq.true&select=email&limit=1`);
  return rows?.[0]?.email || null;
}

async function requireTaskAccess(user, taskId, res) {
  const task = await getTask(taskId);
  if (task && (isManager(user) || task.assigned_to === user.name)) return task;
  res.status(403).json({ error: "You do not have access to this task." });
  return false;
}

module.exports = async function handler(req, res) {
  const user = await requireCrmAccess(req, res);
  if (!user) return;
  try {
    if (req.method === "GET") {
      const select = encodeURIComponent("*,crm_activities(*),crm_reminders(*),crm_quotes(*,crm_quote_lines(*))");
      const ownerFilter = isManager(user) ? "" : `owner_name=eq.${encodeURIComponent(user.name)}&`;
      const prospects = await supabaseRest(`crm_prospects?${ownerFilter}select=${select}&order=created_at.desc`);
      const taskFilter = isManager(user) ? "" : `assigned_to=eq.${encodeURIComponent(user.name)}&`;
      const tasks = await supabaseRest(`crm_tasks?${taskFilter}select=*&order=due_date.asc,created_at.asc`);
      const teamSnapshot = isManager(user) ? await teamActivitySnapshot(prospects, tasks) : [];
      const dormantSettings = isManager(user) ? await getDormantSettings() : null;
      return res.status(200).json({ prospects, tasks, currentUser: user, teamSnapshot, dormantSettings });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
    const { action, data = {} } = req.body || {};

    if (action === "updateDormantSettings") {
      if (!(await requireManager(req, res))) return;
      const allowedStages = new Set(["New Lead", "Contacted", "Quoting", "Follow-Up", "Won", "Lost"]);
      const stages = [...new Set(Array.isArray(data.stages) ? data.stages.filter((stage) => allowedStages.has(stage)) : [])];
      const inactivityDays = Math.min(365, Math.max(1, Math.round(Number(data.inactivityDays || 30))));
      const dueInDays = Math.min(30, Math.max(0, Math.round(Number(data.dueInDays || 0))));
      const priority = ["low", "normal", "high"].includes(data.priority) ? data.priority : "normal";
      if (!stages.length) return res.status(400).json({ error: "Choose at least one pipeline stage." });
      const [settings] = await supabaseRest("crm_dormant_settings?id=eq.true", {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          enabled: data.enabled === true,
          inactivity_days: inactivityDays,
          due_in_days: dueInDays,
          stages,
          skip_if_open_task: data.skipIfOpenTask !== false,
          priority,
          updated_by: user.name,
          updated_at: new Date().toISOString(),
        }),
      });
      return res.status(200).json({ settings });
    }

    if (action === "runDormantAutomation") {
      if (!(await requireManager(req, res))) return;
      const createdCount = Number(await supabaseRest("rpc/crm_run_dormant_reminders", { method: "POST", body: "{}" }) || 0);
      const settings = await getDormantSettings();
      return res.status(200).json({ createdCount, settings });
    }

    if (action === "createUser") {
      if (!(await requireManager(req, res))) return;
      const name = String(data.name || "").trim();
      const email = String(data.email || "").trim().toLowerCase();
      const role = data.role === "manager" ? "manager" : "sales_rep";
      if (!name || !/^[^@\s]+@bargainmoulding\.com$/i.test(email)) return res.status(400).json({ error: "Enter a name and a valid @bargainmoulding.com email." });
      const [member] = await supabaseRest("crm_users", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ name, email, role, active: true, access_code_hash: crypto.createHash("sha256").update(crypto.randomUUID()).digest("hex") }) });
      return res.status(201).json({ member });
    }

    if (action === "updateUser") {
      if (!(await requireManager(req, res))) return;
      if (!data.id) return res.status(400).json({ error: "User ID is required." });
      const role = data.role === "manager" ? "manager" : "sales_rep";
      const active = data.active !== false;
      if (data.id === user.id && (!active || role !== "manager")) return res.status(400).json({ error: "You cannot deactivate or demote your own manager account." });
      const [member] = await supabaseRest(`crm_users?id=eq.${encodeURIComponent(data.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ role, active, updated_at: new Date().toISOString() }) });
      if (!member) return res.status(404).json({ error: "User not found." });
      return res.status(200).json({ member });
    }

    if (action === "createTask") {
      const title = String(data.title || "").trim();
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(String(data.dueDate || ""))) return res.status(400).json({ error: "Task title and due date are required." });
      const assignedTo = isManager(user) ? await activeOwner(data.assignedTo, user.name) : user.name;
      if (data.prospectId && !await canAccessProspect(user, data.prospectId)) return res.status(403).json({ error: "You do not have access to that contact." });
      const allowedTypes = new Set(["follow_up", "call", "email", "quote", "admin"]);
      const allowedPriorities = new Set(["low", "normal", "high"]);
      let [task] = await supabaseRest("crm_tasks", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ title, notes: String(data.notes || "").trim(), task_type: allowedTypes.has(data.taskType) ? data.taskType : "follow_up", priority: allowedPriorities.has(data.priority) ? data.priority : "normal", due_date: data.dueDate, assigned_to: assignedTo, prospect_id: data.prospectId || null, created_by: user.name }) });
      const ownerEmail = await calendarOwnerEmail(user, assignedTo);
      let calendarSyncError = null;
      try {
        if (!ownerEmail) throw new Error(`${assignedTo} does not have an email address configured.`);
        const prospectRows = data.prospectId ? await supabaseRest(`crm_prospects?id=eq.${encodeURIComponent(data.prospectId)}&select=company_name,contact_name&limit=1`) : [];
        const event = await createCalendarTaskEvent(ownerEmail, task, prospectRows?.[0] || null);
        [task] = await supabaseRest(`crm_tasks?id=eq.${encodeURIComponent(task.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ google_calendar_event_id: event.id, calendar_owner_email: ownerEmail, calendar_synced_at: new Date().toISOString(), calendar_sync_error: null }) });
      } catch (error) {
        calendarSyncError = error.message || "Calendar sync failed.";
        [task] = await supabaseRest(`crm_tasks?id=eq.${encodeURIComponent(task.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ calendar_owner_email: ownerEmail, calendar_sync_error: calendarSyncError }) });
      }
      return res.status(201).json({ task, calendarSynced: Boolean(task.google_calendar_event_id), calendarSyncError });
    }

    if (action === "setTaskStatus") {
      if (!await requireTaskAccess(user, data.id, res)) return;
      const completed = data.status === "completed";
      const [task] = await supabaseRest(`crm_tasks?id=eq.${encodeURIComponent(data.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: completed ? "completed" : "open", completed_at: completed ? new Date().toISOString() : null }) });
      return res.status(200).json({ task });
    }

    if (action === "deleteTask") {
      const task = await requireTaskAccess(user, data.id, res);
      if (!task) return;
      try { await deleteCalendarTaskEvent(task.calendar_owner_email, task.google_calendar_event_id); } catch (error) { console.warn("Calendar event cleanup failed:", error.message); }
      await supabaseRest(`crm_tasks?id=eq.${encodeURIComponent(data.id)}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }

    if (action === "createProspect") {
      const owner = isManager(user) ? await activeOwner(data.owner, user.name) : user.name;
      const [prospect] = await supabaseRest("crm_prospects", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ company_name: data.companyName, contact_name: data.contactName || "", email: data.email || "", phone: data.phone || "", address: data.address || "", stage: data.stage || "New Lead", estimated_value: Number(data.estimatedValue || 0), owner_name: owner, created_by: user.name, product_interests: cleanProductInterests(data.productInterests) }),
      });
      await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify({ prospect_id: prospect.id, activity_type: "created", body: data.notes || "Created prospect.", user_name: user.name }) });
      return res.status(201).json({ prospect });
    }

    if (action === "updateProspect") {
      if (!await requireProspectAccess(user, data.id, res)) return;
      const owner = isManager(user) ? await activeOwner(data.owner, user.name) : user.name;
      const patch = { company_name: data.companyName, contact_name: data.contactName || "", email: data.email || "", phone: data.phone || "", address: data.address || "", stage: data.stage, estimated_value: Number(data.estimatedValue || 0), owner_name: owner, product_interests: cleanProductInterests(data.productInterests) };
      const [prospect] = await supabaseRest(`crm_prospects?id=eq.${encodeURIComponent(data.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
      if (data.oldStage && data.oldStage !== data.stage) await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify({ prospect_id: data.id, activity_type: "stage", body: `Moved from ${data.oldStage} to ${data.stage}.`, user_name: user.name }) });
      return res.status(200).json({ prospect });
    }

    if (action === "updateOwner") {
      if (!(await requireManager(req, res))) return;
      if (!data.id) return res.status(400).json({ error: "Prospect ID is required." });
      const selectedOwner = await activeOwner(data.owner, "");
      if (!selectedOwner) return res.status(400).json({ error: "Choose an active salesperson." });
      const [prospect] = await supabaseRest(`crm_prospects?id=eq.${encodeURIComponent(data.id)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ owner_name: selectedOwner, updated_at: new Date().toISOString() }) });
      if (!prospect) return res.status(404).json({ error: "Prospect not found." });
      await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify({ prospect_id: data.id, activity_type: "owner", body: `Account owner changed from ${data.oldOwner || "Unassigned"} to ${selectedOwner}.`, user_name: user.name }) });
      return res.status(200).json({ prospect });
    }

    if (action === "bulkReassignProspects") {
      if (!(await requireManager(req, res))) return;
      const ids = cleanProspectIds(data.prospectIds);
      if (!ids.length) return res.status(400).json({ error: "Select at least one contact." });
      const owner = await activeOwner(data.owner, "");
      if (!owner) return res.status(400).json({ error: "Choose an active salesperson." });
      const prospects = await supabaseRest(`crm_prospects?id=in.(${ids.join(",")})&select=id,owner_name`);
      await supabaseRest(`crm_prospects?id=in.(${ids.join(",")})`, { method: "PATCH", body: JSON.stringify({ owner_name: owner, updated_at: new Date().toISOString() }) });
      const activities = prospects.map((prospect) => ({ prospect_id: prospect.id, activity_type: "owner", body: `Account owner changed from ${prospect.owner_name || "Unassigned"} to ${owner} by bulk action.`, user_name: user.name }));
      if (activities.length) await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify(activities) });
      return res.status(200).json({ updated: prospects.length, owner });
    }

    if (action === "bulkCreateTasks") {
      if (!(await requireManager(req, res))) return;
      const ids = cleanProspectIds(data.prospectIds, 200);
      const title = String(data.title || "Follow up").trim().slice(0, 120);
      if (!ids.length || !title || !/^\d{4}-\d{2}-\d{2}$/.test(String(data.dueDate || ""))) return res.status(400).json({ error: "Select contacts and enter a task title and due date." });
      const assignedMode = data.assignmentMode === "selected" ? "selected" : "owner";
      const selectedOwner = assignedMode === "selected" ? await activeOwner(data.assignedTo, "") : "";
      if (assignedMode === "selected" && !selectedOwner) return res.status(400).json({ error: "Choose an active salesperson." });
      const allowedTypes = new Set(["follow_up", "call", "email", "quote", "admin"]);
      const allowedPriorities = new Set(["low", "normal", "high"]);
      const prospects = await supabaseRest(`crm_prospects?id=in.(${ids.join(",")})&select=id,company_name,contact_name,owner_name`);
      const tasks = prospects.map((prospect) => ({
        title: `${title}: ${prospect.company_name || prospect.contact_name || "Contact"}`,
        notes: String(data.notes || "").trim().slice(0, 2000),
        task_type: allowedTypes.has(data.taskType) ? data.taskType : "follow_up",
        priority: allowedPriorities.has(data.priority) ? data.priority : "normal",
        due_date: data.dueDate,
        assigned_to: assignedMode === "selected" ? selectedOwner : (prospect.owner_name || user.name),
        prospect_id: prospect.id,
        created_by: user.name,
        calendar_sync_error: "Bulk-created task. Calendar sync is available for individual tasks."
      }));
      const created = tasks.length ? await supabaseRest("crm_tasks", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(tasks) }) : [];
      return res.status(201).json({ created: created.length });
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
      if (!(await requireManager(req, res))) return;
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
      if (!(await requireManager(req, res))) return;
      if (!data.quoteId) return res.status(400).json({ error: "Quote ID is required." });
      const deleted = await supabaseRest(`crm_quotes?id=eq.${encodeURIComponent(data.quoteId)}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      const quote = deleted?.[0];
      if (!quote) return res.status(404).json({ error: "Quote not found." });
      await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify({ prospect_id: quote.prospect_id, activity_type: "quote_deleted", body: `Deleted CRM quote ${quote.quote_number}.`, user_name: user.name }) });
      return res.status(200).json({ ok: true });
    }

    if (action === "markQuoteConverted") {
      if (!(await requireManager(req, res))) return;
      const [quote] = await supabaseRest(`crm_quotes?id=eq.${encodeURIComponent(data.quoteId)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "converted", shopify_draft_order_id: data.shopifyDraftOrderId, shopify_draft_order_name: data.shopifyDraftOrderName, shopify_invoice_url: data.invoiceUrl }) });
      return res.status(200).json({ quote });
    }

    return res.status(400).json({ error: "Unknown CRM action." });
  } catch (error) {
    console.error("CRM API failed:", error);
    return res.status(500).json({ error: error.message || "CRM database request failed." });
  }
};
