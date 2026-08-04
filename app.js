const STORAGE_KEY = "bargainProspectCRM.v1";

let state = loadState();
let currentProspectId = null;
let draftQuoteLines = [];
let productSearchTimer = null;

const $ = (selector) => document.querySelector(selector);

async function crmFetch(url, options = {}, retry = true) {
  let accessCode = sessionStorage.getItem("bargainCrmAccessCode");
  if (!accessCode) {
    accessCode = prompt("Enter the Bargain CRM access code:");
    if (!accessCode) throw new Error("CRM access code required.");
    sessionStorage.setItem("bargainCrmAccessCode", accessCode);
  }
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), "X-CRM-Access-Code": accessCode },
  });
  if (response.status === 401 && retry) {
    sessionStorage.removeItem("bargainCrmAccessCode");
    return crmFetch(url, options, false);
  }
  return response;
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

async function refreshCrm(openId) {
  const response = await crmFetch("/api/crm");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Could not load CRM.");
  state = { prospects: (body.prospects || []).map(fromDbProspect) };
  saveState();
  renderHome();
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
        <a class="btn btn-secondary ${p.email ? "" : "disabled"}" href="${p.email ? `mailto:${encodeURIComponent(p.email)}?subject=${encodeURIComponent(`Quote from Bargain Moulding for ${p.companyName}`)}` : "#"}" ${p.email ? "" : 'aria-disabled="true"'}>Email</a>
        <button class="btn btn-secondary" id="addNoteBtn">Add Note</button>
        <button class="btn btn-primary" id="buildQuoteBtn">Build Quote</button>
        <button class="btn btn-secondary" id="editProspectBtn">Edit</button>
        <button class="btn btn-danger" id="deleteProspectBtn">Delete</button>
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
      ${quotes.length ? quotes.map((quote) => `<article class="timeline-item"><div class="timeline-meta">${escapeHtml(quote.number)} · ${escapeHtml(quote.status)} · ${formatMoney(quote.total)}</div><div class="button-row"><button class="btn btn-small btn-secondary" data-reopen-quote="${quote.id}">Reopen</button>${quote.status !== "converted" ? `<button class="btn btn-small btn-primary" data-convert-quote="${quote.id}">Convert to Shopify</button>` : ""}</div></article>`).join("") : `<div class="empty">No saved quotes yet.</div>`}
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
  $("#deleteProspectBtn").addEventListener("click", deleteCurrentProspect);

  if ($("#completeReminderBtn")) {
    $("#completeReminderBtn").addEventListener("click", async () => {
      await crmAction("completeReminder", { id: reminder.id });
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
  document.querySelectorAll("[data-reopen-quote]").forEach((btn) => btn.addEventListener("click", () => startQuote(btn.dataset.reopenQuote)));
  document.querySelectorAll("[data-convert-quote]").forEach((btn) => btn.addEventListener("click", () => convertQuoteToShopify(btn.dataset.convertQuote)));
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

function openEditDialog() {
  const p = prospectById(currentProspectId);
  const form = $("#editForm");
  ["companyName", "contactName", "phone", "email", "address", "stage", "estimatedValue", "owner"].forEach((name) => {
    form.elements[name].value = p[name] ?? "";
  });
  $("#editDialog").showModal();
}

function startQuote(quoteId = null) {
  const quote = quoteId ? prospectById(currentProspectId).quotes.find((q) => q.id === quoteId) : null;
  draftQuoteLines = quote ? quote.lines.map((line) => ({ ...line })) : [];
  const p = prospectById(currentProspectId);
  $("#quoteProspectName").textContent = p.companyName;
  $("#productSearch").value = "";
  renderProductResults("");
  renderQuoteLines();
  showView("quoteView");
}

async function renderProductResults(query) {
  $("#productResults").innerHTML = `<div class="empty">Loading Shopify products…</div>`;
  $("#shopifyStatus").textContent = "Connecting to live Shopify catalog…";
  $("#shopifyStatus").classList.remove("error");
  let products = [];
  try {
    const response = await crmFetch(`/api/products?search=${encodeURIComponent(query.trim())}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Product search failed.");
    products = body.products || [];
    $("#shopifyStatus").textContent = `${products.length} live Shopify variants found`;
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
    await crmAction("saveQuote", { prospectId: p.id, quoteNumber, lines: draftQuoteLines, createdBy: "Greg" });
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
    user: "Greg",
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

$("#prospectForm").addEventListener("submit", async (event) => {
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

  const created = await crmAction("createProspect", { ...prospect, notes });
  event.currentTarget.reset();
  $("#prospectDialog").close();
  await refreshCrm(created.prospect.id);
});

$("#editForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const p = prospectById(currentProspectId);
  const data = new FormData(event.currentTarget);
  const oldStage = p.stage;
  ["companyName", "contactName", "phone", "email", "address", "stage", "owner"].forEach((name) => {
    p[name] = String(data.get(name) || "").trim();
  });
  p.estimatedValue = Number(data.get("estimatedValue") || 0);
  await crmAction("updateProspect", { ...p, id: p.id, oldStage, user: "Greg" });
  $("#editDialog").close();
  await refreshCrm(p.id);
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

  await crmAction("addNote", { prospectId: p.id, note, reminderDate, user: "Greg" });
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

renderHome();
refreshCrm().catch((error) => console.warn("Supabase CRM load failed:", error));
