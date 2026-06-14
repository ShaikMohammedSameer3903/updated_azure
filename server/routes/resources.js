const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db/database');
const { listResourceGroupsWithCounts } = require('../services/discoveryEngine');
const { logAudit } = require('../services/auditLogger');

// 1. GET /api/resources - Retrieve cached discovered resources
router.get('/', async (req, res) => {
  const { subscriptionId, resourceGroup, type, location } = req.query;
  try {
    const db = await getDatabase();
    let query = `
      SELECT r.*, s.name as subscription_name, s.subscription_id as azure_subscription_id
      FROM resources r
      JOIN azure_subscriptions s ON r.subscription_id = s.id
      WHERE s.tenant_id = ?
    `;
    const params = [req.tenantId];

    if (subscriptionId) {
      query += ` AND r.subscription_id = ?`;
      params.push(subscriptionId);
    }
    if (resourceGroup) {
      query += ` AND r.resource_group = ?`;
      params.push(resourceGroup);
    }
    if (type) {
      query += ` AND r.type = ?`;
      params.push(type);
    }
    if (location) {
      query += ` AND r.location = ?`;
      params.push(location);
    }
    query += ` ORDER BY r.name ASC`;

    const resources = await db.all(query, params);
    const formattedResources = resources.map(res => ({
      ...res,
      tags: res.tags ? JSON.parse(res.tags) : {},
      raw_payload: res.raw_payload ? JSON.parse(res.raw_payload) : {},
      owner: res.owner || 'Unassigned',
      last_modified: res.last_modified || res.last_discovered_at,
      cost_impact: res.cost_impact || 0,
      risk_score: res.risk_score || 0,
      health_status: res.health_status || 'Healthy'
    }));
    res.json(formattedResources);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve discovered resources.' });
  }
});

// 2. POST /api/resources/create - Create / Deploy Resource
router.post('/create', async (req, res) => {
  const { subscriptionId, type, name, location, resourceGroup } = req.body;
  if (!subscriptionId || !type || !name) {
    return res.status(400).json({ error: 'Missing deployment parameters' });
  }
  const db = await getDatabase();
  try {
    const resourceId = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup || name}/providers/Microsoft.${type}/${name}`;
    
    await db.run(`
      INSERT INTO resources (id, subscription_id, resource_group, name, type, location, status, tags, raw_payload)
      VALUES (?, ?, ?, ?, ?, ?, 'Active', '{}', '{}')
    `, [resourceId, subscriptionId, resourceGroup || name, name, `Microsoft.${type}`, location || 'eastus']);

    await logAudit(req.tenantId, req.userId, req.userEmail, 'CREATE_RESOURCE', `Microsoft.${type}`, resourceId, req.ip, 'SUCCESS', { name });
    res.json({ success: true, resourceId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST /api/resources/delete - Delete / Destroy Resource
router.post('/delete', async (req, res) => {
  const { subscriptionId, resourceId } = req.body;
  if (!resourceId) {
    return res.status(400).json({ error: 'Missing resourceId parameter' });
  }
  const db = await getDatabase();
  try {
    const resRow = await db.get('SELECT * FROM resources WHERE id = ?', [resourceId]);
    if (!resRow) {
      return res.status(404).json({ error: 'Resource not found' });
    }

    await db.run('DELETE FROM resources WHERE id = ?', [resourceId]);
    await logAudit(req.tenantId, req.userId, req.userEmail, 'DELETE_RESOURCE', resRow.type, resourceId, req.ip, 'SUCCESS', { name: resRow.name });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. GET /api/resources/groups/:subscriptionId - Get live Resource Groups with cached resource counts
router.get('/groups/:subscriptionId', async (req, res) => {
  const { subscriptionId } = req.params;
  const userAccessToken = req.azureAccessToken || req.headers['x-azure-token'] || null;
  try {
    const groups = await listResourceGroupsWithCounts(req.tenantId, subscriptionId, userAccessToken);
    res.json(groups);
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to retrieve resource groups.' });
  }
});

module.exports = router;
