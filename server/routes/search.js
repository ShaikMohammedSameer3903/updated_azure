// ============================================================
// Global Search API Router
// ============================================================

const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db/database');

router.get('/', async (req, res) => {
  const { q } = req.query;
  if (!q) {
    return res.json({ resources: [], incidents: [], audit: [] });
  }

  const query = `%${q}%`;
  try {
    const db = await getDatabase();

    // Search resources
    const resources = await db.all(`
      SELECT r.*, s.name as subscription_name 
      FROM resources r
      JOIN azure_subscriptions s ON r.subscription_id = s.id
      WHERE s.tenant_id = ? AND (r.name LIKE ? OR r.type LIKE ? OR r.location LIKE ?)
    `, [req.tenantId, query, query, query]);

    // Search incidents
    const incidents = await db.all(`
      SELECT i.*, s.name as subscription_name 
      FROM incidents i
      JOIN azure_subscriptions s ON i.subscription_id = s.id
      WHERE s.tenant_id = ? AND (i.title LIKE ? OR i.description LIKE ? OR i.category LIKE ?)
    `, [req.tenantId, query, query, query]);

    // Search audit logs
    const audit = await db.all(`
      SELECT * FROM audit_logs 
      WHERE tenant_id = ? AND (action LIKE ? OR details LIKE ? OR user_email LIKE ?)
    `, [req.tenantId, query, query, query]);

    res.json({
      resources: resources.map(res => ({
        ...res,
        tags: res.tags ? JSON.parse(res.tags) : {},
        raw_payload: res.raw_payload ? JSON.parse(res.raw_payload) : {}
      })),
      incidents,
      audit
    });
  } catch (error) {
    console.error('[SEARCH] Global search failed:', error);
    res.status(500).json({ error: 'Search query failed.' });
  }
});

module.exports = router;
