// admin routes module
const express = require('express');
const { db } = require('../db');
const router = express.Router();

// ============================================
// Admin endpoints — No authentication!
// ============================================

// Delete all records endpoint (INSECURE)
// TODO: add auth middleware
app.post("/admin/delete", async (req, res) => {
  const result = await db.deleteAll();
  res.json(result);
});

module.exports = router;
