// ============================================================
// Resource Management Actions API Router
// ============================================================

const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db/database');
const { authorizeRoles } = require('../middleware/rbac');
const { 
  executeVmAction, 
  executeStorageAction, 
  executeAppServiceAction, 
  executeResourceGroupAction 
} = require('../services/actionService');
const { triggerImmediateScan } = require('../services/discoveryEngine');

// Helper to verify subscription ownership
async function verifySubscription(tenantId, subId) {
  const db = await getDatabase();
  const sub = await db.get(
    'SELECT * FROM azure_subscriptions WHERE tenant_id = ? AND (id = ? OR subscription_id = ?)', 
    [tenantId, subId, subId]
  );
  return sub;
}

// 1. POST /api/actions/vm - VM power cycles (Start, Stop, Restart, Deallocate, Redeploy)
router.post('/vm', authorizeRoles('OWNER', 'ADMIN', 'OPERATOR'), async (req, res) => {
  const { subscriptionId, resourceId, action } = req.body;

  if (!subscriptionId || !resourceId || !action) {
    return res.status(400).json({ error: 'subscriptionId, resourceId, and action are required.' });
  }

  try {
    const sub = await verifySubscription(req.tenantId, subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found or access denied.' });

    const result = await executeVmAction(req.tenantId, sub.id, resourceId, action.toLowerCase(), req.userEmail, req.userId);
    
    // Trigger immediate background discovery scan to sync state
    triggerImmediateScan(req.tenantId, sub.id);

    res.json(result);
  } catch (error) {
    console.error(`[ROUTES] VM action ${action} failed:`, error);
    res.status(500).json({ error: error.message });
  }
});

// 2. POST /api/actions/storage - Storage Account actions (Enable/Disable Public Access, Rotate Keys)
router.post('/storage', authorizeRoles('OWNER', 'ADMIN'), async (req, res) => {
  const { subscriptionId, resourceId, action } = req.body;

  if (!subscriptionId || !resourceId || !action) {
    return res.status(400).json({ error: 'subscriptionId, resourceId, and action are required.' });
  }

  try {
    const sub = await verifySubscription(req.tenantId, subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found or access denied.' });

    const result = await executeStorageAction(req.tenantId, sub.id, resourceId, action.toLowerCase(), req.userEmail, req.userId);
    triggerImmediateScan(req.tenantId, sub.id);

    res.json(result);
  } catch (error) {
    console.error(`[ROUTES] Storage action ${action} failed:`, error);
    res.status(500).json({ error: error.message });
  }
});

// 3. POST /api/actions/app-service - App Service actions (Start, Stop, Restart)
router.post('/app-service', authorizeRoles('OWNER', 'ADMIN', 'OPERATOR'), async (req, res) => {
  const { subscriptionId, resourceId, action } = req.body;

  if (!subscriptionId || !resourceId || !action) {
    return res.status(400).json({ error: 'subscriptionId, resourceId, and action are required.' });
  }

  try {
    const sub = await verifySubscription(req.tenantId, subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found or access denied.' });

    const result = await executeAppServiceAction(req.tenantId, sub.id, resourceId, action.toLowerCase(), req.userEmail, req.userId);
    triggerImmediateScan(req.tenantId, sub.id);

    res.json(result);
  } catch (error) {
    console.error(`[ROUTES] App Service action ${action} failed:`, error);
    res.status(500).json({ error: error.message });
  }
});

// 4. POST /api/actions/resource-group - Resource Group actions (Lock, Unlock, Delete)
router.post('/resource-group', authorizeRoles('OWNER', 'ADMIN'), async (req, res) => {
  const { subscriptionId, resourceId, action } = req.body;

  if (!subscriptionId || !resourceId || !action) {
    return res.status(400).json({ error: 'subscriptionId, resourceId, and action are required.' });
  }

  try {
    const sub = await verifySubscription(req.tenantId, subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found or access denied.' });

    const result = await executeResourceGroupAction(req.tenantId, sub.id, resourceId, action.toLowerCase(), req.userEmail, req.userId);
    triggerImmediateScan(req.tenantId, sub.id);

    res.json(result);
  } catch (error) {
    console.error(`[ROUTES] Resource Group action ${action} failed:`, error);
    res.status(500).json({ error: error.message });
  }
});

// 5. GET /api/actions/operations - List operations log
router.get('/operations', async (req, res) => {
  try {
    const db = await getDatabase();
    const ops = await db.all('SELECT * FROM operations ORDER BY created_at DESC LIMIT 50');
    res.json(ops);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. GET /api/actions/operations/:id/logs - List operation execution logs
router.get('/operations/:id/logs', async (req, res) => {
  try {
    const db = await getDatabase();
    const logs = await db.all('SELECT * FROM operation_logs WHERE operation_id = ? ORDER BY timestamp ASC', [req.params.id]);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
