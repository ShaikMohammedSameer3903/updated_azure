// ============================================================
// MSAL Authentication Configuration
// Microsoft Entra ID OAuth 2.0 / OpenID Connect
// Single source of truth — imported by msalInstance.ts and AuthProvider
// ============================================================

import { LogLevel } from '@azure/msal-browser';
import type { Configuration, PopupRequest } from '@azure/msal-browser';

const clientId = import.meta.env.VITE_AZURE_CLIENT_ID || '00000000-0000-0000-0000-000000000000';
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID || 'common';

// The main redirect URI — must be registered in Azure App Registration as a SPA
const redirectUri = window.location.origin;

/**
 * Dedicated popup redirect page with MSAL v5 redirect bridge.
 * The bridge script (msal-redirect-bridge.min.js) is copied from:
 *   node_modules/@azure/msal-browser/lib/redirect-bridge/msal-redirect-bridge.min.js
 * to the public/ folder so Vite serves it as a static asset.
 *
 * IMPORTANT: Register BOTH URIs in Azure App Registration → Authentication → SPA:
 *   Development:  http://localhost:5173  (main)
 *   Development:  http://localhost:5173/auth-redirect.html  (popup)
 *   Production:   https://<your-domain>  (main)
 *   Production:   https://<your-domain>/auth-redirect.html  (popup)
 */
export const popupRedirectUri = `${window.location.origin}/auth-redirect.html`;

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri,
    postLogoutRedirectUri: `${redirectUri}/login`,
    navigateToLoginRequestUrl: false,
  } as any,
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  } as any,
  system: {
    loggerOptions: {
      loggerCallback: (level: LogLevel, message: string, containsPii: boolean) => {
        if (containsPii) return;
        switch (level) {
          case LogLevel.Error:
            console.error('[MSAL]', message);
            break;
          case LogLevel.Warning:
            console.warn('[MSAL]', message);
            break;
          default:
            break;
        }
      },
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false,
    },
    allowNativeBroker: false,
  } as any,
};

// Scopes for Microsoft Graph (user profile)
export const graphScopes = [
  'User.Read',
  'openid',
  'profile',
  'email',
];

// Scopes for Azure Management API
export const azureManagementScopes = [
  'https://management.azure.com/user_impersonation',
];

/**
 * Login request: uses the dedicated popup redirect page to avoid
 * block_nested_popups errors that occur when the redirect lands back
 * on the full React app.
 */
export const loginRequest: PopupRequest = {
  scopes: [...graphScopes],
  prompt: 'select_account',
  redirectUri: popupRedirectUri,
};

// Token request for Azure Management API
export const azureTokenRequest = {
  scopes: azureManagementScopes,
  redirectUri: popupRedirectUri,
};

// Token request for Microsoft Graph
export const graphTokenRequest = {
  scopes: graphScopes,
  redirectUri: popupRedirectUri,
};

// App roles defined in the Entra ID App Registration manifest
export const appRoles = {
  OWNER: 'Platform.Owner',
  ADMIN: 'Platform.Admin',
  OPERATOR: 'Platform.Operator',
  VIEWER: 'Platform.Viewer',
  AUDITOR: 'Platform.Auditor',
} as const;

// Whether the app is running without a real Azure Client ID
export const isDemoMode = !import.meta.env.VITE_AZURE_CLIENT_ID ||
  import.meta.env.VITE_AZURE_CLIENT_ID === '00000000-0000-0000-0000-000000000000';
