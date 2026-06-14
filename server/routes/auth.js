const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDatabase } = require('../db/database');
const { logAudit } = require('../services/auditLogger');
const { evaluateUserApproval } = require('../services/approvalService');
const validateJwt = require('../middleware/validateJwt');
const adminOnly = require('../middleware/adminOnly');

const JWT_SECRET = process.env.JWT_SECRET || 'local-secret-key-12345';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'local-refresh-secret-key-67890';

// Register or log user session
async function createSession(db, user, provider, req) {
  const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
  const ipAddress = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown';

  await db.run(`
    INSERT INTO sessions (session_id, user_id, email, provider, ip_address, user_agent, login_time, last_active, revoked)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), 0)
  `, [sessionId, user.id, user.email, provider, ipAddress, userAgent]);

  // Update last login in users table
  await db.run(`
    UPDATE users SET last_login = datetime('now') WHERE id = ?
  `, [user.id]);

  return sessionId;
}

// 1. Local Admin Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.toLowerCase();
  const db = await getDatabase();

  try {
    const userRow = await db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    if (!userRow || !userRow.password_hash) {
      await db.run('INSERT INTO failed_logins (email, ip_address, reason) VALUES (?, ?, ?)', [normalizedEmail, ip, 'Invalid email or local admin not found']);
      return res.status(401).json({ error: 'Invalid administrator credentials.' });
    }

    if (userRow.status === 'Disabled') {
      await db.run('INSERT INTO failed_logins (email, ip_address, reason) VALUES (?, ?, ?)', [normalizedEmail, ip, 'User account disabled']);
      return res.status(403).json({ error: 'Account is disabled. Please contact administrator.' });
    }

    const isPasswordValid = await bcrypt.compare(password, userRow.password_hash);
    if (!isPasswordValid) {
      await db.run('INSERT INTO failed_logins (email, ip_address, reason) VALUES (?, ?, ?)', [normalizedEmail, ip, 'Incorrect password']);
      return res.status(401).json({ error: 'Invalid administrator credentials.' });
    }

    const sessionUser = {
      id: userRow.id,
      email: userRow.email,
      displayName: userRow.display_name,
      role: userRow.role,
      tenantId: userRow.tenant_id
    };

    const sessionId = await createSession(db, sessionUser, 'Local', req);

    const tokenPayload = {
      oid: sessionUser.id,
      upn: sessionUser.email,
      name: sessionUser.displayName,
      roles: [sessionUser.role],
      tenantId: sessionUser.tenantId,
      sessionId
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });
    const refreshToken = jwt.sign({ sessionId }, REFRESH_SECRET, { expiresIn: '7d' });
    await logAudit(sessionUser.tenantId, sessionUser.id, sessionUser.email, 'LOGIN_SUCCESS', 'User', sessionUser.id, ip, 'SUCCESS', { provider: 'Local', userAgent });

    res.json({
      token,
      refreshToken,
      user: {
        id: sessionUser.id,
        email: sessionUser.email,
        displayName: sessionUser.displayName,
        role: sessionUser.role,
        provider: 'Local',
        organizationId: sessionUser.tenantId,
        lastLogin: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[AUTH ERROR] Local login failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Entra ID / Microsoft Login Token Exchange / Session Creation
router.post('/entra-login', async (req, res) => {
  const { idToken, email, displayName, tenantId, oid } = req.body;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown';

  if (!email || !oid) {
    return res.status(400).json({ error: 'Missing required credentials' });
  }

  const normalizedEmail = email.toLowerCase();
  const db = await getDatabase();

  try {
    const evaluation = evaluateUserApproval(normalizedEmail);

    // Check if the user is in approved_users table
    let approvedUser = await db.get('SELECT * FROM approved_users WHERE email = ?', [normalizedEmail]);
    if (approvedUser) {
      evaluation.status = 'Approved';
      evaluation.role = approvedUser.role;
    }

    if (evaluation.status !== 'Approved') {
      await db.run('INSERT INTO failed_logins (email, ip_address, reason) VALUES (?, ?, ?)', [normalizedEmail, ip, 'Account not pre-approved']);
      return res.status(403).json({
        error: JSON.stringify({
          code: 'USER_NOT_APPROVED',
          email: normalizedEmail,
          approvalStatus: 'Not Approved',
          adminContact: 'admin@cloudops-local.com',
          instructions: 'This account is not on the pre-approved user whitelist. Please request access from your administrator.'
        })
      });
    }

    let userRow = await db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    if (!userRow) {
      const realTenantId = tenantId || 'demo-org-001';
      // Auto create tenant if not existing
      const tenantCheck = await db.get('SELECT * FROM tenants WHERE id = ?', [realTenantId]);
      if (!tenantCheck) {
        await db.run('INSERT INTO tenants (id, name) VALUES (?, ?)', [realTenantId, 'Tenant ' + realTenantId.substring(0, 8)]);
      }

      await db.run(`
        INSERT INTO users (id, email, display_name, role, tenant_id, provider, status)
        VALUES (?, ?, ?, ?, ?, 'Microsoft', ?)
      `, [oid, normalizedEmail, displayName || email.split('@')[0], evaluation.role, realTenantId, evaluation.status]);
      userRow = await db.get('SELECT * FROM users WHERE id = ?', [oid]);
    } else {
      if (userRow.status === 'Disabled') {
        await db.run('INSERT INTO failed_logins (email, ip_address, reason) VALUES (?, ?, ?)', [normalizedEmail, ip, 'User account disabled']);
        await db.run(`
          INSERT INTO login_history (user_id, email, ip_address, user_agent, status, reason, mfa_status)
          VALUES (?, ?, ?, ?, 'Failed', 'Account is disabled', 'Skipped')
        `, [userRow.id, normalizedEmail, ip, userAgent]);
        return res.status(403).json({ error: 'Access Denied: Account disabled.' });
      }
      // If approved_users has a specific role for this email, sync it to the users table
      // (This handles cases where tenantContext previously downgraded the role incorrectly)
      const approvedEntry = await db.get('SELECT role FROM approved_users WHERE email = ?', [normalizedEmail]);
      if (approvedEntry && approvedEntry.role) {
        evaluation.role = approvedEntry.role;
        await db.run('UPDATE users SET role = ?, status = ?, display_name = ? WHERE email = ?', [
          approvedEntry.role, 'Approved', displayName || userRow.display_name, normalizedEmail
        ]);
        userRow = await db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
      } else {
        // Update display name or other profile info
        await db.run('UPDATE users SET display_name = ? WHERE id = ?', [displayName || userRow.display_name, userRow.id]);
      }
    }

    const sessionUser = {
      id: userRow.id,
      email: userRow.email,
      displayName: userRow.display_name,
      role: userRow.role,
      tenantId: userRow.tenant_id
    };


    const sessionId = await createSession(db, sessionUser, 'Microsoft', req);

    // Write to login history
    await db.run(`
      INSERT INTO login_history (user_id, email, ip_address, user_agent, status, reason, mfa_status)
      VALUES (?, ?, ?, ?, 'Success', 'Approved and Authenticated', ?)
    `, [userRow.id, normalizedEmail, ip, userAgent, userRow.mfa_enabled ? 'Verified' : 'Skipped']);

    const tokenPayload = {
      oid: sessionUser.id,
      upn: sessionUser.email,
      name: sessionUser.displayName,
      roles: [sessionUser.role],
      tenantId: sessionUser.tenantId,
      sessionId
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });
    const refreshToken = jwt.sign({ sessionId }, REFRESH_SECRET, { expiresIn: '7d' });

    await logAudit(sessionUser.tenantId, sessionUser.id, sessionUser.email, 'LOGIN_SUCCESS', 'User', sessionUser.id, ip, 'SUCCESS', { provider: 'Microsoft', userAgent });

    // Start background resource discovery engine upon successful Microsoft authentication (if approved)
    if (userRow.status === 'Approved') {
      const { startDiscoveryScheduler } = require('../services/discoveryEngine');
      startDiscoveryScheduler();
    }

    res.json({
      token,
      refreshToken,
      user: {
        id: sessionUser.id,
        email: sessionUser.email,
        displayName: sessionUser.displayName,
        role: sessionUser.role,
        provider: 'Microsoft',
        organizationId: sessionUser.tenantId,
        tenantId: sessionUser.tenantId,
        status: userRow.status,
        mfaEnabled: !!userRow.mfa_enabled,
        lastLogin: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[AUTH ERROR] Entra ID login failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Google OAuth Login Verification
router.post('/google-login', async (req, res) => {
  const { email, name, googleId } = req.body;
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';
  const userAgent = req.headers['user-agent'] || 'Unknown';

  if (!email || !googleId) {
    return res.status(400).json({ error: 'Missing required credentials' });
  }

  const normalizedEmail = email.toLowerCase();
  const db = await getDatabase();

  try {
    const evaluation = evaluateUserApproval(normalizedEmail);

    // Check if the user is in approved_users table
    let approvedUser = await db.get('SELECT * FROM approved_users WHERE email = ?', [normalizedEmail]);
    if (approvedUser) {
      evaluation.status = 'Approved';
      evaluation.role = approvedUser.role;
    }

    if (evaluation.status !== 'Approved') {
      await db.run('INSERT INTO failed_logins (email, ip_address, reason) VALUES (?, ?, ?)', [normalizedEmail, ip, 'Account not pre-approved']);
      return res.status(403).json({
        error: JSON.stringify({
          code: 'USER_NOT_APPROVED',
          email: normalizedEmail,
          approvalStatus: 'Not Approved',
          adminContact: 'admin@cloudops-local.com',
          instructions: 'This account is not on the pre-approved user whitelist. Please request access from your administrator.'
        })
      });
    }

    let userRow = await db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);
    if (!userRow) {
      const tenantId = 'demo-org-001'; // Default tenant mapping for google users
      await db.run(`
        INSERT INTO users (id, email, display_name, role, tenant_id, provider, status)
        VALUES (?, ?, ?, ?, ?, 'Google', ?)
      `, [googleId, normalizedEmail, name || email.split('@')[0], evaluation.role, tenantId, evaluation.status]);
      userRow = await db.get('SELECT * FROM users WHERE id = ?', [googleId]);
    } else {
      if (userRow.status === 'Disabled') {
        await db.run('INSERT INTO failed_logins (email, ip_address, reason) VALUES (?, ?, ?)', [normalizedEmail, ip, 'User account disabled']);
        await db.run(`
          INSERT INTO login_history (user_id, email, ip_address, user_agent, status, reason, mfa_status)
          VALUES (?, ?, ?, ?, 'Failed', 'Account is disabled', 'Skipped')
        `, [userRow.id, normalizedEmail, ip, userAgent]);
        return res.status(403).json({ error: 'Access Denied: Account disabled.' });
      }
      await db.run('UPDATE users SET display_name = ? WHERE id = ?', [name || userRow.display_name, userRow.id]);
    }

    const sessionUser = {
      id: userRow.id,
      email: userRow.email,
      displayName: userRow.display_name,
      role: userRow.role,
      tenantId: userRow.tenant_id
    };

    const sessionId = await createSession(db, sessionUser, 'Google', req);

    // Write to login history
    await db.run(`
      INSERT INTO login_history (user_id, email, ip_address, user_agent, status, reason, mfa_status)
      VALUES (?, ?, ?, ?, 'Success', 'Approved and Authenticated', ?)
    `, [userRow.id, normalizedEmail, ip, userAgent, userRow.mfa_enabled ? 'Verified' : 'Skipped']);

    const tokenPayload = {
      oid: sessionUser.id,
      upn: sessionUser.email,
      name: sessionUser.displayName,
      roles: [sessionUser.role],
      tenantId: sessionUser.tenantId,
      sessionId
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });
    const refreshToken = jwt.sign({ sessionId }, REFRESH_SECRET, { expiresIn: '7d' });

    await logAudit(sessionUser.tenantId, sessionUser.id, sessionUser.email, 'LOGIN_SUCCESS', 'User', sessionUser.id, ip, 'SUCCESS', { provider: 'Google', userAgent });

    res.json({
      token,
      refreshToken,
      user: {
        id: sessionUser.id,
        email: sessionUser.email,
        displayName: sessionUser.displayName,
        role: sessionUser.role,
        provider: 'Google',
        organizationId: sessionUser.tenantId,
        status: userRow.status,
        mfaEnabled: !!userRow.mfa_enabled,
        lastLogin: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[AUTH ERROR] Google login failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3.5. Refresh Token Rotation
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    const db = await getDatabase();

    const session = await db.get('SELECT * FROM sessions WHERE session_id = ? AND revoked = 0', [decoded.sessionId]);
    if (!session) {
      return res.status(403).json({ error: 'Access Denied: Session revoked or not found.' });
    }

    const user = await db.get('SELECT * FROM users WHERE id = ?', [session.user_id]);
    if (!user || user.status !== 'Approved') {
      return res.status(403).json({ error: 'Access Denied: User account is not active.' });
    }

    // Rotate refresh token and update session
    const newSessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
    await db.run('UPDATE sessions SET revoked = 1 WHERE session_id = ?', [decoded.sessionId]);
    
    await db.run(`
      INSERT INTO sessions (session_id, user_id, email, provider, ip_address, user_agent, login_time, last_active, revoked)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 0)
    `, [newSessionId, user.id, user.email, session.provider, session.ip_address, session.user_agent, session.login_time]);

    const tokenPayload = {
      oid: user.id,
      upn: user.email,
      name: user.display_name,
      roles: [user.role],
      tenantId: user.tenant_id,
      sessionId: newSessionId
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '8h' });
    const newRefreshToken = jwt.sign({ sessionId: newSessionId }, REFRESH_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      refreshToken: newRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role,
        organizationId: user.tenant_id,
        status: user.status,
        mfaEnabled: !!user.mfa_enabled,
        lastLogin: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(403).json({ error: 'Invalid or expired refresh token.' });
  }
});

// 3.6. User status check (used by frontend to verify current account status)
router.get('/status', validateJwt, async (req, res) => {
  const db = await getDatabase();
  try {
    const user = await db.get('SELECT id, email, display_name, role, tenant_id, provider, status, mfa_enabled FROM users WHERE id = ?', [req.user.oid || req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found.' });
    }
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Session Verification & Revocation APIs
router.get('/sessions', validateJwt, adminOnly, async (req, res) => {
  const db = await getDatabase();
  try {
    const list = await db.all('SELECT * FROM sessions WHERE revoked = 0 ORDER BY login_time DESC');
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sessions/revoke', validateJwt, adminOnly, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }
  const db = await getDatabase();
  try {
    await db.run('UPDATE sessions SET revoked = 1 WHERE session_id = ?', [sessionId]);
    res.json({ success: true, message: 'Session successfully revoked' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Local Admin Password Management
router.post('/admin/change-password', validateJwt, adminOnly, async (req, res) => {
  const { email, currentPassword, newPassword } = req.body;
  if (!email || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const db = await getDatabase();
  try {
    const userRow = await db.get('SELECT * FROM users WHERE email = ? AND provider = "Local"', [email.toLowerCase()]);
    if (!userRow) {
      return res.status(404).json({ error: 'Local administrator not found' });
    }
    const isPasswordValid = await bcrypt.compare(currentPassword, userRow.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid current password' });
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userRow.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/reset-password', validateJwt, adminOnly, async (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  const db = await getDatabase();
  try {
    const userRow = await db.get('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!userRow) {
      return res.status(404).json({ error: 'User not found' });
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userRow.id]);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. User Management & Approval Portal Endpoints
router.get('/users', validateJwt, adminOnly, async (req, res) => {
  const db = await getDatabase();
  try {
    const list = await db.all('SELECT id, email, display_name, role, tenant_id, provider, last_login, status, mfa_enabled, created_at FROM users');
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/add', validateJwt, adminOnly, async (req, res) => {
  const { email, displayName, role, tenantId, provider } = req.body;
  const db = await getDatabase();
  try {
    const normalizedEmail = email.toLowerCase();
    
    // Put into approved list as well
    await db.run('INSERT OR IGNORE INTO approved_users (email, provider, role, added_by) VALUES (?, ?, ?, ?)', [normalizedEmail, provider || 'Local', role, 'System Administrator']);
    
    const userId = Math.random().toString(36).substring(2) + Date.now().toString(36);
    await db.run(`
      INSERT INTO users (id, email, display_name, role, tenant_id, provider, status)
      VALUES (?, ?, ?, ?, ?, ?, 'Approved')
    `, [userId, normalizedEmail, displayName, role, tenantId || 'demo-org-001', provider || 'Local']);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/approve', validateJwt, adminOnly, async (req, res) => {
  const { userId } = req.body;
  const db = await getDatabase();
  try {
    const user = await db.get('SELECT email, role FROM users WHERE id = ?', [userId]);
    if (user) {
      await db.run('UPDATE users SET status = "Approved" WHERE id = ?', [userId]);
      await db.run('INSERT OR IGNORE INTO approved_users (email, provider, role, added_by) VALUES (?, "System", ?, "Admin Approval")', [user.email, user.role]);
      await logAudit(req.tenantId, req.userId, req.userEmail, 'USER_APPROVED', 'User', userId, req.ip, 'SUCCESS', { approvedEmail: user.email });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/deactivate', validateJwt, adminOnly, async (req, res) => {
  const { userId } = req.body;
  const db = await getDatabase();
  try {
    await db.run('UPDATE users SET status = "Disabled" WHERE id = ?', [userId]);
    // Revoke all active sessions for this user
    await db.run('UPDATE sessions SET revoked = 1 WHERE user_id = ?', [userId]);
    await logAudit(req.tenantId, req.userId, req.userEmail, 'USER_DEACTIVATED', 'User', userId, req.ip, 'SUCCESS');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/update-role', validateJwt, adminOnly, async (req, res) => {
  const { userId, role } = req.body;
  const db = await getDatabase();
  try {
    const user = await db.get('SELECT email, role FROM users WHERE id = ?', [userId]);
    if (user) {
      // Prevent non-SuperAdmins from assigning SuperAdmin
      if (role === 'SuperAdmin' && req.userRole !== 'SuperAdmin') {
        return res.status(403).json({ error: 'Access Denied: Only SuperAdmin can assign SuperAdmin role.' });
      }

      await db.run('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
      await db.run('UPDATE approved_users SET role = ? WHERE email = ?', [role, user.email]);
      await logAudit(req.tenantId, req.userId, req.userEmail, 'USER_ROLE_UPDATED', 'User', userId, req.ip, 'SUCCESS', { oldRole: user.role, newRole: role });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/toggle-mfa', validateJwt, async (req, res) => {
  const { mfaEnabled } = req.body;
  const db = await getDatabase();
  try {
    await db.run('UPDATE users SET mfa_enabled = ? WHERE id = ?', [mfaEnabled ? 1 : 0, req.user.oid || req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/remove', validateJwt, adminOnly, async (req, res) => {
  const { userId } = req.body;
  const db = await getDatabase();
  try {
    const user = await db.get('SELECT email FROM users WHERE id = ?', [userId]);
    if (user) {
      await db.run('DELETE FROM approved_users WHERE email = ?', [user.email]);
    }
    await db.run('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6.5. Get Login History & Failed Logins (For Audit Reports)
router.get('/login-history', validateJwt, adminOnly, async (req, res) => {
  const db = await getDatabase();
  try {
    const list = await db.all('SELECT * FROM login_history ORDER BY login_time DESC LIMIT 100');
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Security Dashboard Data
router.get('/security-stats', validateJwt, adminOnly, async (req, res) => {
  const db = await getDatabase();
  try {
    const totalUsers = await db.get('SELECT COUNT(*) as count FROM users');
    const activeUsers = await db.get("SELECT COUNT(DISTINCT user_id) as count FROM sessions WHERE last_active > datetime('now', '-1 day') AND revoked = 0");
    const failedLogins = await db.get('SELECT COUNT(*) as count FROM failed_logins');
    const lockedAccounts = await db.get('SELECT COUNT(*) as count FROM users WHERE status = "Disabled"');
    const pendingApprovals = await db.get('SELECT COUNT(*) as count FROM users WHERE status = "Pending Approval"');
    const sessionCount = await db.get('SELECT COUNT(*) as count FROM sessions WHERE revoked = 0');

    res.json({
      totalUsers: totalUsers.count,
      activeUsers: activeUsers.count,
      failedLogins: failedLogins.count,
      lockedAccounts: lockedAccounts.count,
      pendingApprovals: pendingApprovals.count,
      sessionCount: sessionCount.count
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
