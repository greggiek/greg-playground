function requireCrmAccess(req, res) {
  const provided = req.headers["x-crm-access-code"];
  const profiles = [
    { name: "Greg", role: "manager", code: process.env.CRM_GREG_ACCESS_CODE || process.env.CRM_ACCESS_CODE },
    { name: "Craig", role: "manager", code: process.env.CRM_CRAIG_ACCESS_CODE },
    { name: "Rep 1", role: "sales_rep", code: process.env.CRM_REP1_ACCESS_CODE },
  ].filter((profile) => profile.code);
  if (!profiles.length) {
    res.status(503).json({ error: "CRM access protection is not configured." });
    return false;
  }
  const profile = profiles.find((item) => provided && provided === item.code);
  if (!profile) {
    res.status(401).json({ error: "Invalid CRM access code." });
    return false;
  }
  req.crmUser = { name: profile.name, role: profile.role };
  return req.crmUser;
}

function requireManager(req, res) {
  const user = req.crmUser || requireCrmAccess(req, res);
  if (!user) return false;
  if (user.role !== "manager") {
    res.status(403).json({ error: "Manager access required." });
    return false;
  }
  return user;
}

module.exports = { requireCrmAccess, requireManager };
