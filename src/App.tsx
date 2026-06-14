// ============================================================
// Main Application Entrypoint & Router
// Enterprise Multi-Tenant Cloud Operations Platform
// ============================================================

import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './providers/AuthProvider';
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import ActivityPanel from './components/layout/ActivityPanel';

import { useEffect, useState } from 'react';
import { useAppStore } from './store/appStore';
import { useOperationStore } from './store/operationStore';
import { api } from './services/api';
import DiagnosticPage from './pages/DiagnosticPage';
import { ProtectedRoute } from './components/common/ProtectedRoute';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Resources from './pages/Resources';
import Monitoring from './pages/Monitoring';
import Actions from './pages/Actions';
import Incidents from './pages/Incidents';
import AiAssistant from './pages/AiAssistant';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Security from './pages/Security';
import RiskManagement from './pages/RiskManagement';
import GovernanceDashboard from './pages/GovernanceDashboard';
import BackupDashboard from './pages/BackupDashboard';
import CostDashboard from './pages/CostDashboard';
import SOCDashboard from './pages/SOCDashboard';
import CommandCenter from './pages/CommandCenter';
import DemoTour from './pages/DemoTour';
import OnboardingWizard from './components/common/OnboardingWizard';

import { API_BASE_URL } from './config/environment';

import { useMsal } from '@azure/msal-react';

export default function App() {
  const { isAuthenticated, isLoading, getAzureToken, user } = useAuth();
  const { subscriptions, setSubscriptions, activeSubscriptionId, setActiveSubscription, setResources } = useAppStore();
  const { instance } = useMsal();

  const [isConfigValid, setIsConfigValid] = useState<boolean | null>(null);

  useEffect(() => {
    const checkConfig = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/health/diagnose`);
        if (response.ok) {
          const res = await response.json();
          if (res.database === 'Critical' || res.jwtSecret === false) {
            setIsConfigValid(false);
            return;
          }
          if (res.azure === 'Critical') {
            const state = useAppStore.getState();
            if (!state.notifications.some(n => n.id === 'warn-azure-config')) {
              state.addNotification({
                id: 'warn-azure-config',
                type: 'system',
                title: 'Azure Integration Not Configured',
                message: 'The application is running in unconfigured state. Configure AZURE_CLIENT_ID to enable resource synchronization.',
                severity: 'warning',
                timestamp: new Date().toISOString(),
                read: false
              });
            }
          }
          setIsConfigValid(true);
          return;
        }
        setIsConfigValid(false);
      } catch (e) {
        setIsConfigValid(false);
      }
    };
    checkConfig();
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      const loadSubscriptions = async () => {
        try {
          // 1. Discover subscriptions from Azure if logged in via Microsoft
          if (user?.provider === 'Microsoft' && instance.getAllAccounts().length > 0) {
            try {
              const activeAccount = instance.getActiveAccount() || instance.getAllAccounts()[0];
              const tokenResult = await instance.acquireTokenSilent({
                scopes: ['https://management.azure.com/user_impersonation'],
                account: activeAccount,
              });
              
              if (tokenResult?.accessToken) {
                const armResponse = await fetch('https://management.azure.com/subscriptions?api-version=2020-01-01', {
                  headers: {
                    'Authorization': `Bearer ${tokenResult.accessToken}`
                  }
                });
                
                if (armResponse.ok) {
                  const armData = await armResponse.json();
                  const armSubs = armData.value || [];
                  
                  for (const s of armSubs) {
                    try {
                      await api.post('/api/subscriptions', {
                        subscriptionId: s.subscriptionId,
                        name: s.displayName,
                        authType: 'MSAL'
                      });
                    } catch (regErr) {
                      // Already registered
                    }
                  }
                }
              }
            } catch (azureErr) {
              console.warn('[SUBSCRIPTION DISCOVERY] Dynamic sync failed:', azureErr);
            }
          }

          // 2. Fetch the registered subscriptions from backend
          const subs = await api.get<any[]>('/api/subscriptions');
          setSubscriptions(subs);
          if (subs.length > 0 && !activeSubscriptionId) {
            setActiveSubscription(subs[0].id);
          }
        } catch (err) {
          console.error('Failed to load subscriptions globally:', err);
        }
      };
      loadSubscriptions();
    }
  }, [isAuthenticated, activeSubscriptionId, setSubscriptions, setActiveSubscription, user, instance]);

  useEffect(() => {
    if (isAuthenticated && activeSubscriptionId) {
      const loadResources = async () => {
        try {
          useAppStore.setState({ resourcesLoading: true, isRefreshing: true });
          
          const startTime = Date.now();
          try {
            await api.post(`/api/subscriptions/${activeSubscriptionId}/sync`);
          } catch (syncErr) {
            console.error('[DISCOVERY] Immediate scan sync failed:', syncErr);
          }
          const duration = ((Date.now() - startTime) / 1000).toFixed(1);
          localStorage.setItem('cloudops-last-scan-duration', duration);
          window.dispatchEvent(new CustomEvent('cloudops-scan-complete', { detail: { duration } }));

          const res = await api.get<any[]>('/api/resources', { params: { subscriptionId: activeSubscriptionId } });
          setResources(res);
          useAppStore.setState({ lastResourceSync: new Date().toISOString() });
        } catch (err) {
          console.error('Failed to load resources globally:', err);
        } finally {
          useAppStore.setState({ resourcesLoading: false, isRefreshing: false });
        }
      };
      loadResources();
    }
  }, [isAuthenticated, activeSubscriptionId, setResources]);

  useEffect(() => {
    if (isAuthenticated) {
      const restoreOperations = async () => {
        try {
          const ops = await api.get<any[]>('/api/actions/operations');
          const runningOps = ops.filter(o => o.status === 'Running' || o.status === 'Pending');
          for (const op of runningOps) {
            const logs = await api.get<any[]>(`/api/actions/operations/${op.id}/logs`);
            useOperationStore.getState().addOperation({
              id: op.id,
              name: op.name,
              stage: op.stage,
              percent: op.percent,
              timeRemaining: op.time_remaining || 'Calculating...',
              status: op.status,
              userEmail: op.user_email,
              createdAt: op.created_at,
              logs: logs.map(l => ({ message: l.message, timestamp: l.timestamp }))
            });
          }
        } catch (err) {
          console.error('Failed to restore running operations:', err);
        }
      };
      restoreOperations();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: any = null;

    const connectSSE = async () => {
      if (!isAuthenticated) return;
      try {
        const token = await getAzureToken();
        const apiBase = import.meta.env.VITE_API_URL || '';
        const url = `${apiBase}/api/notifications/stream?token=${encodeURIComponent(token || '')}`;
        
        eventSource = new EventSource(url);
        
        eventSource.onopen = () => {
          console.log('[SSE] Connected to live updates stream.');
        };

        eventSource.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'heartbeat') return;
            
            if (msg.type === 'notification') {
              useAppStore.getState().addNotification(msg.data);
            }
            if (msg.type === 'resource_status') {
              const { resourceId, status } = msg.data;
              useAppStore.setState(state => ({
                resources: state.resources.map(r => r.id === resourceId ? { ...r, status } : r)
              }));
            }
            if (msg.type === 'resource_discovered') {
              const activeSub = useAppStore.getState().activeSubscriptionId;
              if (activeSub) {
                api.get<any[]>('/api/resources', { params: { subscriptionId: activeSub } })
                  .then(res => useAppStore.getState().setResources(res))
                  .catch(err => console.error(err));
              }
            }
            if (msg.type === 'operation_started') {
              useOperationStore.getState().addOperation({
                ...msg.data,
                logs: [],
                createdAt: new Date().toISOString()
              });
            }
            if (msg.type === 'operation_updated') {
              useOperationStore.getState().updateOperation(msg.data.id, {
                stage: msg.data.stage,
                percent: msg.data.percent,
                timeRemaining: msg.data.timeRemaining,
                status: msg.data.status
              });
            }
            if (msg.type === 'operation_completed') {
              useOperationStore.getState().updateOperation(msg.data.id, {
                status: msg.data.status,
                stage: msg.data.stage,
                percent: msg.data.percent,
                errorMessage: msg.data.errorMessage
              });
            }
            if (msg.type === 'operation_log') {
              useOperationStore.getState().addOperationLog(msg.data.id, {
                message: msg.data.message,
                timestamp: msg.data.timestamp
              });
            }
          } catch (e) {
            console.error('[SSE] Failed to parse message:', e);
          }
        };

        eventSource.onerror = (err) => {
          console.warn('[SSE] EventSource failed, attempting reconnect...', err);
          if (eventSource) {
            eventSource.close();
          }
          reconnectTimeout = setTimeout(connectSSE, 5000);
        };
      } catch (err) {
        console.error('[SSE] Error setting up connection:', err);
        reconnectTimeout = setTimeout(connectSSE, 10000);
      }
    };

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [isAuthenticated, getAzureToken]);

  if (isConfigValid === null) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0c0f1d',
        color: '#ffffff',
        fontFamily: 'system-ui, sans-serif'
      }}>
        <div style={{
          width: 28, height: 28,
          display: 'grid', gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr', gap: 3, borderRadius: 6, overflow: 'hidden',
          marginBottom: 16
        }} className="spinner">
          <span style={{ background: '#0078d4', borderRadius: 2 }} />
          <span style={{ background: '#00B7C3', borderRadius: 2 }} />
          <span style={{ background: '#107C10', borderRadius: 2 }} />
          <span style={{ background: '#FFB900', borderRadius: 2 }} />
        </div>
        <div>Verifying environment configuration...</div>
      </div>
    );
  }

  if (isConfigValid === false) {
    return <DiagnosticPage onResolved={() => setIsConfigValid(true)} />;
  }

  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="pulse-ring">
          <div style={{
            width: 28, height: 28,
            display: 'grid', gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr 1fr', gap: 3, borderRadius: 6, overflow: 'hidden',
          }}>
            <span style={{ background: '#0078d4', borderRadius: 2 }} />
            <span style={{ background: '#00B7C3', borderRadius: 2 }} />
            <span style={{ background: '#107C10', borderRadius: 2 }} />
            <span style={{ background: '#FFB900', borderRadius: 2 }} />
          </div>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center' }}>
            Azure CloudOps
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 4 }}>
            Connecting to Microsoft Entra ID…
          </p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={
        <ProtectedRoute>
          <AppShell />
        </ProtectedRoute>
      } />
    </Routes>
  );
}

function AppShell() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      const onboarded = localStorage.getItem('cloudops-onboarded');
      if (!onboarded) {
        setShowOnboarding(true);
      }
    }
  }, [isAuthenticated]);

  return (
    <div className="app-shell">
      {showOnboarding && (
        <OnboardingWizard 
          onClose={() => setShowOnboarding(false)} 
          onComplete={() => {
            localStorage.setItem('cloudops-onboarded', 'true');
            setShowOnboarding(false);
          }} 
        />
      )}
      <Sidebar />
      <div className="main-content">
        <Header />
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <main className="page-content" style={{ flex: 1, overflowY: 'auto' }}>
            <Routes>
              <Route path="/"            element={<Dashboard />} />
              <Route path="/resources"   element={<Resources />} />
              <Route path="/monitoring"  element={<Monitoring />} />
              <Route path="/cost"        element={<CostDashboard />} />
              <Route path="/actions"     element={<Actions />} />
              <Route path="/incidents"   element={<Incidents />} />
              <Route path="/security"    element={<Security />} />
              <Route path="/soc"         element={<SOCDashboard />} />
              <Route path="/risk"        element={<RiskManagement />} />
              <Route path="/governance"  element={<GovernanceDashboard />} />
              <Route path="/backup"      element={<BackupDashboard />} />
              <Route path="/ai"          element={<AiAssistant />} />
              <Route path="/reports"     element={<Reports />} />
              <Route path="/command-center" element={<CommandCenter />} />
              <Route path="/demo-tour"      element={<DemoTour />} />
              <Route path="/settings"    element={<Settings />} />
              <Route path="*"            element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <ActivityPanel />
        </div>
      </div>
    </div>
  );
}
