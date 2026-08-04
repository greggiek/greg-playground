function requireCrmAccess(req, res) {
  const expected = process.env.CRM_ACCESS_CODE;
  const provided = req.headers["x-crm-access-code"];
  if (!expected) {
    res.status(503).json({ error: "CRM access protection is not configured." });
    return false;
  }
  if (!provided || provided !== expected) {
    res.status(401).json({ error: "Invalid CRM access code." });
    return false;
  }
  return true;
}

module.exports = { requireCrmAccess };
