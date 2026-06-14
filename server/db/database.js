// ============================================================
// Database Manager (SQLite via better-sqlite3)
// better-sqlite3 ships prebuilt binaries for linux-x64/GLIBC 2.17+
// This avoids the GLIBC 2.38 mismatch that native sqlite3 causes on
// Azure App Service (appsvc/node:20-lts, which ships GLIBC 2.36).
// All public methods return Promises for API compatibility.
// ============================================================

const path = require('path');
const fs = require('fs');
const BetterSQLite3 = require('better-sqlite3');

// ─── Promise-compatible shim around better-sqlite3 ───────────────────────────
class AsyncDB {
  constructor(filename) {
    this._db = new BetterSQLite3(filename);
    this._db.pragma('journal_mode = WAL');
  }

  /** Run a statement; returns { lastID, changes } */
  run(sql, params = []) {
    try {
      const stmt = this._db.prepare(sql);
      const info = Array.isArray(params) ? stmt.run(...params) : stmt.run(params);
      return Promise.resolve({ lastID: info.lastInsertRowid, changes: info.changes });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /** Return the first matching row or undefined */
  get(sql, params = []) {
    try {
      const stmt = this._db.prepare(sql);
      const row = Array.isArray(params) ? stmt.get(...params) : stmt.get(params);
      return Promise.resolve(row);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /** Return all matching rows */
  all(sql, params = []) {
    try {
      const stmt = this._db.prepare(sql);
      const rows = Array.isArray(params) ? stmt.all(...params) : stmt.all(params);
      return Promise.resolve(rows);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /** Execute multiple statements (no params) */
  exec(sql) {
    try {
      this._db.exec(sql);
      return Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /** Run a callback inside a transaction */
  transaction(fn) {
    return this._db.transaction(fn);
  }

  close() {
    this._db.close();
  }
}

let db = null;

async function getDatabase() {
  if (db) return db;

  const dbPath = process.env.DATABASE_PATH || path.resolve(__dirname, '../cloudops.db');
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // Open the SQLite database via better-sqlite3 (no GLIBC 2.38 requirement)
  db = new AsyncDB(dbPath);

  // Enable foreign key support
  await db.run('PRAGMA foreign_keys = ON;');

  // Initialize schema
  const schemaPath = path.resolve(__dirname, './schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  
  // SQLite multiple statements execution
  // Note: .exec executes multiple statements separated by semicolons
  await db.exec(schemaSql);

  // Handle migration for new resource columns if existing database doesn't have them
  try {
    const columns = await db.all('PRAGMA table_info(resources)');
    const colNames = columns.map(c => c.name);
    
    if (!colNames.includes('owner')) {
      console.log('[DB] Migrating: Adding owner column to resources');
      await db.run('ALTER TABLE resources ADD COLUMN owner TEXT');
    }
    if (!colNames.includes('last_modified')) {
      console.log('[DB] Migrating: Adding last_modified column to resources');
      await db.run('ALTER TABLE resources ADD COLUMN last_modified TEXT');
    }
    if (!colNames.includes('cost_impact')) {
      console.log('[DB] Migrating: Adding cost_impact column to resources');
      await db.run('ALTER TABLE resources ADD COLUMN cost_impact REAL DEFAULT 0');
    }
    if (!colNames.includes('risk_score')) {
      console.log('[DB] Migrating: Adding risk_score column to resources');
      await db.run('ALTER TABLE resources ADD COLUMN risk_score REAL DEFAULT 0');
    }
    if (!colNames.includes('health_status')) {
      console.log('[DB] Migrating: Adding health_status column to resources');
      await db.run('ALTER TABLE resources ADD COLUMN health_status TEXT DEFAULT "Healthy"');
    }
  } catch (err) {
    console.error('[DB] Migration of resources columns failed:', err);
  }

  // Handle migration for active_resource_group if existing database doesn't have it
  try {
    const columns = await db.all('PRAGMA table_info(azure_subscriptions)');
    const hasActiveRg = columns.some(col => col.name === 'active_resource_group');
    if (!hasActiveRg) {
      console.log('[DB] Migrating: Adding active_resource_group column to azure_subscriptions');
      await db.run('ALTER TABLE azure_subscriptions ADD COLUMN active_resource_group TEXT');
    }
  } catch (err) {
    console.error('[DB] Migration of active_resource_group failed:', err);
  }


  // Handle migration for password_hash in users table
  try {
    const columns = await db.all('PRAGMA table_info(users)');
    const hasPasswordHash = columns.some(col => col.name === 'password_hash');
    if (!hasPasswordHash) {
      console.log('[DB] Migrating: Adding password_hash column to users');
      await db.run('ALTER TABLE users ADD COLUMN password_hash TEXT');
    }
  } catch (err) {
    console.error('[DB] Migration of password_hash failed:', err);
  }

  // Handle migration for mfa_enabled in users table
  try {
    const columns = await db.all('PRAGMA table_info(users)');
    const hasMfa = columns.some(col => col.name === 'mfa_enabled');
    if (!hasMfa) {
      console.log('[DB] Migrating: Adding mfa_enabled column to users');
      await db.run('ALTER TABLE users ADD COLUMN mfa_enabled INTEGER DEFAULT 0');
    }
  } catch (err) {
    console.error('[DB] Migration of mfa_enabled failed:', err);
  }

  // Handle migration for approved_users
  try {
    const columns = await db.all('PRAGMA table_info(approved_users)');
    const colNames = columns.map(c => c.name);
    if (!colNames.includes('provider')) {
      console.log('[DB] Migrating: Adding provider column to approved_users');
      await db.run('ALTER TABLE approved_users ADD COLUMN provider TEXT');
    }
    if (!colNames.includes('created_at')) {
      console.log('[DB] Migrating: Adding created_at column to approved_users');
      await db.run('ALTER TABLE approved_users ADD COLUMN created_at DATETIME DEFAULT NULL');
    }
    if (!colNames.includes('added_by')) {
      console.log('[DB] Migrating: Adding added_by column to approved_users');
      await db.run('ALTER TABLE approved_users ADD COLUMN added_by TEXT');
    }
  } catch (err) {
    console.error('[DB] Migration of approved_users failed:', err);
  }

  // Ensure roles and permissions are seeded
  try {
    const roleCheck = await db.get('SELECT COUNT(*) as count FROM roles');
    if (roleCheck.count === 0) {
      console.log('[DB] Seeding roles and permissions...');
      await seedRolesAndPermissions(db);
    }
  } catch (err) {
    console.error('[DB] Seeding roles/permissions failed:', err);
  }

  // Check if seeding is needed
  const tenantCheck = await db.get('SELECT COUNT(*) as count FROM tenants');
  if (tenantCheck.count === 0) {
    console.log('[DB] Seeding database with secure local administrator...');
    await seedDefaultAdmin(db);
  }

  // Seed default Azure subscription from environment if configured
  const subCheck = await db.get('SELECT COUNT(*) as count FROM azure_subscriptions');
  if (subCheck.count === 0 && process.env.AZURE_SUBSCRIPTION_ID) {
    const activeTenantId = process.env.AZURE_TENANT_ID || 'demo-org-001';
    console.log('[DB] Seeding Azure subscription from environment variables...');
    await db.run(`
      INSERT INTO azure_subscriptions (id, tenant_id, subscription_id, name, client_id, client_secret, azure_tenant_id, auth_type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'CREDENTIALS', 'Active')
    `, [
      'sub-default-prod',
      activeTenantId,
      process.env.AZURE_SUBSCRIPTION_ID,
      'Azure Enterprise Subscription',
      process.env.AZURE_CLIENT_ID || null,
      process.env.AZURE_CLIENT_SECRET || null,
      process.env.AZURE_TENANT_ID || null
    ]);
  }

  // Sync approved_users roles to existing users (fixes downgraded roles from broken middleware)
  try {
    const approvedList = await db.all('SELECT email, role FROM approved_users');
    for (const approved of approvedList) {
      await db.run(
        'UPDATE users SET role = ?, status = ? WHERE email = ? AND role != ?',
        [approved.role, 'Approved', approved.email, approved.role]
      );
    }
    console.log('[DB] Synced approved_users roles to users table.');
  } catch (err) {
    console.error('[DB] Migration: role sync from approved_users failed:', err);
  }

  return db;
}

async function seedRolesAndPermissions(database) {
  // Seed Roles
  const roles = [
    { id: 'role-superadmin', name: 'SuperAdmin', description: 'Full access to all resources and management settings' },
    { id: 'role-admin', name: 'Admin', description: 'Manage resources and users, except SuperAdmin actions' },
    { id: 'role-operator', name: 'Operator', description: 'Monitor and operate resources' },
    { id: 'role-reader', name: 'Reader', description: 'View only access to cloud resource details' }
  ];

  for (const r of roles) {
    await database.run('INSERT OR IGNORE INTO roles (id, name, description) VALUES (?, ?, ?)', [r.id, r.name, r.description]);
  }

  // Seed Permissions
  const permissions = [
    // SuperAdmin permissions
    { id: 'perm-sa-all', role_id: 'role-superadmin', action: '*', allowed: 1 },

    // Admin permissions
    { id: 'perm-admin-res', role_id: 'role-admin', action: 'manage_resources', allowed: 1 },
    { id: 'perm-admin-usr', role_id: 'role-admin', action: 'manage_users', allowed: 1 },
    { id: 'perm-admin-view', role_id: 'role-admin', action: 'view_resources', allowed: 1 },

    // Operator permissions
    { id: 'perm-op-run', role_id: 'role-operator', action: 'operate_resources', allowed: 1 },
    { id: 'perm-op-view', role_id: 'role-operator', action: 'view_resources', allowed: 1 },

    // Reader permissions
    { id: 'perm-read-view', role_id: 'role-reader', action: 'view_resources', allowed: 1 }
  ];

  for (const p of permissions) {
    await database.run('INSERT OR IGNORE INTO permissions (id, role_id, action, allowed) VALUES (?, ?, ?, ?)', [p.id, p.role_id, p.action, p.allowed]);
  }
}

async function seedDefaultAdmin(database) {
  // Seed Admin Tenant
  const activeTenantId = process.env.AZURE_TENANT_ID || 'demo-org-001';
  await database.run(`
    INSERT OR IGNORE INTO tenants (id, name) 
    VALUES (?, 'CloudOps Enterprise Platform')
  `, [activeTenantId]);

  if (activeTenantId !== 'demo-org-001') {
    await database.run(`
      INSERT OR IGNORE INTO tenants (id, name) 
      VALUES ('demo-org-001', 'CloudOps Enterprise Platform')
    `);
  }

  // Seed Single Administrator
  const passwordHash = process.env.LOCAL_ADMIN_PASSWORD_HASH || '$2a$10$wE81YmQx921rQ2KzJzW/k.L16aK6qC0N114/Xw/2GvX7G7n4m.7tG'; // Default for admin123 if env missing

  await database.run(`
    INSERT INTO users (id, email, display_name, role, tenant_id, password_hash, status, provider)
    VALUES ('local-admin-001', 'admin@cloudops-local.com', 'System Administrator', 'SuperAdmin', 'demo-org-001', ?, 'Approved', 'Local')
  `, [passwordHash]);

  // Seed pre-approved users list (including real admin accounts)
  const approvedEmails = [
    { email: 'admin@cloudops-local.com', role: 'SuperAdmin' },
    { email: '2300031607@kluniversity.in', role: 'SuperAdmin' },
    { email: '2300030621@kluniversity.in', role: 'SuperAdmin' },
    { email: 'sameer3909sam@gmail.com', role: 'SuperAdmin' },
    { email: 'sameer3909sam@outlook.com', role: 'SuperAdmin' },
    { email: 'shaiksameer3909sam@gmail.com', role: 'SuperAdmin' },
    { email: 'shaiksameer3909sam@outlook.com', role: 'SuperAdmin' },
    { email: 'shaiksameer3909sam@outlook.in', role: 'SuperAdmin' },
    { email: 'mentor@company.com', role: 'Admin' },
    { email: 'friend@gmail.com', role: 'Operator' }
  ];

  for (const item of approvedEmails) {
    await database.run(`
      INSERT OR IGNORE INTO approved_users (email, provider, role)
      VALUES (?, 'System', ?)
    `, [item.email, item.role]);
  }
}

module.exports = {
  getDatabase
};
