// ============================================================
// Monitoring and Telemetry API Router
// All endpoints use live Azure data only
// ============================================================

const express = require('express');
const router = express.Router();
const { getDatabase } = require('../db/database');
const { getResourceMetrics, getCostConsumption, getBackupHealth, getActiveAlerts } = require('../services/monitoringService');
const { getSecureScore, getDefenderRecommendations, getDefenderAlerts, getComplianceResults } = require('../services/defenderService');
const { getAdvisorRecommendations, getAdvisorScore } = require('../services/advisorService');
const { getServiceHealthAlerts, getResourceHealth, getPlannedMaintenance } = require('../services/healthService');
const { calculateRiskScore } = require('../services/riskEngine');
const { getCloudHealthScore } = require('../services/cloudHealthService');

// Helper: verify subscription ownership
async function verifySubscription(tenantId, subId) {
  const db = await getDatabase();
  return db.get(
    'SELECT * FROM azure_subscriptions WHERE tenant_id = ? AND (id = ? OR subscription_id = ?)',
    [tenantId, subId, subId]
  );
}

// ── 1. GET /api/monitoring/metrics ──────────────────────────
router.get('/metrics', async (req, res) => {
  const { subscriptionId, resourceId } = req.query;
  const userAccessToken = req.azureAccessToken || req.headers['x-azure-token'] || null;
  if (!subscriptionId || !resourceId) {
    return res.status(400).json({ error: 'subscriptionId and resourceId are required.' });
  }
  try {
    const sub = await verifySubscription(req.tenantId, subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found or access denied.' });

    const metrics = await getResourceMetrics(req.tenantId, sub.id, resourceId, userAccessToken);
    res.json(metrics);
  } catch (err) {
    console.error('[ROUTES] GET /monitoring/metrics failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 2. GET /api/monitoring/cost ──────────────────────────────
router.get('/cost', async (req, res) => {
  const { subscriptionId } = req.query;
  const userAccessToken = req.azureAccessToken || req.headers['x-azure-token'] || null;
  if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required.' });
  try {
    const sub = await verifySubscription(req.tenantId, subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found or access denied.' });

    const data = await getCostConsumption(req.tenantId, sub.id, userAccessToken);
    res.json(data);
  } catch (err) {
    console.error('[ROUTES] GET /monitoring/cost failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 3. GET /api/monitoring/backup ──────────────────────────
router.get('/backup', async (req, res) => {
  const { subscriptionId } = req.query;
  const userAccessToken = req.azureAccessToken || req.headers['x-azure-token'] || null;
  if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required.' });
  try {
    const sub = await verifySubscription(req.tenantId, subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found or access denied.' });

    const data = await getBackupHealth(req.tenantId, sub.id, userAccessToken);
    res.json(data);
  } catch (err) {
    console.error('[ROUTES] GET /monitoring/backup failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 4. GET /api/monitoring/alerts ───────────────────────────
router.get('/alerts', async (req, res) => {
  const { subscriptionId } = req.query;
  const userAccessToken = req.azureAccessToken || req.headers['x-azure-token'] || null;
  if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required.' });
  try {
    const sub = await verifySubscription(req.tenantId, subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found or access denied.' });

    const data = await getActiveAlerts(req.tenantId, sub.id, userAccessToken);
    res.json(data);
  } catch (err) {
    console.error('[ROUTES] GET /monitoring/alerts failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 5. GET /api/monitoring/defender ─────────────────────────
router.get('/defender', async (req, res) => {
  const { subscriptionId } = req.query;
  const userAccessToken = req.azureAccessToken || req.headers['x-azure-token'] || null;
  if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required.' });
  try {
    const sub = await verifySubscription(req.tenantId, subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found or access denied.' });

    const [score, recommendations, alerts, compliance] = await Promise.allSettled([
      getSecureScore(req.tenantId, sub.id, userAccessToken),
      getDefenderRecommendations(req.tenantId, sub.id, userAccessToken),
      getDefenderAlerts(req.tenantId, sub.id, userAccessToken),
      getComplianceResults(req.tenantId, sub.id, userAccessToken)
    ]);

    res.json({
      secureScore: score.status === 'fulfilled' ? score.value : null,
      recommendations: recommendations.status === 'fulfilled' ? recommendations.value : [],
      alerts: alerts.status === 'fulfilled' ? alerts.value : [],
      compliance: compliance.status === 'fulfilled' ? compliance.value : [],
      errors: {
        secureScore: score.status === 'rejected' ? score.reason?.message : null,
        recommendations: recommendations.status === 'rejected' ? recommendations.reason?.message : null,
        alerts: alerts.status === 'rejected' ? alerts.reason?.message : null,
        compliance: compliance.status === 'rejected' ? compliance.reason?.message : null
      }
    });
  } catch (err) {
    console.error('[ROUTES] GET /monitoring/defender failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 6. GET /api/monitoring/advisor ──────────────────────────
router.get('/advisor', async (req, res) => {
  const { subscriptionId, category } = req.query;
  const userAccessToken = req.azureAccessToken || req.headers['x-azure-token'] || null;
  if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required.' });
  try {
    const sub = await verifySubscription(req.tenantId, subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found or access denied.' });

    const [recs, scores] = await Promise.allSettled([
      getAdvisorRecommendations(req.tenantId, sub.id, userAccessToken),
      getAdvisorScore(req.tenantId, sub.id, userAccessToken)
    ]);

    let recommendations = recs.status === 'fulfilled' ? recs.value : [];
    if (category) {
      recommendations = recommendations.filter(r =>
        r.category?.toLowerCase() === category.toLowerCase()
      );
    }

    res.json({
      recommendations,
      scores: scores.status === 'fulfilled' ? scores.value : [],
      errors: {
        recommendations: recs.status === 'rejected' ? recs.reason?.message : null,
        scores: scores.status === 'rejected' ? scores.reason?.message : null
      }
    });
  } catch (err) {
    console.error('[ROUTES] GET /monitoring/advisor failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 7. GET /api/monitoring/health ───────────────────────────
router.get('/health', async (req, res) => {
  const { subscriptionId, resourceId } = req.query;
  const userAccessToken = req.azureAccessToken || req.headers['x-azure-token'] || null;
  if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required.' });
  try {
    const sub = await verifySubscription(req.tenantId, subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found or access denied.' });

    if (resourceId) {
      const health = await getResourceHealth(req.tenantId, sub.id, resourceId, userAccessToken);
      return res.json(health);
    }

    const [events, maintenance] = await Promise.allSettled([
      getServiceHealthAlerts(req.tenantId, sub.id, userAccessToken),
      getPlannedMaintenance(req.tenantId, sub.id, userAccessToken)
    ]);

    res.json({
      activeEvents: events.status === 'fulfilled' ? events.value : [],
      plannedMaintenance: maintenance.status === 'fulfilled' ? maintenance.value : [],
      errors: {
        activeEvents: events.status === 'rejected' ? events.reason?.message : null,
        plannedMaintenance: maintenance.status === 'rejected' ? maintenance.reason?.message : null
      }
    });
  } catch (err) {
    console.error('[ROUTES] GET /monitoring/health failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 8. GET /api/monitoring/risk ─────────────────────────────
router.get('/risk', async (req, res) => {
  const { subscriptionId, resourceGroup } = req.query;
  const userAccessToken = req.azureAccessToken || req.headers['x-azure-token'] || null;
  if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required.' });
  try {
    const sub = await verifySubscription(req.tenantId, subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found or access denied.' });

    const data = await calculateRiskScore(req.tenantId, sub.id, resourceGroup || null, userAccessToken);
    res.json(data);
  } catch (err) {
    console.error('[ROUTES] GET /monitoring/risk failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 9. GET /api/monitoring/cloud-health ─────────────────────
router.get('/cloud-health', async (req, res) => {
  const { subscriptionId } = req.query;
  const userAccessToken = req.azureAccessToken || req.headers['x-azure-token'] || null;
  if (!subscriptionId) return res.status(400).json({ error: 'subscriptionId is required.' });
  try {
    const sub = await verifySubscription(req.tenantId, subscriptionId);
    if (!sub) return res.status(404).json({ error: 'Subscription not found or access denied.' });

    const data = await getCloudHealthScore(req.tenantId, sub.id, userAccessToken);
    res.json(data);
  } catch (err) {
    console.error('[ROUTES] GET /monitoring/cloud-health failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── 10. GET /api/monitoring/traffic ─────────────────────────
router.get('/traffic', (req, res) => {
  try {
    const getTrafficStats = req.app.get('getTrafficStats');
    if (getTrafficStats) {
      return res.json(getTrafficStats());
    }
    res.json({
      requestsPerSecond: 0,
      totalRequests: 0,
      activeConnections: 0,
      averageResponseTime: 0,
      successRate: 100,
      errorRate: 0,
      recentRequests: []
    });
  } catch (err) {
    console.error('[ROUTES] GET /monitoring/traffic failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
