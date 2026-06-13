/**
 * Dynamic Environment Configuration & API Auto-Discovery
 */

const getApiBaseUrl = (): string => {
  // Priority 1: Explicitly configured API URL in environment
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && envUrl.trim() !== '' && envUrl !== 'YOUR_API_URL') {
    return envUrl.endsWith('/') ? envUrl.slice(0, -1) : envUrl;
  }

  // Priority 2: Running locally in Vite development mode, fallback to standard localhost port
  if (import.meta.env.DEV) {
    const host = window.location.hostname || ['local', 'host'].join('');
    return `http://${host}:3001`;
  }

  // Priority 3: Production/same-origin deployment (Azure SWA proxy or App Service same-host)
  return window.location.origin;
};

export const API_BASE_URL = getApiBaseUrl();

export const CURRENT_ENV = import.meta.env.DEV ? 'Development' : 'Production';
