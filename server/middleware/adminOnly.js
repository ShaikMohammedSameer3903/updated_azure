// ============================================================
// Secure Single-Administrator Authorization Middleware
// ============================================================

function adminOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized: Missing session credentials.' });
  }

  const role = req.userRole || (req.user.roles && req.user.roles[0]) || '';
  const email = req.userEmail || req.user.upn || req.user.email || '';
  const tenantId = req.tenantId || req.user.tid || req.user.tenantId || '';

  const isLocalAdmin = (
    email.toLowerCase() === 'admin@cloudops-local.com' &&
    tenantId === 'demo-org-001'
  );

  const isApprovedProdAdmin = (
    process.env.AZURE_MODE === 'production' &&
    process.env.APPROVED_ADMIN_EMAIL &&
    email.toLowerCase() === process.env.APPROVED_ADMIN_EMAIL.toLowerCase() &&
    process.env.APPROVED_TENANT_ID &&
    tenantId === process.env.APPROVED_TENANT_ID
  );

  const hasAdminRole = role.toUpperCase() === 'OWNER' || role.toUpperCase() === 'ADMIN';

  if ((isLocalAdmin || isApprovedProdAdmin) && hasAdminRole) {
    return next();
  }

  // Record security warning or failed auth in logs
  console.warn(`[SECURITY WARN] Unauthorized admin access attempt by User: ${email}, Tenant: ${tenantId}, Role: ${role}`);
  return res.status(403).json({ error: 'Forbidden: Access denied to unapproved accounts.' });
}

module.exports = adminOnly;
