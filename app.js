const STORAGE_KEY = "bargainProspectCRM.v1";

const mockShopifyProducts = [
  { id: "gid://shopify/ProductVariant/1", title: '2-Panel Shaker Door', variant: '30" x 80"', sku: "SHAKER-2P-3080", price: 190.00 },
  { id: "gid://shopify/ProductVariant/2", title: '2-Panel Shaker Door', variant: '32" x 80"', sku: "SHAKER-2P-3280", price: 198.00 },
  { id: "gid://shopify/ProductVariant/3", title: '5-1/4" MDF Base', variant: "16 ft", sku: "MDF-BASE-514-16", price: 18.50 },
  { id: "gid://shopify/ProductVariant/4", title: '3-1/2" MDF Casing', variant: "16 ft", sku: "MDF-CASING-312-16", price: 14.75 },
  { id: "gid://shopify/ProductVariant/5", title: "1x6 PVC Board", variant: "18 ft", sku: "PVC-1X6-18", price: 42.00 },
  { id: "gid://shopify/ProductVariant/6", title: "Essential LVP Flooring", variant: "9 x 60", sku: "LVP-ESSENTIAL", price: 2.25 },
];

let state = loadState();
let currentProspectId = null;
let draftQuoteLines = [];

const $ = (selector) => document.querySelector(selector);

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

  document.querySelectorAll("[data-open-prospect]").forEach((el) => {
    el.addEventListener("click", () => openProspect(el.dataset.openProspect));
  });
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
        <div>
          <span class="badge">${p.customerId ? "Customer" : "Prospect"}</span>
        </div>
      </div>

      <div class="action-grid">
        <a class="btn btn-secondary" href="${p.phone ? `tel:${encodeURIComponent(p.phone)}` : "#"}">Call</a>
        <button class="btn btn-secondary" id="addNoteBtn">Add Note</button>
        <button class="btn btn-primary" id="buildQuoteBtn">Build Quote</button>
        <button class="btn btn-secondary" id="editProspectBtn">Edit</button>
      </div>

      ${reminder ? `
        <div class="info-strip">
          <strong>Next Follow-Up:</strong> ${escapeHtml(reminder.date)} — ${escapeHtml(reminder.note || "Follow up")}
          <button class="btn btn-small btn-secondary" id="completeReminderBtn">Done</button>
        </div>` : ""}

      ${latestQuote ? `
        <div class="info-strip">
          <strong>Latest Quote:</strong> ${escapeHtml(latestQuote.number)} — ${formatMoney(latestQuote.total)}
        </div>` : ""}
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

  if ($("#completeReminderBtn")) {
    $("#completeReminderBtn").addEventListener("click", () => {
      reminder.completed = true;
      p.timeline.push({
        id: uid("activity"),
        at: nowIso(),
        user: "Greg",
        text: "Completed follow-up reminder."
      });
      saveState();
      renderProspect();
    });
  }
}

function openEditDialog() {
  const p = prospectById(currentProspectId);
  const form = $("#editForm");
  ["companyName", "contactName", "phone", "email", "address", "stage", "estimatedValue", "owner"].forEach((name) => {
    form.elements[name].value = p[name] ?? "";
  });
  $("#editDialog").showModal();
}

function startQuote() {
  draftQuoteLines = [];
  const p = prospectById(currentProspectId);
  $("#quoteProspectName").textContent = p.companyName;
  $("#productSearch").value = "";
  renderProductResults("");
  renderQuoteLines();
  showView("quoteView");
}

function renderProductResults(query) {
  const q = query.trim().toLowerCase();
  const products = mockShopifyProducts.filter((product) =>
    [product.title, product.variant, product.sku].join(" ").toLowerCase().includes(q)
  ).slice(0, 20);

  $("#productResults").innerHTML = products.map((product) => `
    <div class="product-result">
      <div>
        <div class="product-name">${escapeHtml(product.title)} — ${escapeHtml(product.variant)}</div>
        <div class="product-meta">${escapeHtml(product.sku)} · ${formatMoney(product.price)}</div>
      </div>
      <button class="btn btn-small btn-primary" data-add-product="${product.id}">Add</button>
    </div>
  `).join("");

  document.querySelectorAll("[data-add-product]").forEach((btn) => {
    btn.addEventListener("click", () => addProductToQuote(btn.dataset.addProduct));
  });
}

function addProductToQuote(productId) {
  const product = mockShopifyProducts.find((p) => p.id === productId);
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

function saveQuote() {
  if (!draftQuoteLines.length) {
    alert("Add at least one product.");
    return;
  }

  const p = prospectById(currentProspectId);
  const total = draftQuoteLines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  const quoteNumber = `Q-${String(Date.now()).slice(-6)}`;

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
    user: "Greg",
    text: `Created Quote ${quoteNumber} — ${formatMoney(total)}`
  });

  saveState();
  renderProspect();
  showView("prospectView");
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
    user: "Greg",
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

$("#newProspectBtn").addEventListener("click", () => $("#prospectDialog").showModal());
$("#searchInput").addEventListener("input", renderHome);
$("#stageFilter").addEventListener("change", renderHome);
$("#exportBtn").addEventListener("click", exportCsv);

document.querySelectorAll("[data-close-dialog]").forEach((btn) =>
  btn.addEventListener("click", () => $("#prospectDialog").close())
);

document.querySelectorAll("[data-close-note]").forEach((btn) =>
  btn.addEventListener("click", () => $("#noteDialog").close())
);

document.querySelectorAll("[data-close-edit]").forEach((btn) =>
  btn.addEventListener("click", () => $("#editDialog").close())
);

document.querySelectorAll("[data-back]").forEach((btn) =>
  btn.addEventListener("click", () => {
    renderHome();
    showView("homeView");
  })
);

$("#prospectForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const companyName = String(data.get("companyName") || "").trim();
  if (!companyName) return;

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
    owner: String(data.get("owner") || "Greg"),
    createdAt,
    createdBy: "Greg",
    customerId: null,
    timeline: [
      {
        id: uid("activity"),
        at: createdAt,
        user: "Greg",
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
      user: "Greg",
      text: notes
    });
  }

  state.prospects.push(prospect);
  saveState();
  event.currentTarget.reset();
  $("#prospectDialog").close();
  renderHome();
  openProspect(prospect.id);
});

$("#editForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const p = prospectById(currentProspectId);
  const data = new FormData(event.currentTarget);
  const oldStage = p.stage;
  ["companyName", "contactName", "phone", "email", "address", "stage", "owner"].forEach((name) => {
    p[name] = String(data.get(name) || "").trim();
  });
  p.estimatedValue = Number(data.get("estimatedValue") || 0);
  if (p.stage === "Won" && !p.customerId) p.customerId = `shopify_demo_${Date.now()}`;
  if (oldStage !== p.stage) {
    p.timeline.push({ id: uid("activity"), at: nowIso(), user: "Greg", text: `Moved from ${oldStage} to ${p.stage}.` });
  }
  saveState();
  $("#editDialog").close();
  renderProspect();
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

$("#noteForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const p = prospectById(currentProspectId);
  const data = new FormData(event.currentTarget);
  const note = String(data.get("note") || "").trim();
  if (!note) return;

  p.timeline.push({
    id: uid("activity"),
    at: nowIso(),
    user: "Greg",
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

  saveState();
  event.currentTarget.reset();
  $("#noteDialog").close();
  renderProspect();
});

$("#productSearch").addEventListener("input", (event) => renderProductResults(event.target.value));
$("#saveQuoteBtn").addEventListener("click", saveQuote);
$("#cancelQuoteBtn").addEventListener("click", () => {
  renderProspect();
  showView("prospectView");
});

renderHome();
