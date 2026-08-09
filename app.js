const STORAGE_KEY = "bargainProspectCRM.v1";

let state = { prospects: [], tasks: [] };
localStorage.removeItem(STORAGE_KEY);
let currentProspectId = null;
let draftQuoteLines = [];
let productSearchTimer = null;
let currentUser = null;
let emailTemplates = [];
let editingEmailTemplateId = null;
let contactsPage = 1;
let contactsMineOnly = false;
let homeEmailMessages = [];
let agendaView = "week";
let teamSnapshot = [];
let shopifyCollections = [];
let selectedShopifyCollectionId = "";
let prospectSaveInFlight = false;

const $ = (selector) => document.querySelector(selector);

async function crmFetch(url, options = {}) {
  const accessCode = sessionStorage.getItem("bargainCrmAccessCode") || "";
  const response = await fetch(url, {
    ...options,
    credentials: "same-origin",
    headers: { ...(options.headers || {}), ...(accessCode ? { "X-CRM-Access-Code": accessCode } : {}) },
  });
  return response;
}

function showLogin(message = "") {
  currentUser = null;
  $("#app").classList.add("app-locked");
  $("#loginScreen").hidden = false;
  $("#loginError").textContent = message;
}

function showCrm() {
  $("#loginScreen").hidden = true;
  $("#app").classList.remove("app-locked");
}

function fromDbProspect(p) {
  return {
    id: p.id, companyName: p.company_name, contactName: p.contact_name, email: p.email,
    phone: p.phone, address: p.address, stage: p.stage, estimatedValue: Number(p.estimated_value),
    owner: p.owner_name, customerId: p.shopify_customer_id, createdAt: p.created_at,
    timeline: (p.crm_activities || []).map((a) => ({ id: a.id, at: a.created_at, user: a.user_name, text: a.body })),
    reminders: (p.crm_reminders || []).map((r) => ({ id: r.id, date: r.due_date, note: r.note, completed: r.completed })),
    quotes: (p.crm_quotes || []).map((q) => ({ id: q.id, number: q.quote_number, createdAt: q.created_at, status: q.status, total: Number(q.total), shopifyDraftOrderId: q.shopify_draft_order_id, shopifyDraftOrderName: q.shopify_draft_order_name, invoiceUrl: q.shopify_invoice_url, lines: (q.crm_quote_lines || []).map((l) => ({ id: l.id, productId: l.shopify_variant_id, title: l.product_title, variant: l.variant_title, sku: l.sku, unitPrice: Number(l.unit_price), qty: l.quantity })) })),
  };
}

function fromDbTask(task) {
  return { id: task.id, title: task.title, notes: task.notes || "", taskType: task.task_type, priority: task.priority, dueDate: task.due_date, assignedTo: task.assigned_to, prospectId: task.prospect_id, status: task.status, createdBy: task.created_by, createdAt: task.created_at, completedAt: task.completed_at, calendarEventId: task.google_calendar_event_id, calendarOwnerEmail: task.calendar_owner_email, calendarSyncedAt: task.calendar_synced_at, calendarSyncError: task.calendar_sync_error };
}

async function refreshCrm(openId) {
  const response = await crmFetch("/api/crm");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load CRM.");
  currentUser = body.currentUser || currentUser;
  showCrm();
  applyProfilePermissions();
  state = { prospects: (body.prospects || []).map(fromDbProspect), tasks: (body.tasks || []).map(fromDbTask) };
  teamSnapshot = body.teamSnapshot || [];
  saveState();
  renderHome();
  loadGoogleConnection().catch(() => {});
  if (isManager()) loadHomeEmailActivity();
  if (openId) openProspect(openId);
}

async function crmAction(action, data) {
  const response = await crmFetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "CRM update failed.");
  return body;
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && parsed.prospects) {
      parsed.prospects = parsed.prospects.map(normalizeProspect);
      return parsed;
    }
  } catch (error) {
    console.warn("Could not load saved CRM data:", error);
  }
  return { prospects: [] };
}

function normalizeProspect(p) {
  return {
    contactName: "", email: "", stage: p.customerId ? "Won" : "New Lead",
    estimatedValue: 0, owner: "Greg", timeline: [], reminders: [], quotes: [], ...p,
  };
}

function saveState() {
  localStorage.removeItem(STORAGE_KEY);
}

function isManager() {
  return currentUser?.role === "manager";
}

function currentUserName() {
  return currentUser?.name || "Greg";
}

function applyProfilePermissions() {
  if (!currentUser) return;
  const manager = isManager();
  $("#profileBadge").hidden = false;
  $("#profileBadge").textContent = `${currentUser.name} · ${manager ? "Manager" : "Sales Rep"}`;
  $("#switchUserBtn").hidden = false;
  $("#teamBtn").hidden = !manager;
  $("#campaignsBtn").hidden = !manager;
  $("#bulkEmailBtn").hidden = !manager;
  $("#importProspectsBtn").hidden = !manager;
  $("#exportBtn").hidden = !manager;
  [$("#prospectForm").elements.owner, $("#editForm").elements.owner].forEach((select) => {
    select.disabled = !manager;
    if (!manager) select.value = currentUser.name;
  });
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function formatDateTime(iso) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value || 0);
}

function getTodayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function getReminderStatus(dateString) {
  if (!dateString) return null;
  const reminder = new Date(`${dateString}T00:00:00`);
  const today = getTodayStart();
  if (reminder < today) return "overdue";
  if (reminder.getTime() === today.getTime()) return "today";
  return "upcoming";
}

function showView(id) {
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("active"));
  $(`#${id}`).classList.add("active");
  window.scrollTo({ top: 0, behavior: "instant" });
}

function prospectById(id) {
  return state.prospects.find((p) => p.id === id);
}

function latestReminder(prospect) {
  const active = (prospect.reminders || []).filter((r) => !r.completed);
  return active.sort((a, b) => new Date(a.date) - new Date(b.date))[0] || null;
}

function renderHome() {
  const hour = new Date().getHours();
  $("#dashboardGreeting").textContent = `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${currentUserName()}`;
  $("#dashboardDate").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date());
  const search = ($("#searchInput").value || "").trim().toLowerCase();
  const stage = $("#stageFilter").value;
  const prospects = [...state.prospects]
    .filter((p) => [p.companyName, p.contactName, p.email, p.phone, p.address, p.owner].join(" ").toLowerCase().includes(search))
    .filter((p) => !stage || p.stage === stage)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const followUps = state.prospects
    .map((p) => ({ prospect: p, reminder: latestReminder(p) }))
    .filter((x) => x.reminder)
    .sort((a, b) => new Date(a.reminder.date) - new Date(b.reminder.date));

  $("#followUpCount").textContent = followUps.filter(
    (x) => getReminderStatus(x.reminder.date) !== "upcoming"
  ).length;

  const openProspects = state.prospects.filter((p) => !["Won", "Lost"].includes(p.stage));
  $("#pipelineValue").textContent = formatMoney(openProspects.reduce((sum, p) => sum + Number(p.estimatedValue || 0), 0));
  $("#activeCount").textContent = openProspects.length;
  $("#quoteCount").textContent = state.prospects.reduce((sum, p) => sum + (p.quotes || []).length, 0);
  $("#wonCount").textContent = state.prospects.filter((p) => p.stage === "Won" || p.customerId).length;
  renderHomeActivity();
  renderAgenda();

  $("#followUpList").innerHTML = followUps.length
    ? followUps.map(({ prospect, reminder }) => `
      <button class="follow-card ${getReminderStatus(reminder.date)}" data-open-prospect="${prospect.id}">
        <div class="card-title">${escapeHtml(prospect.companyName)}</div>
        <div class="card-meta">
          ${escapeHtml(reminder.note || "Follow up")}<br>
          ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${reminder.date}T00:00:00`))}
        </div>
      </button>`).join("")
    : `<div class="empty">No follow-ups scheduled.</div>`;

  $("#prospectList").innerHTML = prospects.length
    ? prospects.map((p) => {
        const reminder = latestReminder(p);
        return `
        <button class="prospect-card" data-open-prospect="${p.id}">
          <div class="card-title">${escapeHtml(p.companyName)}</div>
          <div class="card-meta">
            ${escapeHtml(p.contactName || p.phone || "No contact")}${p.contactName && p.phone ? ` · ${escapeHtml(p.phone)}` : ""}<br>
            ${escapeHtml(p.address || "No address")}
            <div class="record-meta"><span class="badge ${stageClass(p.stage)}">${escapeHtml(p.stage)}</span><span class="badge">${escapeHtml(p.owner)}</span>${p.estimatedValue ? `<span class="badge">${formatMoney(p.estimatedValue)}</span>` : ""}${reminder ? `<span class="badge">Next: ${escapeHtml(reminder.date)}</span>` : ""}</div>
          </div>
        </button>`;
      }).join("")
    : `<div class="empty">No prospects yet. Tap “New Prospect” to add one.</div>`;

  document.querySelectorAll("[data-open-prospect]:not(.task-contact-link)").forEach((el) => {
    el.addEventListener("click", () => openProspect(el.dataset.openProspect));
  });
}

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function currentWeekBounds() {
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return [dateKey(monday), dateKey(sunday)];
}

function renderAgenda() {
  const search = $("#agendaSearch").value.trim().toLowerCase();
  const selectedAssignee = $("#agendaAssignee").value;
  const taskType = $("#agendaType").value;
  const showCompleted = $("#agendaShowCompleted").checked;
  const assignees = [...new Set([currentUserName(), ...state.tasks.map((task) => task.assignedTo)].filter(Boolean))].sort();
  $("#agendaAssignee").innerHTML = `<option value="">All assignees</option>${assignees.map((name) => `<option${name === selectedAssignee ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}`;
  const today = dateKey();
  const [weekStart, weekEnd] = currentWeekBounds();
  const tasks = state.tasks.filter((task) => {
    const viewMatches = agendaView === "today" ? task.dueDate === today : agendaView === "overdue" ? task.dueDate < today && task.status !== "completed" : agendaView === "week" ? task.dueDate >= weekStart && task.dueDate <= weekEnd && task.assignedTo === currentUserName() : true;
    return viewMatches && (showCompleted || task.status !== "completed") && (!selectedAssignee || task.assignedTo === selectedAssignee) && (!taskType || task.taskType === taskType) && (!search || [task.title, task.notes, task.assignedTo].join(" ").toLowerCase().includes(search));
  }).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || ({ high: 0, normal: 1, low: 2 }[a.priority] - { high: 0, normal: 1, low: 2 }[b.priority]));
  const openTaskCount = tasks.filter((task) => task.status !== "completed").length;
  $("#agendaSummary").textContent = `${openTaskCount} open task${openTaskCount === 1 ? "" : "s"} · Week of ${weekStart}`;
  $("#agendaTableBody").innerHTML = tasks.length ? tasks.map((task) => {
    const prospect = prospectById(task.prospectId);
    const overdue = task.status !== "completed" && task.dueDate < today;
    const calendarStatus = task.calendarEventId ? `<span class="badge">Synced</span>` : `<span class="badge" title="${escapeHtml(task.calendarSyncError || "Calendar has not synced")}">Not synced</span>`;
    return `<tr class="${task.status === "completed" ? "task-completed" : overdue ? "task-overdue" : ""}"><td><button class="task-check" data-task-toggle="${task.id}" data-task-status="${task.status}" type="button" aria-label="${task.status === "completed" ? "Reopen" : "Complete"} task">${task.status === "completed" ? "✓" : ""}</button></td><td><strong>${escapeHtml(task.title)}</strong>${task.notes ? `<div class="card-meta">${escapeHtml(task.notes)}</div>` : ""}</td><td>${prospect ? `<button class="task-contact-link" data-open-prospect="${prospect.id}" type="button">${escapeHtml(prospect.contactName || prospect.companyName)}</button>` : "—"}</td><td><span class="badge">${escapeHtml(task.taskType.replaceAll("_", " "))}</span></td><td><strong>${escapeHtml(task.dueDate)}</strong></td><td>${escapeHtml(task.assignedTo)}</td><td><span class="badge priority-${task.priority}">${escapeHtml(task.priority)}</span></td><td>${calendarStatus}</td><td><button class="icon-btn task-delete" data-task-delete="${task.id}" type="button" aria-label="Delete task">×</button></td></tr>`;
  }).join("") : `<tr><td colspan="9"><div class="empty">No tasks match this agenda view.</div></td></tr>`;
  document.querySelectorAll("[data-task-toggle]").forEach((button) => button.addEventListener("click", async () => { button.disabled = true; try { await crmAction("setTaskStatus", { id: button.dataset.taskToggle, status: button.dataset.taskStatus === "completed" ? "open" : "completed" }); await refreshCrm(); } catch (error) { alert(error.message); } }));
  document.querySelectorAll("[data-task-delete]").forEach((button) => button.addEventListener("click", async () => { if (!confirm("Delete this task?")) return; try { await crmAction("deleteTask", { id: button.dataset.taskDelete }); await refreshCrm(); } catch (error) { alert(error.message); } }));
  document.querySelectorAll(".task-contact-link[data-open-prospect]").forEach((button) => button.addEventListener("click", () => openProspect(button.dataset.openProspect)));
}

async function loadHomeEmailActivity() {
  try {
    const response = await crmFetch("/api/email-analytics");
    const body = await response.json();
    if (!response.ok) return;
    homeEmailMessages = body.messages || [];
    renderHomeActivity();
  } catch (_) {}
}

function renderHomeActivity() {
  const filter = $("#activityTypeFilter").value;
  const events = [];
  state.prospects.forEach((prospect) => {
    events.push({ type: "contact", at: prospect.createdAt, title: `${prospect.contactName || prospect.companyName} was added`, detail: prospect.companyName, prospectId: prospect.id });
    (prospect.timeline || []).filter((item) => !/^created prospect\.?$/i.test(item.text || "")).forEach((item) => events.push({ type: "note", at: item.at, title: `${item.user || "A user"} logged activity`, detail: `${prospect.companyName}: ${item.text}`, prospectId: prospect.id }));
    (prospect.quotes || []).forEach((quote) => events.push({ type: "quote", at: quote.createdAt, title: `${quote.number || "A quote"} was created`, detail: `${prospect.companyName} · ${formatMoney(quote.total)}`, prospectId: prospect.id }));
  });
  homeEmailMessages.forEach((message) => {
    const person = message.recipient_name || message.recipient_email;
    const matchingProspect = state.prospects.find((prospect) => String(prospect.email || "").toLowerCase() === String(message.recipient_email || "").toLowerCase());
    if (message.sent_at) events.push({ type: "email_sent", at: message.sent_at, title: `Email sent to ${person}`, detail: message.subject, prospectId: matchingProspect?.id });
    if (message.first_opened_at) events.push({ type: "email_open", at: message.first_opened_at, title: `${person} opened an email`, detail: message.subject, prospectId: matchingProspect?.id });
    if (message.first_clicked_at) events.push({ type: "email_click", at: message.first_clicked_at, title: `${person} clicked an email link`, detail: message.subject, prospectId: matchingProspect?.id });
  });
  const visible = events.filter((event) => event.at && (!filter || event.type === filter)).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 50);
  const labels = { contact: "Contact", note: "Note", quote: "Quote", email_sent: "Sent", email_open: "Open", email_click: "Click" };
  $("#activityFeed").innerHTML = visible.length ? visible.map((event) => `<button class="activity-item" type="button"${event.prospectId ? ` data-activity-prospect="${event.prospectId}"` : ""}><span class="activity-icon activity-${event.type}">${labels[event.type].slice(0, 1)}</span><span class="activity-copy"><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.detail || "")}</small></span><span class="activity-meta"><span class="badge">${labels[event.type]}</span><time>${formatDateTime(event.at)}</time></span></button>`).join("") : `<div class="empty">No activity matches this view yet.</div>`;
  document.querySelectorAll("[data-activity-prospect]").forEach((item) => item.addEventListener("click", () => openProspect(item.dataset.activityProspect)));
}

function contactLastActivity(prospect) {
  const activityDates = (prospect.timeline || []).map((item) => item.at).filter(Boolean);
  return activityDates.sort((a, b) => new Date(b) - new Date(a))[0] || prospect.createdAt;
}

function renderContacts() {
  const search = $("#contactsSearch").value.trim().toLowerCase();
  const stage = $("#contactsStage").value;
  const selectedOwner = $("#contactsOwner").value;
  const owners = [...new Set(state.prospects.map((p) => p.owner).filter(Boolean))].sort();
  const ownerValue = selectedOwner;
  $("#contactsOwner").innerHTML = `<option value="">All owners</option>${owners.map((owner) => `<option${owner === ownerValue ? " selected" : ""}>${escapeHtml(owner)}</option>`).join("")}`;

  const [sortField, sortDirection] = $("#contactsSort").value.split(":");
  const direction = sortDirection === "asc" ? 1 : -1;
  const rows = state.prospects.filter((p) => {
    const haystack = [p.contactName, p.companyName, p.email, p.phone, p.address, p.owner, p.stage].join(" ").toLowerCase();
    return (!search || haystack.includes(search)) && (!stage || p.stage === stage) && (!ownerValue || p.owner === ownerValue) && (!contactsMineOnly || p.owner === currentUserName());
  }).sort((a, b) => {
    let left = sortField === "lastActivity" ? contactLastActivity(a) : a[sortField];
    let right = sortField === "lastActivity" ? contactLastActivity(b) : b[sortField];
    if (["createdAt", "lastActivity"].includes(sortField)) return (new Date(left || 0) - new Date(right || 0)) * direction;
    if (sortField === "estimatedValue") return (Number(left || 0) - Number(right || 0)) * direction;
    return String(left || "").localeCompare(String(right || ""), undefined, { sensitivity: "base" }) * direction;
  });

  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  contactsPage = Math.min(contactsPage, pageCount);
  const start = (contactsPage - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  $("#contactsCount").textContent = `${rows.length.toLocaleString()} contact${rows.length === 1 ? "" : "s"}`;
  $("#contactsRange").textContent = rows.length ? `${start + 1}–${Math.min(start + pageSize, rows.length)} of ${rows.length}` : "0 contacts";
  $("#contactsPrev").disabled = contactsPage === 1;
  $("#contactsNext").disabled = contactsPage === pageCount;
  $("#contactsTableBody").innerHTML = pageRows.length ? pageRows.map((p) => `
    <tr data-contact-id="${p.id}" tabindex="0">
      <td><strong>${escapeHtml(p.contactName || "No contact name")}</strong></td><td>${escapeHtml(p.companyName)}</td>
      <td><span class="badge ${stageClass(p.stage)}">${escapeHtml(p.stage)}</span></td><td>${escapeHtml(p.owner)}</td>
      <td>${escapeHtml(p.email || "—")}</td><td>${escapeHtml(p.phone || "—")}</td><td>${formatMoney(p.estimatedValue)}</td>
      <td>${contactLastActivity(p) ? formatDateTime(contactLastActivity(p)) : "—"}</td><td>${p.createdAt ? formatDateTime(p.createdAt) : "—"}</td>
    </tr>`).join("") : `<tr><td colspan="9"><div class="empty">No contacts match these filters.</div></td></tr>`;
  document.querySelectorAll("[data-contact-id]").forEach((row) => {
    const open = () => openProspect(row.dataset.contactId);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => { if (event.key === "Enter") open(); });
  });
}

function openContacts() {
  contactsPage = 1;
  renderContacts();
  showView("contactsView");
}

function stageClass(stage) {
  return `stage-${String(stage || "").toLowerCase().replace(/[^a-z]+/g, "-")}`;
}

function openProspect(id) {
  currentProspectId = id;
  renderProspect();
  showView("prospectView");
}

function renderProspect() {
  const p = prospectById(currentProspectId);
  if (!p) return;

  const reminder = latestReminder(p);
  const timeline = [...(p.timeline || [])].sort((a, b) => new Date(b.at) - new Date(a.at));
  const quotes = [...(p.quotes || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const latestQuote = quotes[0];
  const manager = isManager();

  $("#prospectDetail").innerHTML = `
    <div class="prospect-header">
      <div class="prospect-header-grid">
        <div>
          <p class="eyebrow">PROSPECT</p>
          <h2>${escapeHtml(p.companyName)}</h2>
          <p class="contact-line"><strong>${escapeHtml(p.contactName || "No contact name")}</strong></p>
          <p class="contact-line">${escapeHtml(p.phone || "No phone number")}</p>
          <p class="contact-line">${escapeHtml(p.email || "No email")}</p>
          <p class="contact-line">${escapeHtml(p.address || "No address")}</p>
          <div class="record-meta"><span class="badge ${stageClass(p.stage)}">${escapeHtml(p.stage)}</span><span class="badge">Owner: ${escapeHtml(p.owner)}</span><span class="badge">Value: ${formatMoney(p.estimatedValue)}</span></div>
        </div>
        <div class="owner-control">
          <span class="badge">${p.customerId ? "Customer" : "Prospect"}</span>
          ${manager ? `<label for="accountOwnerSelect">Account Owner</label><select id="accountOwnerSelect"><option value="Greg" ${p.owner === "Greg" ? "selected" : ""}>Greg</option><option value="Craig" ${p.owner === "Craig" ? "selected" : ""}>Craig</option><option value="Rep 1" ${p.owner === "Rep 1" ? "selected" : ""}>Rep 1</option></select>` : `<span class="badge">Owner: ${escapeHtml(p.owner)}</span>`}
        </div>
      </div>

      <div class="action-grid">
        <a class="btn btn-secondary" href="${p.phone ? `tel:${encodeURIComponent(p.phone)}` : "#"}">Call</a>
        <a class="btn btn-secondary ${p.email ? "" : "disabled"}" href="${p.email ? `mailto:${encodeURIComponent(p.email)}?subject=${encodeURIComponent(`Quote from Bargain Moulding for ${p.companyName}`)}` : "#"}" ${p.email ? "" : 'aria-disabled="true"'}>Email</a>
        <button class="btn btn-secondary" id="addNoteBtn">Add Note</button>
        <button class="btn btn-primary" id="buildQuoteBtn">Build Quote</button>
        <button class="btn btn-secondary" id="editProspectBtn">Edit</button>
        ${manager ? `<button class="btn btn-danger" id="deleteProspectBtn">Delete</button>` : ""}
      </div>

      ${reminder ? `
        <div class="info-strip">
          <strong>Next Follow-Up:</strong> ${escapeHtml(reminder.date)} — ${escapeHtml(reminder.note || "Follow up")}
          <button class="btn btn-small btn-secondary" id="completeReminderBtn">Done</button>
        </div>` : ""}

      ${latestQuote ? `
        <div class="info-strip">
          <strong>Latest Quote:</strong> ${escapeHtml(latestQuote.shopifyDraftOrderName || latestQuote.number)} — ${formatMoney(latestQuote.total)}
          ${latestQuote.invoiceUrl ? `<a class="btn btn-small btn-secondary" href="${escapeHtml(latestQuote.invoiceUrl)}" target="_blank" rel="noopener">Open invoice</a>` : ""}
        </div>` : ""}
    </div>

    <div class="section-heading"><h3>Saved Quotes</h3></div>
    <div class="card-list">
      ${quotes.length ? quotes.map((quote) => `<article class="timeline-item"><div class="timeline-meta">${escapeHtml(quote.number)} · ${escapeHtml(quote.status)} · ${formatMoney(quote.total)}</div><div class="button-row"><button class="btn btn-small btn-secondary" data-reopen-quote="${quote.id}">Reopen</button>${manager && quote.status !== "converted" ? `<button class="btn btn-small btn-primary" data-convert-quote="${quote.id}">Convert to Shopify</button>` : ""}${manager ? `<button class="btn btn-small btn-danger" data-delete-quote="${quote.id}">Delete Quote</button>` : ""}</div></article>`).join("") : `<div class="empty">No saved quotes yet.</div>`}
    </div>

    <div class="section-heading">
      <h3>Activity</h3>
    </div>
    <div class="timeline">
      ${timeline.length ? timeline.map(item => `
        <article class="timeline-item">
          <div class="timeline-meta">${formatDateTime(item.at)} · ${escapeHtml(item.user || "User")}</div>
          <div class="timeline-text">${escapeHtml(item.text)}</div>
        </article>`).join("") : `<div class="empty">No activity yet.</div>`}
    </div>
  `;

  $("#addNoteBtn").addEventListener("click", () => $("#noteDialog").showModal());
  $("#buildQuoteBtn").addEventListener("click", startQuote);
  $("#editProspectBtn").addEventListener("click", openEditDialog);
  if ($("#deleteProspectBtn")) $("#deleteProspectBtn").addEventListener("click", deleteCurrentProspect);
  if ($("#accountOwnerSelect")) $("#accountOwnerSelect").addEventListener("change", (event) => updateAccountOwner(event.target.value));

  if ($("#completeReminderBtn")) {
    $("#completeReminderBtn").addEventListener("click", async () => {
      await crmAction("completeReminder", { id: reminder.id });
      reminder.completed = true;
      p.timeline.push({
        id: uid("activity"),
        at: nowIso(),
        user: currentUserName(),
        text: "Completed follow-up reminder."
      });
      saveState();
      renderProspect();
    });
  }
  document.querySelectorAll("[data-reopen-quote]").forEach((btn) => btn.addEventListener("click", () => startQuote(btn.dataset.reopenQuote)));
  document.querySelectorAll("[data-convert-quote]").forEach((btn) => btn.addEventListener("click", () => convertQuoteToShopify(btn.dataset.convertQuote)));
  document.querySelectorAll("[data-delete-quote]").forEach((btn) => btn.addEventListener("click", () => deleteQuote(btn.dataset.deleteQuote)));
}

async function deleteCurrentProspect() {
  const p = prospectById(currentProspectId);
  const typed = prompt(`This permanently deletes ${p.companyName} and every attached note, reminder, and CRM quote.\n\nType the company name exactly to confirm:`);
  if (typed !== p.companyName) {
    if (typed !== null) alert("Company name did not match. Nothing was deleted.");
    return;
  }
  await crmAction("deleteProspect", { id: p.id });
  currentProspectId = null;
  await refreshCrm();
  showView("homeView");
}

async function updateAccountOwner(owner) {
  const p = prospectById(currentProspectId);
  if (!p || owner === p.owner) return;
  const oldOwner = p.owner;
  const select = $("#accountOwnerSelect");
  select.disabled = true;
  try {
    await crmAction("updateOwner", { id: p.id, owner, oldOwner, user: currentUserName() });
    await refreshCrm(p.id);
  } catch (error) {
    select.value = oldOwner;
    select.disabled = false;
    alert(`Owner was not changed: ${error.message}`);
  }
}

function openEditDialog() {
  const p = prospectById(currentProspectId);
  const form = $("#editForm");
  ["companyName", "contactName", "phone", "email", "address", "stage", "estimatedValue", "owner"].forEach((name) => {
    form.elements[name].value = p[name] ?? "";
  });
  form.elements.owner.disabled = !isManager();
  $("#editDialog").showModal();
}

function startQuote(quoteId = null) {
  const quote = quoteId ? prospectById(currentProspectId).quotes.find((q) => q.id === quoteId) : null;
  draftQuoteLines = quote ? quote.lines.map((line) => ({ ...line })) : [];
  const p = prospectById(currentProspectId);
  $("#quoteProspectName").textContent = p.companyName;
  $("#productSearch").value = "";
  selectedShopifyCollectionId = "";
  loadShopifyCollections();
  renderProductResults("");
  renderQuoteLines();
  showView("quoteView");
}

async function loadShopifyCollections() {
  const container = $("#shopifyCollections");
  container.innerHTML = `<button class="collection-button active" type="button" data-collection-id="">All Products</button>`;
  try {
    const response = await crmFetch("/api/products?mode=collections");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not load Shopify collections.");
    shopifyCollections = body.collections || [];
    $("#collectionStatus").textContent = `${shopifyCollections.length} quoting categor${shopifyCollections.length === 1 ? "y" : "ies"}`;
    container.innerHTML = [`<button class="collection-button active" type="button" data-collection-id="">All Products</button>`, ...shopifyCollections.map((collection) => `<button class="collection-button" type="button" data-collection-id="${escapeHtml(collection.id)}">${escapeHtml(collection.title)}</button>`)].join("");
  } catch (error) {
    shopifyCollections = [];
    $("#collectionStatus").textContent = error.message;
  }
  container.querySelectorAll("[data-collection-id]").forEach((button) => button.addEventListener("click", () => {
    selectedShopifyCollectionId = button.dataset.collectionId;
    container.querySelectorAll(".collection-button").forEach((item) => item.classList.toggle("active", item === button));
    renderProductResults($("#productSearch").value);
  }));
}

async function renderProductResults(query) {
  $("#productResults").innerHTML = `<div class="empty">Loading Shopify products…</div>`;
  $("#shopifyStatus").textContent = "Connecting to live Shopify catalog…";
  $("#shopifyStatus").classList.remove("error");
  let products = [];
  try {
    const params = new URLSearchParams({ search: query.trim() });
    if (selectedShopifyCollectionId) params.set("collection", selectedShopifyCollectionId);
    const response = await crmFetch(`/api/products?${params}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Product search failed.");
    products = body.products || [];
    const selectedCollection = shopifyCollections.find((collection) => collection.id === selectedShopifyCollectionId);
    $("#shopifyStatus").textContent = `${products.length} live Shopify variants found${selectedCollection ? ` in ${selectedCollection.title}` : ""}`;
  } catch (error) {
    $("#shopifyStatus").textContent = error.message;
    $("#shopifyStatus").classList.add("error");
    $("#productResults").innerHTML = `<div class="empty">Shopify is not connected yet. Add the Vercel environment variables, then redeploy.</div>`;
    return;
  }

  $("#productResults").innerHTML = products.length ? products.map((product) => `
    <div class="product-result">
      <div>
        <div class="product-name">${escapeHtml(product.title)} — ${escapeHtml(product.variant)}</div>
        <div class="product-meta">${escapeHtml(product.sku)} · ${formatMoney(product.price)} · ${product.inventoryQuantity ?? "?"} available</div>
      </div>
      <button class="btn btn-small btn-primary" data-add-product="${product.id}">Add</button>
    </div>
  `).join("") : `<div class="empty">No matching Shopify variants.</div>`;

  window.liveShopifyProducts = products;

  document.querySelectorAll("[data-add-product]").forEach((btn) => {
    btn.addEventListener("click", () => addProductToQuote(btn.dataset.addProduct));
  });
}

function addProductToQuote(productId) {
  const product = (window.liveShopifyProducts || []).find((p) => p.id === productId);
  if (!product) return;
  const existing = draftQuoteLines.find((line) => line.productId === productId);
  if (existing) {
    existing.qty += 1;
  } else {
    draftQuoteLines.push({
      id: uid("line"),
      productId: product.id,
      title: product.title,
      variant: product.variant,
      sku: product.sku,
      unitPrice: product.price,
      qty: 1,
    });
  }
  renderQuoteLines();
}

function renderQuoteLines() {
  $("#quoteLines").innerHTML = draftQuoteLines.length
    ? draftQuoteLines.map((line) => `
      <div class="quote-line">
        <div>
          <div class="product-name">${escapeHtml(line.title)} — ${escapeHtml(line.variant)}</div>
          <div class="product-meta">${escapeHtml(line.sku)} · ${formatMoney(line.unitPrice)} each</div>
        </div>
        <input type="number" min="1" step="1" value="${line.qty}" data-qty-line="${line.id}" aria-label="Quantity" />
        <div class="quote-price">${formatMoney(line.unitPrice * line.qty)}</div>
        <button class="btn btn-small btn-danger remove-line" data-remove-line="${line.id}">×</button>
      </div>
    `).join("")
    : `<div class="empty">No line items yet.</div>`;

  document.querySelectorAll("[data-qty-line]").forEach((input) => {
    input.addEventListener("change", () => {
      const line = draftQuoteLines.find((x) => x.id === input.dataset.qtyLine);
      line.qty = Math.max(1, Number(input.value) || 1);
      renderQuoteLines();
    });
  });

  document.querySelectorAll("[data-remove-line]").forEach((btn) => {
    btn.addEventListener("click", () => {
      draftQuoteLines = draftQuoteLines.filter((x) => x.id !== btn.dataset.removeLine);
      renderQuoteLines();
    });
  });

  const total = draftQuoteLines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  $("#quoteTotal").textContent = formatMoney(total);
}

function pdfText(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function shortenPdfText(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function createQuotePdf(prospect, quoteNumber, lines, total) {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 48;
  const pageStreams = [];
  const commands = [];
  let y = 0;

  const add = (command) => commands.push(command);
  const fill = (r, g, b) => add(`${r} ${g} ${b} rg`);
  const rect = (x, top, width, height, r, g, b) => {
    fill(r, g, b);
    add(`${x} ${pageHeight - top - height} ${width} ${height} re f`);
  };
  const text = (value, x, top, size = 10, bold = false, r = 0.1, g = 0.11, b = 0.12) => {
    fill(r, g, b);
    add(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${pageHeight - top} Td (${pdfText(value)}) Tj ET`);
  };
  const finishPage = () => {
    pageStreams.push(commands.splice(0).join("\n"));
  };
  const startPage = (continued = false) => {
    rect(0, 0, pageWidth, 78, 0.07, 0.07, 0.07);
    rect(margin, 24, 34, 34, 0.96, 0.77, 0.18);
    text("BM", margin + 7, 47, 13, true, 0.07, 0.07, 0.07);
    text("BARGAIN MOULDING", margin + 46, 41, 17, true, 1, 1, 1);
    text(continued ? `${quoteNumber} - CONTINUED` : "PROFESSIONAL QUOTE", 405, 42, 9, true, 0.96, 0.77, 0.18);
    y = 108;
  };
  const tableHeader = () => {
    rect(margin, y - 15, pageWidth - margin * 2, 25, 0.94, 0.95, 0.96);
    text("ITEM", margin + 8, y + 1, 9, true);
    text("QTY", 398, y + 1, 9, true);
    text("PRICE", 448, y + 1, 9, true);
    text("TOTAL", 515, y + 1, 9, true);
    y += 28;
  };

  startPage();
  text("QUOTE FOR", margin, y, 8, true, 0.42, 0.45, 0.48);
  text(shortenPdfText(prospect.companyName, 48), margin, y + 24, 17, true);
  text(shortenPdfText(prospect.contactName || "", 55), margin, y + 43, 10);
  text(shortenPdfText(prospect.email || "", 55), margin, y + 58, 10, false, 0.42, 0.45, 0.48);
  text(shortenPdfText(prospect.phone || "", 55), margin, y + 73, 10, false, 0.42, 0.45, 0.48);
  text("QUOTE NUMBER", 405, y, 8, true, 0.42, 0.45, 0.48);
  text(quoteNumber, 405, y + 22, 13, true);
  text("DATE", 405, y + 49, 8, true, 0.42, 0.45, 0.48);
  text(new Intl.DateTimeFormat("en-US").format(new Date()), 405, y + 68, 10, true);
  y += 118;
  tableHeader();

  lines.forEach((line, index) => {
    if (y > 665) {
      finishPage();
      startPage(true);
      tableHeader();
    }
    if (index % 2 === 1) rect(margin, y - 14, pageWidth - margin * 2, 34, 0.985, 0.985, 0.985);
    const itemName = `${line.title}${line.variant ? ` - ${line.variant}` : ""}`;
    text(shortenPdfText(itemName, 52), margin + 8, y, 9, true);
    text(shortenPdfText(line.sku ? `SKU: ${line.sku}` : "", 52), margin + 8, y + 13, 7, false, 0.42, 0.45, 0.48);
    text(String(line.qty), 402, y + 5, 9);
    text(formatMoney(line.unitPrice), 448, y + 5, 9);
    text(formatMoney(line.unitPrice * line.qty), 515, y + 5, 9, true);
    y += 36;
  });

  if (y > 620) {
    finishPage();
    startPage(true);
  }
  add(`0.82 0.84 0.86 RG 0.7 w ${margin} ${pageHeight - y + 8} m ${pageWidth - margin} ${pageHeight - y + 8} l S`);
  y += 22;
  text("QUOTE TOTAL", 390, y, 10, true);
  text(formatMoney(total), 490, y, 16, true);
  y += 48;
  rect(margin, y - 16, pageWidth - margin * 2, 64, 1, 0.97, 0.84);
  text("THANK YOU FOR THE OPPORTUNITY", margin + 14, y + 4, 10, true);
  text("Pricing is valid for 30 days and subject to product availability.", margin + 14, y + 23, 9);
  text("Reply to your email to approve this quote or request changes.", margin + 14, y + 38, 9);
  text("bargainmoulding.com", margin, 744, 9, true, 0.42, 0.45, 0.48);
  text(`Page ${pageStreams.length + 1}`, 510, 744, 9, false, 0.42, 0.45, 0.48);
  finishPage();

  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = addObject("");
  const pagesId = addObject("");
  const regularFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const boldFontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds = [];
  pageStreams.forEach((stream) => {
    const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

function downloadQuotePdf(prospect, quoteNumber, lines, total) {
  const url = URL.createObjectURL(createQuotePdf(prospect, quoteNumber, lines, total));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${quoteNumber}-${String(prospect.companyName || "customer").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function saveQuote(emailAfterSave = false) {
  if (!draftQuoteLines.length) {
    alert("Add at least one product.");
    return;
  }

  const p = prospectById(currentProspectId);
  if (emailAfterSave && !p.email) {
    alert("Add an email address to this prospect before emailing the quote.");
    return;
  }
  const total = draftQuoteLines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  const quoteNumber = `Q-${String(Date.now()).slice(-6)}`;
  const saveButton = $("#saveQuoteBtn");
  saveButton.disabled = true;
  $("#emailQuoteBtn").disabled = true;
  saveButton.textContent = "Saving in CRM…";
  try {
    await crmAction("saveQuote", { prospectId: p.id, quoteNumber, lines: draftQuoteLines, createdBy: currentUserName() });
  } catch (error) {
    alert(`Quote was not saved: ${error.message}`);
    saveButton.disabled = false;
    $("#emailQuoteBtn").disabled = false;
    saveButton.textContent = "Save Draft in CRM";
    return;
  }
  const quote = {
    id: uid("quote"),
    number: quoteNumber,
    createdAt: nowIso(),
    status: "Draft",
    lines: draftQuoteLines.map((x) => ({ ...x })),
    total,
  };

  p.quotes = p.quotes || [];
  p.quotes.push(quote);
  if (!["Won", "Lost"].includes(p.stage)) p.stage = "Quoting";
  p.estimatedValue = Math.max(Number(p.estimatedValue || 0), total);
  p.timeline.push({
    id: uid("activity"),
    at: nowIso(),
    user: currentUserName(),
    text: `Saved CRM Quote ${quoteNumber} — ${formatMoney(total)}`
  });

  saveState();
  renderProspect();
  showView("prospectView");
  saveButton.disabled = false;
  $("#emailQuoteBtn").disabled = false;
  saveButton.textContent = "Save Draft in CRM";
  await refreshCrm(p.id);
  if (emailAfterSave) {
    const itemLines = draftQuoteLines.map((line) => `${line.qty} × ${line.title}${line.variant ? ` — ${line.variant}` : ""} @ ${formatMoney(line.unitPrice)} = ${formatMoney(line.unitPrice * line.qty)}`);
    const subject = `Bargain Moulding Quote ${quoteNumber} — ${p.companyName}`;
    const body = [`Hi ${p.contactName || p.companyName},`, "", `Please find your Bargain Moulding quote ${quoteNumber} attached.`, "", ...itemLines, "", `Total: ${formatMoney(total)}`, "", "Please reply to this email with any questions or requested changes.", "", "Bargain Moulding"].join("\n");
    downloadQuotePdf(p, quoteNumber, draftQuoteLines, total);
    alert("Your branded quote PDF was downloaded. Attach that PDF to the Gmail draft before sending.");
    const gmailUrl = new URL("https://mail.google.com/mail/");
    gmailUrl.searchParams.set("view", "cm");
    gmailUrl.searchParams.set("fs", "1");
    gmailUrl.searchParams.set("to", p.email);
    gmailUrl.searchParams.set("su", subject);
    gmailUrl.searchParams.set("body", body);
    window.location.assign(gmailUrl.toString());
  }
}

async function convertQuoteToShopify(quoteId) {
  const p = prospectById(currentProspectId);
  const quote = p.quotes.find((q) => q.id === quoteId);
  if (!quote || !confirm(`Create a real Shopify Draft Order from ${quote.number}?`)) return;
  const response = await crmFetch("/api/draft-orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prospect: p, lines: quote.lines }) });
  const body = await response.json();
  if (!response.ok) return alert(body.error || "Shopify conversion failed.");
  await crmAction("markQuoteConverted", { quoteId, shopifyDraftOrderId: body.draftOrder.id, shopifyDraftOrderName: body.draftOrder.name, invoiceUrl: body.draftOrder.invoiceUrl });
  await refreshCrm(p.id);
}

async function deleteQuote(quoteId) {
  const p = prospectById(currentProspectId);
  const quote = p.quotes.find((item) => item.id === quoteId);
  if (!quote) return;
  const shopifyNote = quote.status === "converted" ? "\n\nThe Shopify draft order will NOT be deleted." : "";
  if (!confirm(`Permanently delete CRM quote ${quote.number}?${shopifyNote}`)) return;
  await crmAction("deleteQuote", { quoteId, user: currentUserName() });
  await refreshCrm(p.id);
}

function convertToCustomer() {
  const p = prospectById(currentProspectId);
  if (p.customerId) return;

  const confirmed = confirm(
    "This demo will mark the prospect as a customer. In production, this button will call Shopify and create or match the customer record."
  );
  if (!confirmed) return;

  p.customerId = `shopify_demo_${Date.now()}`;
  p.stage = "Won";
  p.timeline.push({
    id: uid("activity"),
    at: nowIso(),
    user: currentUserName(),
    text: "Converted prospect to customer."
  });
  saveState();
  renderProspect();
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(title, message = "", tone = "success") {
  const region = $("#toastRegion");
  const toast = document.createElement("div");
  toast.className = `app-toast toast-${tone}`;
  toast.innerHTML = `<span class="toast-icon">${tone === "success" ? "✓" : tone === "warning" ? "!" : "i"}</span><div><strong>${escapeHtml(title)}</strong>${message ? `<p>${escapeHtml(message)}</p>` : ""}</div><button type="button" aria-label="Dismiss notification">×</button>`;
  toast.querySelector("button").addEventListener("click", () => toast.remove());
  region.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => { toast.classList.remove("visible"); setTimeout(() => toast.remove(), 220); }, 6500);
}

async function emailTemplateAction(action, data = {}) {
  const response = await crmFetch("/api/email-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Email template update failed.");
  return body;
}

function bulkEmailAudience() {
  const stage = $("#bulkEmailStage").value;
  const owner = $("#bulkEmailOwner").value;
  const seen = new Set();
  return state.prospects.filter((prospect) => {
    const email = String(prospect.email || "").trim().toLowerCase();
    if (!email || seen.has(email) || (stage && prospect.stage !== stage) || (owner && prospect.owner !== owner)) return false;
    seen.add(email);
    return true;
  });
}

function updateBulkEmailAudience() {
  const audience = bulkEmailAudience();
  $("#bulkRecipientSummary").textContent = `${audience.length} recipient${audience.length === 1 ? "" : "s"} with valid email addresses`;
  $("#bulkRecipientPreview").textContent = audience.length ? audience.map((prospect) => `${prospect.companyName} <${prospect.email}>`).join(" · ") : "No matching customers or prospects have an email address.";
}

function clearEmailTemplate() {
  editingEmailTemplateId = null;
  $("#emailTemplateName").value = "";
  $("#emailTemplateSubject").value = "";
  $("#emailTemplateBody").value = "";
  $("#emailTemplateImageUrl").value = "";
  $("#emailTemplateImageLink").value = "";
  $("#emailTemplateImageAlt").value = "";
  renderEmailImagePreview();
  $("#saveEmailTemplateBtn").textContent = "Save Template";
}

function renderEmailImagePreview() {
  const preview = $("#emailImagePreview");
  const imageUrl = $("#emailTemplateImageUrl").value.trim();
  const imageLinkUrl = $("#emailTemplateImageLink").value.trim();
  const imageAlt = $("#emailTemplateImageAlt").value.trim();
  preview.replaceChildren();
  preview.hidden = !imageUrl;
  if (!imageUrl) return;
  const image = document.createElement("img");
  image.src = imageUrl;
  image.alt = imageAlt;
  image.addEventListener("error", () => { preview.textContent = "Image preview could not be loaded. Check the image URL."; });
  if (imageLinkUrl) {
    const link = document.createElement("a");
    link.href = imageLinkUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.appendChild(image);
    preview.appendChild(link);
  } else {
    preview.appendChild(image);
  }
}

function renderEmailTemplates() {
  $("#savedEmailTemplates").innerHTML = emailTemplates.length ? emailTemplates.map((template) => `
    <article class="saved-template-card">
      <strong>${escapeHtml(template.name)}</strong>
      <div class="card-meta">${escapeHtml(template.subject)}</div>
      ${template.image_url ? `<div class="card-meta">Includes clickable image</div>` : ""}
      <div class="button-row">
        <button class="btn btn-small btn-secondary" type="button" data-load-email-template="${template.id}">Load</button>
        <button class="btn btn-small btn-danger" type="button" data-delete-email-template="${template.id}">Delete</button>
      </div>
    </article>`).join("") : `<div class="empty">No templates yet.</div>`;
  document.querySelectorAll("[data-load-email-template]").forEach((button) => button.addEventListener("click", () => {
    const template = emailTemplates.find((item) => item.id === button.dataset.loadEmailTemplate);
    if (!template) return;
    editingEmailTemplateId = template.id;
    $("#emailTemplateName").value = template.name;
    $("#emailTemplateSubject").value = template.subject;
    $("#emailTemplateBody").value = template.body;
    $("#emailTemplateImageUrl").value = template.image_url || "";
    $("#emailTemplateImageLink").value = template.image_link_url || "";
    $("#emailTemplateImageAlt").value = template.image_alt || "";
    renderEmailImagePreview();
    $("#saveEmailTemplateBtn").textContent = "Update Template";
  }));
  document.querySelectorAll("[data-delete-email-template]").forEach((button) => button.addEventListener("click", async () => {
    const template = emailTemplates.find((item) => item.id === button.dataset.deleteEmailTemplate);
    if (!template || !confirm(`Delete email template “${template.name}”?`)) return;
    await emailTemplateAction("delete", { id: template.id });
    if (editingEmailTemplateId === template.id) clearEmailTemplate();
    await loadEmailTemplates();
  }));
}

async function loadEmailTemplates() {
  const response = await crmFetch("/api/email-templates");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load email templates.");
  emailTemplates = body.templates || [];
  renderEmailTemplates();
}

async function openBulkEmail() {
  if (!isManager()) return alert("Manager access required.");
  updateBulkEmailAudience();
  showView("bulkEmailView");
  try {
    await Promise.all([loadEmailTemplates(), loadGoogleConnection(), loadEmailAnalytics()]);
  } catch (error) {
    alert(error.message);
  }
}

async function loadEmailAnalytics() {
  const response = await crmFetch("/api/email-analytics");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load email results.");
  const summary = body.summary || { sent: 0, opened: 0, clicked: 0, unsubscribed: 0 };
  const campaigns = (body.campaigns || []).slice(0, 10);
  homeEmailMessages = body.messages || homeEmailMessages;
  renderHomeActivity();
  $("#emailAnalytics").innerHTML = `<div class="recipient-summary">${summary.sent} sent · ${summary.opened} opened · ${summary.clicked} clicked · ${summary.unsubscribed || 0} unsubscribed</div>${campaigns.length ? campaigns.map((campaign) => `<article class="saved-template-card"><strong>${escapeHtml(campaign.name)}</strong><div class="card-meta">${escapeHtml(campaign.subject)} · ${escapeHtml(campaign.status)}</div><div class="card-meta">${campaign.sent} sent · ${campaign.failed} failed · ${campaign.opened} opened · ${campaign.clicked} clicked</div></article>`).join("") : `<div class="empty">No campaigns yet.</div>`}`;
  renderCampaignDashboard(summary, body.campaigns || []);
  return body;
}

function campaignRate(value, sent) {
  return sent ? Math.round((Number(value || 0) / sent) * 100) : 0;
}

function renderCampaignDashboard(summary, campaigns) {
  $("#campaignSentTotal").textContent = Number(summary.sent || 0).toLocaleString();
  $("#campaignOpenRate").textContent = `${campaignRate(summary.opened, summary.sent)}%`;
  $("#campaignClickRate").textContent = `${campaignRate(summary.clicked, summary.sent)}%`;
  $("#campaignOpenedTotal").textContent = `${Number(summary.opened || 0).toLocaleString()} opens`;
  $("#campaignClickedTotal").textContent = `${Number(summary.clicked || 0).toLocaleString()} clicks`;
  $("#campaignUnsubscribedTotal").textContent = Number(summary.unsubscribed || 0).toLocaleString();
  $("#campaignDashboardStatus").textContent = `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} for ${currentUserName()}`;
  $("#campaignDashboardBody").innerHTML = campaigns.length ? campaigns.map((campaign) => `
    <tr><td><strong>${escapeHtml(campaign.name)}</strong><div class="card-meta">${escapeHtml(campaign.subject)}</div></td>
    <td><span class="badge">${escapeHtml(String(campaign.status || "").replaceAll("_", " "))}</span></td><td>${campaign.sent}</td><td>${campaign.failed}</td><td>${campaign.opened}</td><td><strong>${campaignRate(campaign.opened, campaign.sent)}%</strong></td><td>${campaign.clicked}</td><td><strong>${campaignRate(campaign.clicked, campaign.sent)}%</strong></td><td>${campaign.completed_at ? formatDateTime(campaign.completed_at) : "In progress"}</td></tr>`).join("") : `<tr><td colspan="9"><div class="empty">No campaigns yet. Create your first campaign to start tracking performance.</div></td></tr>`;
}

async function openCampaignDashboard() {
  if (!isManager()) return alert("Manager access required.");
  showView("campaignsView");
  $("#campaignDashboardStatus").textContent = "Loading campaign results…";
  try { await loadEmailAnalytics(); } catch (error) { $("#campaignDashboardStatus").textContent = error.message; }
}

function initials(name) {
  return String(name || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function renderTeamSnapshot() {
  const active = teamSnapshot.filter((member) => member.active);
  $("#teamActiveCount").textContent = active.length;
  $("#teamOpenTasks").textContent = active.reduce((sum, member) => sum + member.openTasks, 0);
  $("#teamOverdueTasks").textContent = active.reduce((sum, member) => sum + member.overdueTasks, 0);
  $("#teamEmailsSent").textContent = active.reduce((sum, member) => sum + member.emails30, 0);
  $("#teamCards").innerHTML = teamSnapshot.length ? teamSnapshot.map((member) => `
    <article class="team-member-card ${member.active ? "" : "inactive"}">
      <div class="team-member-top"><div class="team-identity"><span class="team-avatar">${escapeHtml(initials(member.name))}</span><div><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.email)}</small><small>${member.lastActivityAt ? `Last active ${escapeHtml(formatDateTime(member.lastActivityAt))}` : "No activity yet"}</small></div></div><span class="badge">${member.active ? "Active" : "Inactive"}</span></div>
      <div class="team-metrics"><div class="team-metric"><strong>${member.contactsOwned}</strong><span>Contacts</span></div><div class="team-metric"><strong>${member.openTasks}</strong><span>Open tasks</span></div><div class="team-metric"><strong>${member.completedTasks30}</strong><span>Completed</span></div><div class="team-metric"><strong>${member.activities30}</strong><span>Activities</span></div><div class="team-metric"><strong>${member.quotes30}</strong><span>Quotes</span></div><div class="team-metric"><strong>${member.emails30}</strong><span>Emails</span></div><div class="team-metric"><strong>${member.overdueTasks}</strong><span>Overdue</span></div><div class="team-metric"><strong>${member.last_login_at ? "Yes" : "No"}</strong><span>Logged in</span></div></div>
      <div class="team-member-footer"><div class="team-connection"><span class="badge">${member.googleConnected ? "Google ✓" : "Google —"}</span><span class="badge">${member.calendarConnected ? "Calendar ✓" : "Calendar —"}</span></div><div class="team-controls"><select data-team-role="${member.id}" aria-label="Role for ${escapeHtml(member.name)}"><option value="sales_rep"${member.role === "sales_rep" ? " selected" : ""}>Salesperson</option><option value="manager"${member.role === "manager" ? " selected" : ""}>Manager</option></select><button class="btn btn-small ${member.active ? "btn-danger" : "btn-secondary"}" data-team-active="${member.id}" data-active="${member.active}" type="button">${member.active ? "Deactivate" : "Reactivate"}</button></div></div>
    </article>`).join("") : `<div class="empty">No CRM users yet.</div>`;
  document.querySelectorAll("[data-team-role]").forEach((select) => select.addEventListener("change", async () => { try { const member = teamSnapshot.find((item) => item.id === select.dataset.teamRole); await crmAction("updateUser", { id: member.id, role: select.value, active: member.active }); await refreshCrm(); renderTeamSnapshot(); } catch (error) { alert(error.message); } }));
  document.querySelectorAll("[data-team-active]").forEach((button) => button.addEventListener("click", async () => { const member = teamSnapshot.find((item) => item.id === button.dataset.teamActive); if (member.active && !confirm(`Deactivate ${member.name}? They will immediately lose CRM access.`)) return; try { await crmAction("updateUser", { id: member.id, role: member.role, active: !member.active }); await refreshCrm(); renderTeamSnapshot(); } catch (error) { alert(error.message); } }));
}

function openTeamDashboard() {
  if (!isManager()) return;
  renderTeamSnapshot();
  showView("teamView");
}

async function sendTrackedEmail() {
  const audience = bulkEmailAudience();
  const campaignName = $("#emailCampaignName").value.trim();
  const subject = $("#emailTemplateSubject").value.trim();
  const body = $("#emailTemplateBody").value.trim();
  const imageUrl = $("#emailTemplateImageUrl").value.trim();
  const imageLinkUrl = $("#emailTemplateImageLink").value.trim();
  const imageAlt = $("#emailTemplateImageAlt").value.trim();
  if (!audience.length) return alert("Choose at least one recipient.");
  if (audience.length > 25) return alert("Campaigns are limited to 25 recipients during beta. Narrow the audience first.");
  if (!subject || !body) return alert("Add a subject and message first.");
  const recipientList = audience.map((recipient) => `${recipient.contactName || recipient.companyName} <${recipient.email}>`).join("\n");
  if (!confirm(`Send this real tracked campaign now?\n\nCampaign: ${campaignName || subject}\nSubject: ${subject}${imageUrl ? "\nImage: included" : ""}\nRecipients (${audience.length}):\n${recipientList}\n\nEach recipient receives a separate email.`)) return;
  const button = $("#sendTrackedEmailBtn");
  button.disabled = true;
  try {
    const response = await crmFetch("/api/email-send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignName: campaignName || subject, recipients: audience.map((recipient) => ({ email: recipient.email, name: recipient.contactName || recipient.companyName })), subject, body, imageUrl, imageLinkUrl, imageAlt }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Email send failed.");
    alert(`Campaign complete: ${result.sent} sent, ${result.failed} failed, ${result.skippedUnsubscribed} skipped because they unsubscribed.`);
    await loadEmailAnalytics();
  } catch (error) { alert(error.message); } finally { button.disabled = false; }
}

async function loadGoogleConnection() {
  const response = await crmFetch("/api/gmail");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not check Google connection.");
  const status = body.calendarConnected ? `Google Calendar connected: ${body.email}` : body.connected ? "Reconnect Google to enable Calendar" : `Google not connected: ${body.email}`;
  $("#agendaGoogleStatus").textContent = status;
  $("#agendaConnectGoogleBtn").textContent = body.calendarConnected ? "Reconnect Google" : "Connect Google";
  $("#gmailConnectionStatus").textContent = body.connected ? `Google connected: ${body.email}` : `Not connected: ${body.email}`;
  $("#connectGmailBtn").textContent = body.connected ? "Reconnect Google" : "Connect Google";
}

async function connectGoogle(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const response = await crmFetch("/api/auth/google/start");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not start Google authorization.");
    window.location.assign(body.url);
  } catch (error) {
    alert(error.message);
    button.disabled = false;
  }
}

async function saveEmailTemplate() {
  const name = $("#emailTemplateName").value.trim();
  const subject = $("#emailTemplateSubject").value.trim();
  const body = $("#emailTemplateBody").value.trim();
  const imageUrl = $("#emailTemplateImageUrl").value.trim();
  const imageLinkUrl = $("#emailTemplateImageLink").value.trim();
  const imageAlt = $("#emailTemplateImageAlt").value.trim();
  if (!name || !subject || !body) return alert("Add a template name, subject, and message.");
  const button = $("#saveEmailTemplateBtn");
  button.disabled = true;
  try {
    const result = await emailTemplateAction("save", { id: editingEmailTemplateId, name, subject, body, imageUrl, imageLinkUrl, imageAlt });
    editingEmailTemplateId = result.template.id;
    button.textContent = "Update Template";
    await loadEmailTemplates();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
  }
}

function prepareBulkEmail() {
  const audience = bulkEmailAudience();
  const subject = $("#emailTemplateSubject").value.trim();
  const body = $("#emailTemplateBody").value.trim();
  if (!audience.length) return alert("Choose an audience with at least one valid email address.");
  if (audience.length > 75) return alert("Choose a narrower audience of 75 recipients or fewer for one Gmail draft.");
  if (!subject || !body) return alert("Add an email subject and message first.");
  const gmailUrl = new URL("https://mail.google.com/mail/");
  gmailUrl.searchParams.set("view", "cm");
  gmailUrl.searchParams.set("fs", "1");
  gmailUrl.searchParams.set("bcc", audience.map((prospect) => prospect.email.trim()).join(","));
  gmailUrl.searchParams.set("su", subject);
  gmailUrl.searchParams.set("body", body);
  window.location.assign(gmailUrl.toString());
}

$("#newProspectBtn").addEventListener("click", () => {
  const form = $("#prospectForm");
  form.reset();
  const saveButton = form.querySelector('[type="submit"]');
  saveButton.disabled = prospectSaveInFlight;
  saveButton.toggleAttribute("aria-busy", prospectSaveInFlight);
  saveButton.textContent = prospectSaveInFlight ? "Saving Prospect…" : "Save Prospect";
  form.elements.owner.disabled = !isManager();
  form.elements.owner.value = currentUserName();
  $("#prospectDialog").showModal();
});
$("#switchUserBtn").addEventListener("click", async () => {
  await fetch("/api/auth/google/start?logout=1", { credentials: "same-origin" }).catch(() => {});
  sessionStorage.removeItem("bargainCrmAccessCode");
  showLogin();
});
$("#googleLoginBtn").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  $("#loginError").textContent = "";
  try {
    const response = await fetch("/api/auth/google/start?mode=login", { credentials: "same-origin" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Could not start Google sign-in.");
    window.location.assign(body.url);
  } catch (error) { $("#loginError").textContent = error.message; button.disabled = false; }
});
$("#showPasscodeBtn").addEventListener("click", () => { $("#passcodeLoginForm").hidden = false; $("#showPasscodeBtn").hidden = true; });
$("#passcodeLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const passcode = new FormData(event.currentTarget).get("passcode");
  sessionStorage.setItem("bargainCrmAccessCode", String(passcode || ""));
  try { await refreshCrm(); } catch (error) { sessionStorage.removeItem("bargainCrmAccessCode"); showLogin(error.message); }
});
$("#contactsBtn").addEventListener("click", openContacts);
$("#teamBtn").addEventListener("click", openTeamDashboard);
$("#addTeamMemberBtn").addEventListener("click", () => { $("#teamMemberForm").reset(); $("#teamMemberDialog").showModal(); });
$("#activityTypeFilter").addEventListener("change", renderHomeActivity);
$("#createTaskBtn").addEventListener("click", () => {
  const form = $("#taskForm");
  form.reset();
  form.elements.dueDate.value = dateKey();
  form.elements.assignedTo.value = currentUserName();
  form.elements.assignedTo.disabled = !isManager();
  form.elements.prospectId.innerHTML = `<option value="">No associated contact</option>${[...state.prospects].sort((a, b) => a.companyName.localeCompare(b.companyName)).map((prospect) => `<option value="${prospect.id}">${escapeHtml(prospect.companyName)}${prospect.contactName ? ` — ${escapeHtml(prospect.contactName)}` : ""}</option>`).join("")}`;
  $("#taskDialog").showModal();
});
document.querySelectorAll("[data-agenda-view]").forEach((button) => button.addEventListener("click", () => {
  agendaView = button.dataset.agendaView;
  document.querySelectorAll("[data-agenda-view]").forEach((item) => item.classList.toggle("active", item === button));
  renderAgenda();
}));
$("#agendaSearch").addEventListener("input", renderAgenda);
$("#agendaAssignee").addEventListener("change", renderAgenda);
$("#agendaType").addEventListener("change", renderAgenda);
$("#agendaShowCompleted").addEventListener("change", renderAgenda);
$("#campaignsBtn").addEventListener("click", openCampaignDashboard);
$("#refreshCampaignsBtn").addEventListener("click", openCampaignDashboard);
$("#newCampaignBtn").addEventListener("click", openBulkEmail);
$("#contactsNewBtn").addEventListener("click", () => $("#newProspectBtn").click());
$("#contactsSearch").addEventListener("input", () => { contactsPage = 1; renderContacts(); });
$("#contactsStage").addEventListener("change", () => { contactsPage = 1; renderContacts(); });
$("#contactsOwner").addEventListener("change", () => { contactsPage = 1; renderContacts(); });
$("#contactsSort").addEventListener("change", () => { contactsPage = 1; renderContacts(); });
$("#contactsClearFilters").addEventListener("click", () => {
  $("#contactsSearch").value = ""; $("#contactsStage").value = ""; $("#contactsOwner").value = ""; $("#contactsSort").value = "lastActivity:desc"; contactsMineOnly = false; contactsPage = 1; $("#allContactsTab").classList.add("active"); $("#myContactsTab").classList.remove("active"); renderContacts();
});
$("#myContactsTab").addEventListener("click", (event) => {
  contactsMineOnly = true;
  event.currentTarget.classList.add("active");
  $("#allContactsTab").classList.remove("active");
  contactsPage = 1;
  renderContacts();
});
$("#allContactsTab").addEventListener("click", (event) => {
  contactsMineOnly = false;
  event.currentTarget.classList.add("active");
  $("#myContactsTab").classList.remove("active");
  contactsPage = 1;
  renderContacts();
});
$("#contactsPrev").addEventListener("click", () => { contactsPage = Math.max(1, contactsPage - 1); renderContacts(); });
$("#contactsNext").addEventListener("click", () => { contactsPage += 1; renderContacts(); });
$("#bulkEmailBtn").addEventListener("click", openBulkEmail);
$("#importProspectsBtn").addEventListener("click", () => {
  $("#importForm").reset();
  $("#importForm").elements.owner.value = currentUserName();
  $("#importStatus").className = "import-status";
  $("#importStatus").textContent = "";
  $("#importDialog").showModal();
});
$("#searchInput").addEventListener("input", renderHome);
$("#stageFilter").addEventListener("change", renderHome);
$("#exportBtn").addEventListener("click", exportCsv);
$("#bulkEmailStage").addEventListener("change", updateBulkEmailAudience);
$("#bulkEmailOwner").addEventListener("change", updateBulkEmailAudience);
[$("#emailTemplateImageUrl"), $("#emailTemplateImageLink"), $("#emailTemplateImageAlt")].forEach((input) => input.addEventListener("input", renderEmailImagePreview));
$("#saveEmailTemplateBtn").addEventListener("click", saveEmailTemplate);
$("#clearEmailTemplateBtn").addEventListener("click", clearEmailTemplate);
$("#prepareBulkEmailBtn").addEventListener("click", prepareBulkEmail);
$("#sendTrackedEmailBtn").addEventListener("click", sendTrackedEmail);
$("#connectGmailBtn").addEventListener("click", connectGoogle);
$("#agendaConnectGoogleBtn").addEventListener("click", connectGoogle);

const gmailResult = new URLSearchParams(window.location.search);
if (gmailResult.get("gmail") === "connected") {
  if (gmailResult.get("login") === "connected") showToast("Signed in with Google", "Your Gmail and Calendar are connected too.");
  else showToast("Google connected", "Gmail and Calendar are ready.");
  history.replaceState({}, "", window.location.pathname);
} else if (gmailResult.get("gmail") === "error") {
  alert(gmailResult.get("message") || "Gmail connection failed.");
  history.replaceState({}, "", window.location.pathname);
}

document.querySelectorAll("[data-close-dialog]").forEach((btn) =>
  btn.addEventListener("click", () => $("#prospectDialog").close())
);

document.querySelectorAll("[data-close-task]").forEach((btn) => btn.addEventListener("click", () => $("#taskDialog").close()));
document.querySelectorAll("[data-close-team-member]").forEach((btn) => btn.addEventListener("click", () => $("#teamMemberDialog").close()));

$("#teamMemberForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await crmAction("createUser", { name: String(data.get("name") || "").trim(), email: String(data.get("email") || "").trim(), role: String(data.get("role") || "sales_rep") });
    $("#teamMemberDialog").close();
    await refreshCrm();
    renderTeamSnapshot();
    showToast("CRM user added", "They can now sign in with their company Google account.");
  } catch (error) { alert(error.message); } finally { button.disabled = false; }
});

$("#taskForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const result = await crmAction("createTask", { title: String(data.get("title") || "").trim(), dueDate: String(data.get("dueDate") || ""), assignedTo: isManager() ? String(data.get("assignedTo") || currentUserName()) : currentUserName(), taskType: String(data.get("taskType") || "follow_up"), priority: String(data.get("priority") || "normal"), prospectId: String(data.get("prospectId") || ""), notes: String(data.get("notes") || "").trim() });
    $("#taskDialog").close();
    await refreshCrm();
    if (result.calendarSynced) showToast("Task added to Google Calendar", `${result.task.title} is on ${result.task.calendar_owner_email || "the assigned calendar"}.`);
    else showToast("Task saved — Calendar needs attention", result.calendarSyncError || "Reconnect Google and try again.", "warning");
  } catch (error) { alert(error.message); } finally { button.disabled = false; }
});

document.querySelectorAll("[data-close-note]").forEach((btn) =>
  btn.addEventListener("click", () => $("#noteDialog").close())
);

document.querySelectorAll("[data-close-edit]").forEach((btn) =>
  btn.addEventListener("click", () => $("#editDialog").close())
);

document.querySelectorAll("[data-close-import]").forEach((btn) =>
  btn.addEventListener("click", () => $("#importDialog").close())
);

document.querySelectorAll("[data-back]").forEach((btn) =>
  btn.addEventListener("click", () => {
    renderHome();
    showView("homeView");
  })
);

$("#prospectForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (prospectSaveInFlight) return;
  const form = event.currentTarget;
  const saveButton = form.querySelector('[type="submit"]');
  const data = new FormData(form);
  const companyName = String(data.get("companyName") || "").trim();
  if (!companyName) return;

  prospectSaveInFlight = true;
  saveButton.disabled = true;
  saveButton.setAttribute("aria-busy", "true");
  saveButton.textContent = "Saving Prospect…";

  const notes = String(data.get("notes") || "").trim();
  const createdAt = nowIso();

  const prospect = {
    id: uid("prospect"),
    companyName,
    phone: String(data.get("phone") || "").trim(),
    contactName: String(data.get("contactName") || "").trim(),
    email: String(data.get("email") || "").trim(),
    address: String(data.get("address") || "").trim(),
    stage: String(data.get("stage") || "New Lead"),
    estimatedValue: Number(data.get("estimatedValue") || 0),
    owner: String(data.get("owner") || currentUserName()),
    createdAt,
    createdBy: currentUserName(),
    customerId: null,
    timeline: [
      {
        id: uid("activity"),
        at: createdAt,
        user: currentUserName(),
        text: "Created prospect."
      }
    ],
    reminders: [],
    quotes: []
  };

  if (notes) {
    prospect.timeline.push({
      id: uid("activity"),
      at: createdAt,
      user: currentUserName(),
      text: notes
    });
  }

  try {
    const created = await crmAction("createProspect", { ...prospect, notes });
    form.reset();
    $("#prospectDialog").close();
    showToast("Prospect saved", `${companyName} was added to the CRM.`);
    try {
      await refreshCrm(created.prospect.id);
    } catch (refreshError) {
      showToast("Prospect saved — refresh needed", `${companyName} is in the CRM. Refresh the page to see it.`, "warning");
    }
  } catch (error) {
    alert(`Prospect was not saved: ${error.message}`);
  } finally {
    prospectSaveInFlight = false;
    saveButton.disabled = false;
    saveButton.removeAttribute("aria-busy");
    saveButton.textContent = "Save Prospect";
  }
});

$("#editForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const p = prospectById(currentProspectId);
  const data = new FormData(event.currentTarget);
  const oldStage = p.stage;
  ["companyName", "contactName", "phone", "email", "address", "stage"].forEach((name) => {
    p[name] = String(data.get(name) || "").trim();
  });
  p.owner = isManager() ? String(data.get("owner") || "Greg") : currentUserName();
  p.estimatedValue = Number(data.get("estimatedValue") || 0);
  await crmAction("updateProspect", { ...p, id: p.id, oldStage, user: currentUserName() });
  $("#editDialog").close();
  await refreshCrm(p.id);
});

$("#importForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.file.files[0];
  if (!file) return;
  const status = $("#importStatus");
  const button = $("#runImportBtn");
  if (file.size > 3 * 1024 * 1024) {
    status.className = "import-status visible error";
    status.textContent = "That file is larger than 3 MB.";
    return;
  }
  button.disabled = true;
  button.textContent = "Importing…";
  status.className = "import-status visible";
  status.textContent = "Reading and checking your records…";
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read the selected file."));
      reader.readAsDataURL(file);
    });
    const response = await crmFetch("/api/import-prospects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, fileBase64: String(dataUrl).split(",")[1], recordType: form.elements.recordType.value, owner: form.elements.owner.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Import failed.");
    status.className = "import-status visible";
    status.textContent = `Imported ${result.imported} records. Skipped ${result.skippedDuplicates} duplicates and ${result.skippedBlank} blank rows.`;
    await refreshCrm();
    button.textContent = "Import Complete";
  } catch (error) {
    status.className = "import-status visible error";
    status.textContent = error.message;
    button.disabled = false;
    button.textContent = "Import Records";
  }
});

function exportCsv() {
  const headers = ["Company", "Contact", "Email", "Phone", "Address", "Stage", "Owner", "Estimated Value", "Next Follow-Up", "Quotes"];
  const rows = state.prospects.map((p) => [p.companyName, p.contactName, p.email, p.phone, p.address, p.stage, p.owner, p.estimatedValue, latestReminder(p)?.date || "", (p.quotes || []).length]);
  const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = `bargain-crm-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

$("#noteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const p = prospectById(currentProspectId);
  const data = new FormData(event.currentTarget);
  const note = String(data.get("note") || "").trim();
  if (!note) return;

  p.timeline.push({
    id: uid("activity"),
    at: nowIso(),
    user: currentUserName(),
    text: note
  });

  const customDate = String(data.get("customDate") || "");
  const reminderDays = Number(data.get("reminder") || 0);
  let reminderDate = customDate;

  if (!reminderDate && reminderDays) {
    const d = new Date();
    d.setDate(d.getDate() + reminderDays);
    reminderDate = d.toISOString().slice(0, 10);
  }

  if (reminderDate) {
    p.reminders.push({
      id: uid("reminder"),
      date: reminderDate,
      note,
      completed: false
    });
  }

  await crmAction("addNote", { prospectId: p.id, note, reminderDate, user: currentUserName() });
  event.currentTarget.reset();
  $("#noteDialog").close();
  await refreshCrm(p.id);
});

$("#productSearch").addEventListener("input", (event) => {
  clearTimeout(productSearchTimer);
  productSearchTimer = setTimeout(() => renderProductResults(event.target.value), 300);
});
$("#saveQuoteBtn").addEventListener("click", () => saveQuote(false));
$("#emailQuoteBtn").addEventListener("click", () => saveQuote(true));
$("#cancelQuoteBtn").addEventListener("click", () => {
  renderProspect();
  showView("prospectView");
});

$("#prospectList").innerHTML = `<div class="empty">Loading your CRM profile…</div>`;
refreshCrm().catch((error) => { console.warn("CRM load failed:", error); showLogin(error.message === "Invalid CRM access code." ? "Sign in to continue." : error.message); });
