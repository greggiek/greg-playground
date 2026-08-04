const readXlsxFile = require("read-excel-file/node");
const { requireCrmAccess } = require("./_auth");
const { supabaseRest } = require("./_supabase");

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_ROWS = 1000;

function clean(value) {
  return String(value ?? "").trim();
}

function headerKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (char !== "\r") field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function spreadsheetRows(fileName, buffer) {
  if (fileName.toLowerCase().endsWith(".csv")) return parseCsv(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  if (!fileName.toLowerCase().endsWith(".xlsx")) throw new Error("Upload a .csv or .xlsx file.");
  const sheets = await readXlsxFile(buffer);
  return sheets[0]?.data || [];
}

function pick(record, aliases) {
  for (const alias of aliases) {
    const value = record[headerKey(alias)];
    if (clean(value)) return clean(value);
  }
  return "";
}

function normalizeRow(record, defaults) {
  const firstName = pick(record, ["first name", "firstname"]);
  const lastName = pick(record, ["last name", "lastname"]);
  const fullName = pick(record, ["contact name", "contact", "customer name", "full name", "name"]) || [firstName, lastName].filter(Boolean).join(" ");
  const company = pick(record, ["company name", "company", "business name", "business", "organization"]);
  const email = pick(record, ["email", "email address", "customer email"]);
  const phone = pick(record, ["phone", "phone number", "mobile", "telephone"]);
  const directAddress = pick(record, ["address", "full address", "street address"]);
  const addressParts = [
    pick(record, ["address 1", "address1", "address line 1", "street"]),
    pick(record, ["address 2", "address2", "address line 2"]),
    pick(record, ["city"]),
    pick(record, ["state", "province"]),
    pick(record, ["zip", "zipcode", "postal code", "postalcode"]),
  ].filter(Boolean);
  const valueText = pick(record, ["estimated value", "estimatedvalue", "value", "pipeline value"]);
  const estimatedValue = Number(valueText.replace(/[$,]/g, "")) || 0;
  const stage = pick(record, ["stage", "pipeline stage", "status"]) || defaults.stage;
  const owner = pick(record, ["owner", "salesperson", "sales rep", "rep"]) || defaults.owner;
  return {
    company_name: company || fullName || email || phone,
    contact_name: fullName,
    email,
    phone,
    address: directAddress || addressParts.join(", "),
    stage,
    estimated_value: estimatedValue,
    owner_name: owner,
    created_by: defaults.owner,
  };
}

function duplicateKeys(record) {
  const keys = [];
  const email = clean(record.email).toLowerCase();
  const company = clean(record.company_name).toLowerCase().replace(/[^a-z0-9]/g, "");
  const phone = clean(record.phone).replace(/\D/g, "");
  if (email) keys.push(`email:${email}`);
  if (company && phone) keys.push(`company-phone:${company}:${phone}`);
  return keys;
}

module.exports = async function handler(req, res) {
  if (!requireCrmAccess(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const { fileName = "", fileBase64 = "", recordType = "prospect", owner = "Greg" } = req.body || {};
    if (!fileName || !fileBase64) return res.status(400).json({ error: "Choose a CSV or Excel file." });
    const buffer = Buffer.from(fileBase64, "base64");
    if (!buffer.length || buffer.length > MAX_FILE_BYTES) return res.status(400).json({ error: "File must be smaller than 3 MB." });
    const rows = await spreadsheetRows(fileName, buffer);
    if (rows.length < 2) return res.status(400).json({ error: "The file needs a header row and at least one data row." });
    if (rows.length - 1 > MAX_ROWS) return res.status(400).json({ error: `Import a maximum of ${MAX_ROWS} records at a time.` });

    const headers = rows[0].map(headerKey);
    const defaults = { stage: recordType === "customer" ? "Won" : "New Lead", owner: clean(owner) || "Greg" };
    const normalized = rows.slice(1).map((values) => {
      const record = {};
      headers.forEach((header, index) => { if (header) record[header] = values[index] ?? ""; });
      return normalizeRow(record, defaults);
    }).filter((record) => record.company_name);

    const existing = await supabaseRest("crm_prospects?select=id,company_name,email,phone");
    const seen = new Set(existing.flatMap(duplicateKeys));
    const imports = [];
    let skippedDuplicates = 0;
    for (const record of normalized) {
      const keys = duplicateKeys(record);
      if (keys.some((key) => seen.has(key))) { skippedDuplicates += 1; continue; }
      keys.forEach((key) => seen.add(key));
      imports.push(record);
    }

    let created = [];
    for (let index = 0; index < imports.length; index += 100) {
      const batch = imports.slice(index, index + 100);
      const inserted = await supabaseRest("crm_prospects", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(batch) });
      created = created.concat(inserted || []);
    }
    for (let index = 0; index < created.length; index += 100) {
      const activities = created.slice(index, index + 100).map((prospect) => ({ prospect_id: prospect.id, activity_type: "imported", body: `Imported from ${fileName}.`, user_name: defaults.owner }));
      if (activities.length) await supabaseRest("crm_activities", { method: "POST", body: JSON.stringify(activities) });
    }

    return res.status(200).json({ imported: created.length, skippedDuplicates, skippedBlank: rows.length - 1 - normalized.length, totalRows: rows.length - 1 });
  } catch (error) {
    console.error("Prospect import failed:", error);
    return res.status(500).json({ error: error.message || "Import failed." });
  }
};
