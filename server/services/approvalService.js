// ============================================================
// User Approval Service — Domain Whitelist and Auto-approvals
// ============================================================

const PLATFORM_OWNER_EMAILS = [
  'owner@company.com',
  'admin@company.com',
  'admin@cloudops-local.com',
];

// Organization domains — users from these domains are auto-approved
const ORGANIZATION_DOMAINS = [
  'company.com',
  'kluniversity.in',
];

// External/consumer domains — require explicit approval via approved_users table
// These users are NOT auto-approved by domain but CAN be approved by email via
// the approved_users table in the database (seeded at startup).
const EXTERNAL_DOMAINS = [
  'gmail.com',
  'outlook.com',
  'outlook.in',
  'hotmail.com',
  'yahoo.com',
  'yahoo.co.in',
  'live.com',
];

/**
 * Evaluates registration eligibility, role assignment, and approval state based on email.
 * Note: The approved_users table in the DB overrides this evaluation when a match is found.
 * @param {string} email
 * @returns {{ role: string, status: string }}
 */
function evaluateUserApproval(email) {
  if (!email) {
    return { role: 'Reader', status: 'Pending Approval' };
  }

  const normalizedEmail = email.toLowerCase().trim();

  // 1. Check Platform Owner Emails (always SuperAdmin, always approved)
  if (PLATFORM_OWNER_EMAILS.includes(normalizedEmail)) {
    return { role: 'SuperAdmin', status: 'Approved' };
  }

  // Extract domain
  const domain = normalizedEmail.split('@')[1];
  if (!domain) {
    return { role: 'Reader', status: 'Pending Approval' };
  }

  // 2. Organization Domains — auto-approve as Operator
  if (ORGANIZATION_DOMAINS.includes(domain)) {
    return { role: 'Operator', status: 'Approved' };
  }

  // 3. External / consumer domains — require approved_users DB entry
  //    The auth routes check the DB AFTER calling this function and
  //    override status/role if the email is found in approved_users.
  return { role: 'Reader', status: 'Pending Approval' };
}

module.exports = {
  evaluateUserApproval,
  PLATFORM_OWNER_EMAILS,
  ORGANIZATION_DOMAINS,
  EXTERNAL_DOMAINS
};
