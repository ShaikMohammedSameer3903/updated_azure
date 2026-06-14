// ============================================================
// Resource Discovery Engine — LIVE Azure API + Resiliency
// ============================================================

const { getDatabase } = require('../db/database');
const { getAzureClients, executeWithRetry } = require('./azureCredentialManager');

let schedulerInterval = null;

/**
 * Start background scheduler scanning all subscriptions periodically
 */
function startDiscoveryScheduler() {
  if (schedulerInterval) return;

  console.log('[DISCOVERY] Background discovery scanner started (60s interval).');
  schedulerInterval = setInterval(async () => {
    try {
      const db = await getDatabase();
      const subs = await db.all('SELECT * FROM azure_subscriptions');
      for (const sub of subs) {
        try {
          console.log(`[DISCOVERY] Scanning resources for subscription: ${sub.name} (${sub.subscription_id})`);
          await discoverAllResources(sub.tenant_id, sub.id);
          
          // Broadcast updates via SSE
          const { broadcastSSE } = require('./notificationService');
          broadcastSSE({ type: 'resource_discovered', data: { subscriptionId: sub.id } });
        } catch (subErr) {
          console.error(`[DISCOVERY ERROR] Failed scanning subscription ${sub.name}:`, subErr.message);
        }
      }
    } catch (err) {
      console.error('[DISCOVERY ERROR] Background scheduler failed:', err);
    }
  }, 60000);
}

/**
 * Triggers an immediate async scan for a subscription
 */
function triggerImmediateScan(tenantId, subscriptionId) {
  console.log(`[DISCOVERY] Triggering immediate resource scan for subscription: ${subscriptionId}`);
  discoverAllResources(tenantId, subscriptionId)
    .then(() => {
      const { broadcastSSE } = require('./notificationService');
      broadcastSSE({ type: 'resource_discovered', data: { subscriptionId } });
    })
    .catch(err => console.error('[DISCOVERY] Immediate scan failed:', err));
}

/**
 * Discover and cache all resources under a specific subscription.
 */
async function discoverAllResources(tenantId, subscriptionId, userAccessToken = null) {
  const db = await getDatabase();
  const sub = await db.get(
    'SELECT * FROM azure_subscriptions WHERE tenant_id = ? AND (id = ? OR subscription_id = ?)',
    [tenantId, subscriptionId, subscriptionId]
  );
  if (!sub) throw new Error(`Subscription ${subscriptionId} not found`);

  const clients = await getAzureClients(tenantId, sub.id, userAccessToken);
  const resourceClient = clients.resourceClient;
  const discoveredList = [];

  await db.run('BEGIN TRANSACTION');

  const discoveredIds = [];

  try {
    // Wrap pager query in execution retry policy to handle Azure API throttling
    const listResourcesCall = () => {
      const list = [];
      return new Promise(async (resolve, reject) => {
        try {
          const pager = resourceClient.resources.list();
          for await (const resource of pager) {
            list.push(resource);
          }
          resolve(list);
        } catch (err) {
          reject(err);
        }
      });
    };

    const resourcesList = await executeWithRetry(listResourcesCall);

    for (const resource of resourcesList) {
      const resourceId = resource.id;
      const parsedType = resource.type;
      const name = resource.name;
      const location = resource.location || 'global';
      const tags = resource.tags ? JSON.stringify(resource.tags) : '{}';

      const rgMatch = resourceId.match(/\/resourceGroups\/([^/]+)/i);
      const resourceGroup = rgMatch ? rgMatch[1] : 'Unknown';

      let status = 'Active';
      let rawPayload = {
        sku: resource.sku,
        plan: resource.plan,
        kind: resource.kind
      };

      if (resource.properties) {
        if (resource.properties.provisioningState) {
          status = resource.properties.provisioningState;
        }
        rawPayload = { ...rawPayload, ...resource.properties };
      }

      // Enriched metadata
      const owner = resource.tags?.Owner || resource.tags?.owner || 'Unassigned';
      const lastModified = resource.properties?.lastModifiedDate || new Date().toISOString();
      
      // Calculate a dynamic risk score
      let riskScore = 0;
      if (!resource.tags || Object.keys(resource.tags).length === 0) {
        riskScore += 25; // No tags
      } else {
        if (!resource.tags.Environment && !resource.tags.environment) riskScore += 10;
        if (!resource.tags.Owner && !resource.tags.owner) riskScore += 10;
      }
      
      if (parsedType.toLowerCase().includes('virtualmachines') && status !== 'Running') {
        riskScore += 15;
      }
      if (parsedType.toLowerCase().includes('storageaccounts') && rawPayload.allowBlobPublicAccess === true) {
        riskScore += 30; // Public Storage Account risk
      }
      riskScore = Math.min(100, riskScore);

      let healthStatus = 'Healthy';
      if (riskScore >= 50) healthStatus = 'Critical';
      else if (riskScore >= 20) healthStatus = 'Warning';

      // Advanced Detection Checks (Drift, Orphaned, Idle)
      let driftDetected = 0;
      let orphanedDetected = 0;
      let idleDetected = 0;

      // 1. Tag Compliance Drift Check
      if (!resource.tags || !resource.tags.Environment || !resource.tags.Owner) {
        driftDetected = 1;
      }

      // 2. Orphaned Resource Checks
      if (parsedType.toLowerCase().includes('publicipaddresses') && !rawPayload.ipConfiguration) {
        orphanedDetected = 1;
      }
      if (parsedType.toLowerCase().includes('disks') && rawPayload.diskState === 'Unattached') {
        orphanedDetected = 1;
      }

      // 3. Idle Resource Checks (VMs stopped or deallocated, storage inactive)
      if (parsedType.toLowerCase().includes('virtualmachines') && status === 'Stopped') {
        idleDetected = 1;
      }

      let costImpact = parsedType.toLowerCase().includes('virtualmachines') ? 80 : 15;

      await db.run(`
        INSERT INTO resources (
          id, subscription_id, resource_group, name, type, location, status, tags, raw_payload, 
          owner, last_modified, cost_impact, risk_score, health_status, last_discovered_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          status = excluded.status,
          tags = excluded.tags,
          raw_payload = excluded.raw_payload,
          owner = excluded.owner,
          last_modified = excluded.last_modified,
          cost_impact = excluded.cost_impact,
          risk_score = excluded.risk_score,
          health_status = excluded.health_status,
          last_discovered_at = CURRENT_TIMESTAMP
      `, [
        resourceId,
        sub.id,
        resourceGroup,
        name,
        parsedType,
        location,
        status,
        tags,
        JSON.stringify(rawPayload),
        owner,
        lastModified,
        costImpact,
        riskScore,
        healthStatus
      ]);

      discoveredIds.push(resourceId);
      discoveredList.push({
        id: resourceId,
        subscription_id: sub.id,
        resource_group: resourceGroup,
        name,
        type: parsedType,
        location,
        status,
        tags: resource.tags || {},
        raw_payload: rawPayload,
        owner,
        last_modified: lastModified,
        cost_impact: costImpact,
        risk_score: riskScore,
        health_status: healthStatus,
        driftDetected,
        orphanedDetected,
        idleDetected
      });
    }

    // Remove stale resources no longer in Azure
    if (discoveredIds.length > 0) {
      const placeholders = discoveredIds.map(() => '?').join(',');
      await db.run(`
        DELETE FROM resources
        WHERE subscription_id = ? AND id NOT IN (${placeholders})
      `, [sub.id, ...discoveredIds]);
    } else {
      await db.run('DELETE FROM resources WHERE subscription_id = ?', [sub.id]);
    }

    await db.run('COMMIT');

    // Write audit log
    await db.run(`
      INSERT INTO audit_logs (tenant_id, user_id, user_email, action, resource_type, resource_id, details)
      VALUES (?, 'system', 'discovery-engine@cloudops.internal', 'DISCOVER_RESOURCES', 'AzureSubscription', ?, ?)
    `, [tenantId, sub.id, JSON.stringify({ count: discoveredList.length })]);

    return discoveredList;
  } catch (error) {
    await db.run('ROLLBACK');
    console.error(`[DISCOVERY] Failed for subscription ${subscriptionId}:`, error);
    throw error;
  }
}

/**
 * Discover resources filtered by a specific Resource Group.
 */
async function discoverResourcesByGroup(tenantId, subscriptionId, resourceGroup) {
  const db = await getDatabase();
  const sub = await db.get(
    'SELECT * FROM azure_subscriptions WHERE tenant_id = ? AND (id = ? OR subscription_id = ?)',
    [tenantId, subscriptionId, subscriptionId]
  );
  if (!sub) throw new Error(`Subscription ${subscriptionId} not found`);

  const clients = await getAzureClients(tenantId, sub.id);
  const resourceClient = clients.resourceClient;

  const resources = [];
  const pager = resourceClient.resources.listByResourceGroup(resourceGroup);

  for await (const resource of pager) {
    const rgMatch = resource.id.match(/\/resourceGroups\/([^/]+)/i);
    const rg = rgMatch ? rgMatch[1] : resourceGroup;

    let status = 'Active';
    let rawPayload = { sku: resource.sku, plan: resource.plan, kind: resource.kind };
    if (resource.properties?.provisioningState) {
      status = resource.properties.provisioningState;
      rawPayload = { ...rawPayload, ...resource.properties };
    }

    resources.push({
      id: resource.id,
      subscription_id: sub.id,
      resource_group: rg,
      name: resource.name,
      type: resource.type,
      location: resource.location || 'global',
      status,
      tags: resource.tags || {},
      raw_payload: rawPayload
    });
  }

  return resources;
}

/**
 * List all Resource Groups for a subscription with resource counts.
 */
async function listResourceGroupsWithCounts(tenantId, subscriptionId, userAccessToken = null) {
  const db = await getDatabase();
  const sub = await db.get(
    'SELECT * FROM azure_subscriptions WHERE tenant_id = ? AND (id = ? OR subscription_id = ?)',
    [tenantId, subscriptionId, subscriptionId]
  );
  if (!sub) throw new Error(`Subscription ${subscriptionId} not found`);

  const groups = [];
  try {
    const clients = await getAzureClients(tenantId, sub.id, userAccessToken);
    const resourceClient = clients.resourceClient;

    const pager = resourceClient.resourceGroups.list();

    for await (const rg of pager) {
      groups.push({
        id: rg.id,
        name: rg.name,
        location: rg.location,
        provisioningState: rg.properties?.provisioningState || 'Succeeded',
        tags: rg.tags || {}
      });
    }

    const counts = await db.all(
      'SELECT resource_group, COUNT(*) as count FROM resources WHERE subscription_id = ? GROUP BY resource_group',
      [sub.id]
    );
    const countMap = {};
    counts.forEach(c => { countMap[c.resource_group] = c.count; });

    return groups.map(rg => ({
      ...rg,
      resourceCount: countMap[rg.name] || 0
    }));
  } catch (err) {
    if (err.code === 'DEMO_MODE' || err.message?.includes('DEMO_MODE') || err.message?.includes('No real Azure credentials')) {
      const counts = await db.all(
        'SELECT resource_group, COUNT(*) as count FROM resources WHERE subscription_id = ? GROUP BY resource_group',
        [sub.id]
      );
      return counts.map(c => ({
        id: `/subscriptions/${sub.subscription_id || subscriptionId}/resourceGroups/${c.resource_group}`,
        name: c.resource_group,
        location: 'southeastasia',
        provisioningState: 'Succeeded',
        tags: { Environment: sub.name?.includes('Healthcare') ? 'Healthcare' : 'University' },
        resourceCount: c.count
      }));
    }
    throw err;
  }
}

module.exports = {
  discoverAllResources,
  discoverResourcesByGroup,
  listResourceGroupsWithCounts,
  startDiscoveryScheduler,
  triggerImmediateScan
};
