// ============================================================
// Secure Local Authentication Router - Single Admin Lockout
// ============================================================

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { logAudit } = require('../services/auditLogger');

const LOCAL_ADMIN_EMAIL = 'admin@cloudops-local.com';
const JWT_SECRET = process.env.JWT_SECRET || 'local-secret-key-12345';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'local-refresh-secret-key-67890';

// Lockout Tracking
const failedAttempts = new Map();
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts. Rate limit exceeded.' }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.toLowerCase();
  
  // Check lockout
  const attemptRecord = failedAttempts.get(normalizedEmail) || { count: 0, lockoutUntil: 0 };
  if (Date.now() < attemptRecord.lockoutUntil) {
    const minutesLeft = Math.ceil((attemptRecord.lockoutUntil - Date.now()) / 60000);
    return res.status(403).json({ error: `Account is temporarily locked. Try again in ${minutesLeft} minutes.` });
  }

  // Get secure admin password hash from database
  const { getDatabase } = require('../db/database');
  const database = await getDatabase();
  const userRow = await database.get('SELECT password_hash FROM users WHERE email = ?', [normalizedEmail]);
  const adminPasswordHash = userRow ? userRow.password_hash : null;

  // Validate single admin email
  if (normalizedEmail === LOCAL_ADMIN_EMAIL && adminPasswordHash) {
    const isPasswordValid = await bcrypt.compare(password, adminPasswordHash);

    if (isPasswordValid) {
      // Success: Reset failed attempts
      failedAttempts.delete(normalizedEmail);

      // Generate Access & Refresh Tokens
      const payload = {
        oid: 'local-admin-001',
        upn: LOCAL_ADMIN_EMAIL,
        name: 'System Administrator',
        roles: ['OWNER'],
        tenantId: 'demo-org-001',
        tid: 'demo-org-001'
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
      const refreshToken = jwt.sign({ oid: payload.oid }, REFRESH_SECRET, { expiresIn: '7d' });

      // Audit Log Success
      await logAudit('demo-org-001', 'admin-001', LOCAL_ADMIN_EMAIL, 'LOGIN_SUCCESS', 'User', 'admin-001', ip, 'SUCCESS');

      return res.json({
        token,
        refreshToken,
        user: {
          id: payload.oid,
          email: payload.upn,
          displayName: payload.name,
          role: 'OWNER',
          organizationId: payload.tenantId,
          entraObjectId: payload.oid,
          lastLogin: new Date().toISOString()
        }
      });
    }
  }

  // Increment failed attempts
  attemptRecord.count += 1;
  let errorMsg = 'Invalid administrator credentials.';

  if (attemptRecord.count >= LOCKOUT_THRESHOLD) {
    attemptRecord.lockoutUntil = Date.now() + LOCKOUT_DURATION;
    errorMsg = `Account locked due to 5 consecutive failed login attempts. Try again in 15 minutes.`;
    
    // Audit Log Lockout
    await logAudit('demo-org-001', 'anonymous', normalizedEmail, 'ACCOUNT_LOCKOUT', 'User', null, ip, 'LOCKOUT');
  } else {
    // Audit Log Failure
    await logAudit('demo-org-001', 'anonymous', normalizedEmail, 'LOGIN_FAILURE', 'User', null, ip, 'FAILURE', { attempts: attemptRecord.count });
  }

  failedAttempts.set(normalizedEmail, attemptRecord);
  return res.status(401).json({ error: errorMsg });
});

// Refresh token endpoint
router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required.' });
  }

  jwt.verify(refreshToken, REFRESH_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired refresh token.' });
    }

    // Generate new Access Token
    const payload = {
      oid: 'local-admin-001',
      upn: LOCAL_ADMIN_EMAIL,
      name: 'System Administrator',
      roles: ['OWNER'],
      tenantId: 'demo-org-001',
      tid: 'demo-org-001'
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  });
});

module.exports = router;
