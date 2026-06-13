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

  // Check if seeding is needed
  const tenantCheck = await db.get('SELECT COUNT(*) as count FROM tenants');
  if (tenantCheck.count === 0) {
    console.log('[DB] Seeding database with secure local administrator...');
    await seedDefaultAdmin(db);
  }

  // Seed default Azure subscription from environment if configured
  const subCheck = await db.get('SELECT COUNT(*) as count FROM azure_subscriptions');
  if (subCheck.count === 0 && process.env.AZURE_SUBSCRIPTION_ID) {
    console.log('[DB] Seeding Azure subscription from environment variables...');
    await db.run(`
      INSERT INTO azure_subscriptions (id, tenant_id, subscription_id, name, client_id, client_secret, azure_tenant_id, auth_type, status)
      VALUES (?, 'demo-org-001', ?, ?, ?, ?, ?, 'CREDENTIALS', 'Active')
    `, [
      'sub-default-prod',
      process.env.AZURE_SUBSCRIPTION_ID,
      'Azure Enterprise Subscription',
      process.env.AZURE_CLIENT_ID || null,
      process.env.AZURE_CLIENT_SECRET || null,
      process.env.AZURE_TENANT_ID || null
    ]);
  }

  return db;
}

async function seedDefaultAdmin(database) {
  // Seed Admin Tenant
  await database.run(`
    INSERT INTO tenants (id, name) 
    VALUES ('demo-org-001', 'CloudOps Enterprise Platform')
  `);

  // Seed Single Administrator
  const passwordHash = process.env.LOCAL_ADMIN_PASSWORD_HASH;

  await database.run(`
    INSERT INTO users (id, email, display_name, role, tenant_id, password_hash)
    VALUES ('local-admin-001', 'admin@cloudops-local.com', 'System Administrator', 'OWNER', 'demo-org-001', ?)
  `, [passwordHash]);
}

module.exports = {
  getDatabase
};
