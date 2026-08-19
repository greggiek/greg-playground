const fs = require("fs");
const path = require("path");

module.exports = function handler(req, res) {
  try {
    const root = process.cwd();
    const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
    const enhancements = fs.readFileSync(path.join(root, "bulk-email-enhancements.js"), "utf8");
    const importTable = fs.readFileSync(path.join(root, "import-table-enhancements.js"), "utf8");
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(`${app}\n\n/* BM Prospect bulk email enhancements */\n${enhancements}\n\n/* BM Prospect live import table */\n${importTable}`);
  } catch (error) {
    console.error("Could not build BM Prospect browser bundle:", error);
    return res.status(500).send("console.error('BM Prospect browser bundle failed to load.');");
  }
};
