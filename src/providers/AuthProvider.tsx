/* eslint-disable react-refresh/only-export-components */
// ============================================================
// Auth Provider - MSAL + Demo Mode Authentication
// ============================================================

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useMsal, useIsAuthenticated } from '@azure/msal-react';
import { InteractionRequiredAuthError, type AccountInfo } from '@azure/msal-browser';
import { loginRequest, azureTokenRequest, isDemoMode } from '../config/authConfig';
import type { User, UserRole } from '../types';
import { api } from '../services/api';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isDemoMode: boolean;
  login: (email?: string, password?: string) => Promise<void>;
  logout: () => void;
  getAzureToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function mapAccountToUser(account: AccountInfo): User {
  const roles = (account.idTokenClaims?.roles as string[] | undefined) || [];
  let role: UserRole = 'VIEWER';
  if (roles.includes('Platform.Owner')) role = 'OWNER';
  else if (roles.includes('Platform.Admin')) role = 'ADMIN';
  else if (roles.includes('Platform.Operator')) role = 'OPERATOR';
  else if (roles.includes('Platform.Auditor')) role = 'AUDITOR';

  return {
    id: account.localAccountId || account.homeAccountId,
    email: account.username,
    displayName: account.name || account.username,
    role,
    organizationId: account.tenantId || '',
    entraObjectId: account.localAccountId || '',
    lastLogin: new Date().toISOString(),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { instance, accounts } = useMsal();
  const msalAuthenticated = useIsAuthenticated();
  const [user, setUser] = useState<User | null>(() => {
    const savedUser = localStorage.getItem('cloudops-local-user');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [demoAuthenticated, setDemoAuthenticated] = useState(() => {
    return !!localStorage.getItem('cloudops-local-token');
  });

  const isAuthenticated = isDemoMode ? demoAuthenticated : msalAuthenticated;

  // Restore session on mount
  useEffect(() => {
    if (user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(false);
    } else if (accounts.length > 0) {
      setUser(mapAccountToUser(accounts[0]));
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  }, [accounts, user]);

  const login = useCallback(async (email?: string, password?: string) => {
    setIsLoading(true);
    try {
      if (email && password) {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.message || 'Invalid administrator credentials.');
        }
        const data = await response.json();
        localStorage.setItem('cloudops-local-token', data.token);
        localStorage.setItem('cloudops-local-user', JSON.stringify(data.user));
        setUser(data.user);
        setDemoAuthenticated(true);
      } else {
        const result = await instance.loginPopup(loginRequest);
        if (result.account) {
          instance.setActiveAccount(result.account);
          setUser(mapAccountToUser(result.account));
        }
      }
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [instance]);

  const logout = useCallback(() => {
    localStorage.removeItem('cloudops-local-token');
    localStorage.removeItem('cloudops-local-user');
    if (isDemoMode) {
      setUser(null);
      setDemoAuthenticated(false);
    } else {
      instance.logoutPopup();
      setUser(null);
    }
  }, [instance]);

  const getAzureToken = useCallback(async (): Promise<string | null> => {
    const localToken = localStorage.getItem('cloudops-local-token');
    if (localToken) return localToken;

    if (isDemoMode) return null;

    try {
      const account = instance.getActiveAccount();
      if (!account) return null;

      const response = await instance.acquireTokenSilent({
        ...azureTokenRequest,
        account,
      });
      return response.accessToken;
    } catch (error) {
      if (error instanceof InteractionRequiredAuthError) {
        try {
          const response = await instance.acquireTokenPopup(azureTokenRequest);
          return response.accessToken;
        } catch (popupError) {
          console.error('Token acquisition failed:', popupError);
          return null;
        }
      }
      console.error('Silent token acquisition failed:', error);
      return null;
    }
  }, [instance]);

  useEffect(() => {
    api.setTokenProvider(getAzureToken);
  }, [getAzureToken]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        isLoading,
        isDemoMode,
        login,
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
