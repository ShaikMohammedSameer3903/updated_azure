/* eslint-disable react-refresh/only-export-components */
// ============================================================
// Auth Provider - MSAL + Google + Local Admin Authentication
// ============================================================

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionRequiredAuthError, InteractionStatus, EventType } from '@azure/msal-browser';
import { loginRequest, popupRedirectUri } from '../config/msalConfig';
import type { User } from '../types';
import { api } from '../services/api';
import { useGoogleAuth } from './GoogleAuthProvider';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  msalRedirectError: string | null;
  login: (email?: string, password?: string, method?: 'popup' | 'redirect') => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => void;
  getAzureToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { instance, inProgress } = useMsal();
  const { googleLogin } = useGoogleAuth();

  const [user, setUser] = useState<User | null>(() => {
    try {
      const savedUser = localStorage.getItem('cloudops-local-user');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch { return null; }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('cloudops-local-token');
  });
  const [msalRedirectError, setMsalRedirectError] = useState<string | null>(null);

  // Track whether we already ran the initial MSAL session sync
  const hasSyncedRef = useRef(false);

  const isAuthenticated = !!token;

  // ── 1. Listen for MSAL login events to set active account ────────────────
  useEffect(() => {
    const callbackId = instance.addEventCallback((event) => {
      if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
        const account = (event.payload as any).account;
        if (account) {
          instance.setActiveAccount(account);
        }
      }
      if (event.eventType === EventType.ACQUIRE_TOKEN_FAILURE && event.error) {
        console.error('[AuthProvider] MSAL acquire token failure:', event.error);
      }
    });

    return () => {
      if (callbackId) instance.removeEventCallback(callbackId);
    };
  }, [instance]);

  // ── 2. Session sync — runs ONCE when MSAL interaction settles ───────────
  // We use a ref guard so this effect does NOT re-run when `token` changes.
  useEffect(() => {
    // Only run when MSAL is idle
    if (inProgress !== InteractionStatus.None) return;
    // Only run once per app load
    if (hasSyncedRef.current) return;
    hasSyncedRef.current = true;

    let cancelled = false;

    const syncSession = async () => {
      const activeAccount =
        instance.getActiveAccount() || (instance.getAllAccounts()[0] ?? null);

      if (activeAccount && !localStorage.getItem('cloudops-local-token')) {
        // We have an MSAL account but no local session token — exchange it
        setIsLoading(true);
        try {
          const result = await instance.acquireTokenSilent({
            ...loginRequest,
            account: activeAccount,
            redirectUri: popupRedirectUri,
          });

          if (result?.idToken && !cancelled) {
            const exchangeResponse = await fetch('/api/auth/entra-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                idToken:     result.idToken,
                email:       result.account.username,
                displayName: result.account.name || result.account.username,
                tenantId:    result.account.tenantId,
                oid:         result.account.localAccountId || result.account.homeAccountId,
              }),
            });

            if (exchangeResponse.ok) {
              const data = await exchangeResponse.json();
              localStorage.setItem('cloudops-local-token', data.token);
              if (data.refreshToken) localStorage.setItem('cloudops-local-refresh-token', data.refreshToken);
              localStorage.setItem('cloudops-local-user', JSON.stringify(data.user));
              if (!cancelled) {
                setToken(data.token);
                setUser(data.user);
                setMsalRedirectError(null);
              }
            } else {
              const errData = await exchangeResponse.json().catch(() => ({}));
              if (!cancelled) {
                setMsalRedirectError(errData.error || 'Access Denied: Pre-approval check failed.');
              }
            }
          }
        } catch (err: any) {
          if (!cancelled) {
            if (!(err instanceof InteractionRequiredAuthError)) {
              setMsalRedirectError(err.message || 'Failed to establish platform session.');
            }
            // InteractionRequiredAuthError = user must log in manually — that is OK
          }
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      } else {
        // Either already have a local token, or no MSAL account — just stop loading
        if (!cancelled) setIsLoading(false);
      }
    };

    syncSession();

    return () => { cancelled = true; };
  // Intentionally only depend on inProgress so this runs once MSAL settles
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inProgress]);

  // ── 3. Auto refresh token every 15 minutes ───────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) return;
    const interval = setInterval(async () => {
      const currentRefreshToken = localStorage.getItem('cloudops-local-refresh-token');
      if (!currentRefreshToken) return;
      try {
        const response = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: currentRefreshToken })
        });
        if (response.ok) {
          const data = await response.json();
          localStorage.setItem('cloudops-local-token', data.token);
          localStorage.setItem('cloudops-local-refresh-token', data.refreshToken || currentRefreshToken);
          localStorage.setItem('cloudops-local-user', JSON.stringify(data.user));
          setToken(data.token);
          setUser(data.user);
        }
      } catch (err) {
        console.error('[AuthProvider] Auto-refresh session failed:', err);
      }
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // ── 4. Login ─────────────────────────────────────────────────────────────
  const login = useCallback(async (email?: string, password?: string, method: 'popup' | 'redirect' = 'popup') => {
    setIsLoading(true);
    setMsalRedirectError(null);
    try {
      if (email && password) {
        // ── Local admin form login ──
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Invalid administrator credentials.');
        }
        const data = await response.json();
        localStorage.setItem('cloudops-local-token', data.token);
        if (data.refreshToken) localStorage.setItem('cloudops-local-refresh-token', data.refreshToken);
        localStorage.setItem('cloudops-local-user', JSON.stringify(data.user));
        setToken(data.token);
        setUser(data.user);
        return;
      }

      // ── Microsoft Entra ID login ──
      if (inProgress !== InteractionStatus.None) {
        throw new Error('Another sign-in is already in progress. Please wait a moment and try again.');
      }

      // Check if we already have an MSAL account cached — try silent first
      const activeAccount = instance.getActiveAccount() || (instance.getAllAccounts()[0] ?? null);
      if (activeAccount) {
        try {
          const result = await instance.acquireTokenSilent({
            ...loginRequest,
            account: activeAccount,
            redirectUri: popupRedirectUri,
          });
          if (result?.idToken) {
            instance.setActiveAccount(result.account);
            await exchangeEntraToken(result);
            return;
          }
        } catch (err) {
          if (!(err instanceof InteractionRequiredAuthError)) throw err;
          // Fall through to popup/redirect
        }
      }

      if (method === 'popup') {
        try {
          const result = await instance.loginPopup({
            ...loginRequest,
            prompt: 'select_account',
            redirectUri: popupRedirectUri,
          });

          if (result?.account && result.idToken) {
            instance.setActiveAccount(result.account);
            await exchangeEntraToken(result);
          }
        } catch (err: any) {
          // If popup was blocked or closed, don't fall back to redirect
          // (redirect causes a full page reload which resets all state)
          if (err?.errorCode === 'popup_window_error' || err?.errorCode === 'empty_window_error') {
            throw new Error('Popup was blocked by the browser. Please allow popups for this site.');
          }
          if (err?.errorCode === 'user_cancelled') {
            throw new Error('Sign-in was cancelled.');
          }
          throw err;
        }
      } else {
        await instance.loginRedirect({
          ...loginRequest,
          prompt: 'select_account',
          redirectUri: window.location.origin,
        });
      }
    } catch (error) {
      console.error('[AuthProvider] Login failed:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [instance, inProgress]);

  // Helper: exchange an MSAL token result for a local session
  const exchangeEntraToken = async (result: { idToken: string; account: any }) => {
    const exchangeResponse = await fetch('/api/auth/entra-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken:     result.idToken,
        email:       result.account.username,
        displayName: result.account.name || result.account.username,
        tenantId:    result.account.tenantId,
        oid:         result.account.localAccountId || result.account.homeAccountId,
      }),
    });

    if (!exchangeResponse.ok) {
      const errData = await exchangeResponse.json().catch(() => ({}));
      throw new Error(errData.error || 'Access Denied: Pre-approval check failed.');
    }

    const data = await exchangeResponse.json();
    localStorage.setItem('cloudops-local-token', data.token);
    if (data.refreshToken) localStorage.setItem('cloudops-local-refresh-token', data.refreshToken);
    localStorage.setItem('cloudops-local-user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    setMsalRedirectError(null);
  };

  // ── 5. Google login ───────────────────────────────────────────────────────
  const loginWithGoogle = useCallback(async () => {
    setIsLoading(true);
    try {
      const googleProfile = await googleLogin();

      const exchangeResponse = await fetch('/api/auth/google-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(googleProfile)
      });

      if (!exchangeResponse.ok) {
        const errData = await exchangeResponse.json().catch(() => ({}));
        throw new Error(errData.error || 'Access Denied: Google login failed validation.');
      }

      const data = await exchangeResponse.json();
      localStorage.setItem('cloudops-local-token', data.token);
      if (data.refreshToken) localStorage.setItem('cloudops-local-refresh-token', data.refreshToken);
      localStorage.setItem('cloudops-local-user', JSON.stringify(data.user));
      setToken(data.token);
      setUser(data.user);
    } catch (error) {
      console.error('[AuthProvider] Google login failed:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [googleLogin]);

  // ── 6. Logout ─────────────────────────────────────────────────────────────
  const logout = useCallback(() => {
    localStorage.clear();
    sessionStorage.clear();
    setToken(null);
    setUser(null);
    hasSyncedRef.current = false; // Allow re-sync after re-login

    if (instance.getAllAccounts().length > 0) {
      instance.logoutRedirect({
        postLogoutRedirectUri: window.location.origin + '/login',
        account: instance.getActiveAccount() || instance.getAllAccounts()[0]
      }).catch((err) => {
        console.error('[AuthProvider] MSAL logoutRedirect failed:', err);
        window.location.href = '/login';
      });
    } else {
      window.location.href = '/login';
    }
  }, [instance]);

  // ── 7. Get current token for API calls ───────────────────────────────────
  const getAzureToken = useCallback(async (): Promise<string | null> => {
    if (user?.provider === 'Microsoft') {
      try {
        const activeAccount = instance.getActiveAccount() || instance.getAllAccounts()[0];
        if (activeAccount) {
          const result = await instance.acquireTokenSilent({
            scopes: ['https://management.azure.com/user_impersonation'],
            account: activeAccount,
          });
          return result?.accessToken || null;
        }
      } catch (err) {
        console.warn('[AuthProvider] Failed to acquire Azure management token silently:', err);
      }
    }
    return localStorage.getItem('cloudops-local-token');
  }, [user, instance]);

  const getAzureManagementToken = useCallback(async (): Promise<string | null> => {
    try {
      const activeAccount = instance.getActiveAccount() || instance.getAllAccounts()[0];
      if (!activeAccount) return null;
      const result = await instance.acquireTokenSilent({
        scopes: ['https://management.azure.com/user_impersonation'],
        account: activeAccount,
      });
      return result?.accessToken || null;
    } catch (err) {
      console.warn('[AuthProvider] Failed to acquire Azure management token silently:', err);
      return null;
    }
  }, [instance]);

  // Wire API interceptors
  useEffect(() => { api.setTokenProvider(getAzureToken); }, [getAzureToken]);
  useEffect(() => { api.setAzureTokenProvider(getAzureManagementToken); }, [getAzureManagementToken]);
  useEffect(() => { api.setOnUnauthorized(logout); }, [logout]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoading,
        msalRedirectError,
        login,
        loginWithGoogle,
        logout,
        getAzureToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
