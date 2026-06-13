// ============================================================
// Resource Management Actions Service - Production Grade
// ============================================================

const { getAzureClients } = require('./azureCredentialManager');
const { getDatabase } = require('../db/database');
const { broadcastSSE } = require('./notificationService');
const { createOperation, updateOperation, completeOperation, logOperation } = require('./operationService');

/**
 * Helper to poll VM status until it reaches the expected state
 */
async function pollVmStatus(computeClient, resourceGroup, vmName, expectedState, opId, maxRetries = 15) {
  for (let i = 0; i < maxRetries; i++) {
    const vm = await computeClient.virtualMachines.get(resourceGroup, vmName, { expand: 'instanceView' });
    const provisioningState = vm.provisioningState;
    
    // Check instanceView statuses
    const statuses = vm.instanceView?.statuses || [];
    const powerState = statuses.find(s => s.code?.startsWith('PowerState/'));
    const isTargetState = expectedState === 'Running' 
      ? powerState?.code === 'PowerState/running'
      : powerState?.code === 'PowerState/deallocated' || powerState?.code === 'PowerState/stopped';

    await logOperation(opId, `Azure Provisioning Status: ${provisioningState} | Power State: ${powerState?.code || 'Unknown'}`);

    if (provisioningState === 'Succeeded' && isTargetState) {
      return vm;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Polling timeout: VM ${vmName} did not reach ${expectedState} within limits.`);
}

/**
 * VM Power cycle & lifecycle actions
 */
async function executeVmAction(tenantId, subscriptionId, resourceId, action, userEmail, userId) {
  const db = await getDatabase();
  const opId = 'OP-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const actionName = `VM ${action.toUpperCase()}: ${resourceId.split('/').pop()}`;

  await createOperation(opId, actionName, userEmail);

  try {
    // Stage 1: Validation
    await updateOperation(opId, 'Validation', 10, '12s');
    const resource = await db.get('SELECT * FROM resources WHERE id = ? AND subscription_id = ?', [resourceId, subscriptionId]);
    if (!resource) throw new Error('Resource not found in database.');
    
    const name = resource.name;
    const rgMatch = resourceId.match(/\/resourceGroups\/([^/]+)/i);
    const resourceGroup = rgMatch ? rgMatch[1] : 'Unknown';

    await updateOperation(opId, 'Validation Complete', 25, '10s');

    // Stage 2: Azure Authentication
    await updateOperation(opId, 'Azure Authentication', 40, '8s');
    const clients = await getAzureClients(tenantId, subscriptionId);
    await updateOperation(opId, 'Azure Authentication Complete', 55, '6s');

    // Stage 3: Deployment Submitted
    await updateOperation(opId, 'Deployment Submitted', 70, '4s');
    const computeClient = clients.computeClient;
    let finalStatus = 'Unknown';
    let resultMsg = '';

    // Stage 4: Azure Provisioning
    await updateOperation(opId, 'Azure Provisioning', 85, '2s');

    if (action === 'start') {
      await computeClient.virtualMachines.beginStartAndWait(resourceGroup, name);
      await pollVmStatus(computeClient, resourceGroup, name, 'Running', opId);
      finalStatus = 'Running';
      resultMsg = `VM ${name} successfully started and running.`;
    } else if (action === 'stop' || action === 'deallocate') {
      await computeClient.virtualMachines.beginDeallocateAndWait(resourceGroup, name);
      await pollVmStatus(computeClient, resourceGroup, name, 'Stopped', opId);
      finalStatus = 'Stopped';
      resultMsg = `VM ${name} successfully stopped and deallocated.`;
    } else if (action === 'restart') {
      await computeClient.virtualMachines.beginRestartAndWait(resourceGroup, name);
      await pollVmStatus(computeClient, resourceGroup, name, 'Running', opId);
      finalStatus = 'Running';
      resultMsg = `VM ${name} successfully restarted.`;
    } else if (action === 'redeploy') {
      await computeClient.virtualMachines.beginRedeployAndWait(resourceGroup, name);
      await pollVmStatus(computeClient, resourceGroup, name, 'Running', opId);
      finalStatus = 'Running';
      resultMsg = `VM ${name} successfully redeployed.`;
    } else {
      throw new Error(`Unsupported action ${action}`);
    }

    await db.run('UPDATE resources SET status = ?, last_discovered_at = CURRENT_TIMESTAMP WHERE id = ?', [finalStatus, resourceId]);
    broadcastSSE({ type: 'resource_status', data: { resourceId, status: finalStatus } });

    await completeOperation(opId, 'Succeeded');
    return { success: true, message: resultMsg, status: finalStatus, operationId: opId };
  } catch (error) {
    console.error(`[ACTIONS] VM action ${action} failed:`, error.message);
    await completeOperation(opId, 'Failed', error.message);
    throw error;
  }
}

/**
 * Storage Account operations
 */
async function executeStorageAction(tenantId, subscriptionId, resourceId, action, userEmail, userId) {
  const db = await getDatabase();
  const opId = 'OP-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const actionName = `Storage Action: ${action} on ${resourceId.split('/').pop()}`;

  await createOperation(opId, actionName, userEmail);

  try {
    await updateOperation(opId, 'Validation', 20, '10s');
    const resource = await db.get('SELECT * FROM resources WHERE id = ? AND subscription_id = ?', [resourceId, subscriptionId]);
    if (!resource) throw new Error('Resource not found.');

    const name = resource.name;
    const rgMatch = resourceId.match(/\/resourceGroups\/([^/]+)/i);
    const resourceGroup = rgMatch ? rgMatch[1] : 'Unknown';

    await updateOperation(opId, 'Azure Authentication', 50, '5s');
    const clients = await getAzureClients(tenantId, subscriptionId);

    await updateOperation(opId, 'Azure Provisioning', 80, '2s');
    const storageClient = clients.storageClient;
    let message = '';

    if (action === 'disable-public') {
      await storageClient.storageAccounts.update(resourceGroup, name, { allowBlobPublicAccess: false });
      message = `Public access disabled on Storage Account ${name}.`;
    } else if (action === 'enable-public') {
      await storageClient.storageAccounts.update(resourceGroup, name, { allowBlobPublicAccess: true });
      message = `Public access enabled on Storage Account ${name}.`;
    } else if (action === 'rotate-keys') {
      await storageClient.storageAccounts.regenerateKey(resourceGroup, name, { keyName: 'key1' });
      message = `Access keys rotated successfully for Storage Account ${name}.`;
    } else {
      throw new Error(`Unsupported storage action: ${action}`);
    }

    await completeOperation(opId, 'Succeeded');
    return { success: true, message, operationId: opId };
  } catch (error) {
    await completeOperation(opId, 'Failed', error.message);
    throw error;
  }
}

/**
 * App Service operations
 */
async function executeAppServiceAction(tenantId, subscriptionId, resourceId, action, userEmail, userId) {
  const db = await getDatabase();
  const opId = 'OP-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const actionName = `App Service ${action.toUpperCase()}: ${resourceId.split('/').pop()}`;

  await createOperation(opId, actionName, userEmail);

  try {
    await updateOperation(opId, 'Validation', 20, '10s');
    const resource = await db.get('SELECT * FROM resources WHERE id = ? AND subscription_id = ?', [resourceId, subscriptionId]);
    if (!resource) throw new Error('Resource not found.');

    const name = resource.name;

    await updateOperation(opId, 'Azure Authentication', 50, '5s');
    const clients = await getAzureClients(tenantId, subscriptionId);

    await updateOperation(opId, 'Azure Provisioning', 80, '2s');
    const genericClient = clients.resourceClient;
    const apiVersion = '2022-03-01';

    if (action === 'start') {
      await genericClient.resources.post(resourceId, apiVersion, 'start');
    } else if (action === 'stop') {
      await genericClient.resources.post(resourceId, apiVersion, 'stop');
    } else if (action === 'restart') {
      await genericClient.resources.post(resourceId, apiVersion, 'restart');
    } else {
      throw new Error(`Unsupported App Service action: ${action}`);
    }

    await completeOperation(opId, 'Succeeded');
    return { success: true, message: `App Service ${name} successfully ${action}ed.`, operationId: opId };
  } catch (error) {
    await completeOperation(opId, 'Failed', error.message);
    throw error;
  }
}

/**
 * Resource Group Locks & Deletion
 */
async function executeResourceGroupAction(tenantId, subscriptionId, resourceId, action, userEmail, userId) {
  const db = await getDatabase();
  const opId = 'OP-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  const actionName = `Resource Group ${action.toUpperCase()}: ${resourceId.split('/').pop()}`;

  await createOperation(opId, actionName, userEmail);

  try {
    await updateOperation(opId, 'Validation', 20, '10s');
    const rgMatch = resourceId.match(/\/resourceGroups\/([^/]+)/i);
    const resourceGroup = rgMatch ? rgMatch[1] : 'Unknown';

    await updateOperation(opId, 'Azure Authentication', 50, '5s');
    const clients = await getAzureClients(tenantId, subscriptionId);

    await updateOperation(opId, 'Azure Provisioning', 80, '2s');
    const resourceClient = clients.resourceClient;

    if (action === 'lock') {
      await resourceClient.managementLocks.createOrUpdateAtResourceGroupLevel(resourceGroup, 'ReadOnlyLock', {
        level: 'ReadOnly',
        notes: `Locked by CloudOps Portal - User ${userEmail}`
      });
    } else if (action === 'unlock') {
      await resourceClient.managementLocks.deleteAtResourceGroupLevel(resourceGroup, 'ReadOnlyLock');
    } else if (action === 'delete') {
      await resourceClient.resourceGroups.beginDeleteAndWait(resourceGroup);
      await db.run('DELETE FROM resources WHERE resource_group = ? AND subscription_id = ?', [resourceGroup, subscriptionId]);
    } else {
      throw new Error(`Unsupported resource group action: ${action}`);
    }

    await completeOperation(opId, 'Succeeded');
    return { success: true, message: `Resource Group ${resourceGroup} successfully ${action}ed.`, operationId: opId };
  } catch (error) {
    await completeOperation(opId, 'Failed', error.message);
    throw error;
  }
}

module.exports = {
  executeVmAction,
  executeStorageAction,
  executeAppServiceAction,
  executeResourceGroupAction
};
