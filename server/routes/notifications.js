// ============================================================
// Notifications API Router
// ============================================================

const express = require('express');
const router = express.Router();
const { getNotifications, markAsRead, markAllAsRead, registerClient, unregisterClient } = require('../services/notificationService');

// 1. GET /api/notifications - List all notifications for the tenant
router.get('/', async (req, res) => {
  try {
    const list = await getNotifications(req.tenantId);
    res.json(list);
  } catch (error) {
    console.error('[ROUTES] GET /notifications failed:', error);
    res.status(500).json({ error: 'Failed to retrieve notifications.' });
  }
});

// 2. POST /api/notifications/:id/read - Mark notification as read
router.post('/:id/read', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await markAsRead(req.tenantId, id);
    res.json(result);
  } catch (error) {
    console.error(`[ROUTES] Notification update failed for ${id}:`, error);
    res.status(500).json({ error: error.message });
  }
});

// 3. POST /api/notifications/read-all - Mark all notifications as read
router.post('/read-all', async (req, res) => {
  try {
    const result = await markAllAsRead(req.tenantId);
    res.json(result);
  } catch (error) {
    console.error('[ROUTES] Failed to mark notifications as read:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. GET /api/notifications/stream - Real-time Server-Sent Events stream
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  registerClient(res);

  // Send initial connection confirm
  res.write(`data: ${JSON.stringify({ type: 'connected', tenantId: req.tenantId })}\n\n`);

  // Heartbeat every 15 seconds
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unregisterClient(res);
  });
});

module.exports = router;
