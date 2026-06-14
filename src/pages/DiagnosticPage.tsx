import { useState, useEffect } from 'react';
import { ShieldAlert, RefreshCw, Server, Database, Key, CheckCircle, XCircle, Activity, Globe, Info } from 'lucide-react';
import { API_BASE_URL, CURRENT_ENV } from '../config/environment';

interface DiagnosticInfo {
  frontend: string;
  backend: string;
  database: string;
  azure: string;
  authentication: string;
  sse: string;
  jwtSecret: boolean;
  environment: string;
  sessionsCount: number;
  googleConfigured: boolean;
  details: {
    JWT_SECRET: string;
    AZURE_CLIENT_ID: string;
    AZURE_TENANT_ID: string;
    AZURE_CLIENT_SECRET: string;
    AZURE_SUBSCRIPTION_ID: string;
    GOOGLE_CLIENT_ID: string;
  };
}

export default function DiagnosticPage({ onResolved }: { onResolved: () => void }) {
  const [data, setData] = useState<DiagnosticInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Check frontend variables directly
  const isMicrosoftClientSet = !!(
    import.meta.env.VITE_AZURE_CLIENT_ID &&
    import.meta.env.VITE_AZURE_CLIENT_ID.trim() !== '' &&
    !import.meta.env.VITE_AZURE_CLIENT_ID.includes('YOUR_')
  );

  const isMicrosoftTenantSet = !!(
    import.meta.env.VITE_AZURE_TENANT_ID &&
    import.meta.env.VITE_AZURE_TENANT_ID.trim() !== '' &&
    !import.meta.env.VITE_AZURE_TENANT_ID.includes('YOUR_')
  );

  const isGoogleClientSet = !!(
    import.meta.env.VITE_GOOGLE_CLIENT_ID &&
    import.meta.env.VITE_GOOGLE_CLIENT_ID.trim() !== '' &&
    !import.meta.env.VITE_GOOGLE_CLIENT_ID.includes('YOUR_')
  );

  const fetchDiagnostics = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/health/diagnose`);
      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}`);
      }
      const res = await response.json();
      setData(res);
      
      // Auto-resolve only if JWT and Database are healthy, and MS config is valid
      if (res.jwtSecret && res.database === 'Healthy' && isMicrosoftClientSet && isMicrosoftTenantSet) {
        onResolved();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect to backend server diagnostics.');
    } finally {
      setIsLoading(false);
      setRetrying(false);
    }
  };

  useEffect(() => {
    fetchDiagnostics();
  }, []);

  const handleRetry = () => {
    setRetrying(true);
    fetchDiagnostics();
  };

  if (isLoading && !retrying) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0c0f1d',
        color: '#ffffff',
        fontFamily: 'Outfit, sans-serif'
      }}>
        <div className="spinner" style={{ marginBottom: 16 }} />
        <div>Running authentication diagnostics probes...</div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'radial-gradient(circle at top, #161c38 0%, #090d16 100%)',
      color: '#ffffff',
      fontFamily: 'Outfit, sans-serif',
      padding: '40px 20px',
    }}>
      <div style={{
        maxWidth: 750,
        width: '100%',
        background: 'rgba(22, 27, 48, 0.7)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 16,
        padding: '40px',
        boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 32 }}>
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <ShieldAlert size={32} color="#ef4444" />
          </div>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Authentication Diagnostics Dashboard</h2>
            <p style={{ fontSize: 14, color: '#a0aec0', margin: '4px 0 0' }}>
              Inspect OAuth client IDs, tenant IDs, secret keys, and active user sessions.
            </p>
          </div>
        </div>

        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            color: '#f87171',
            padding: '12px 16px',
            borderRadius: 8,
            fontSize: 14,
            marginBottom: 24,
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <XCircle size={18} />
            <span>{error} - Backend is offline or unreachable on port 3001.</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
          
          {/* Microsoft Configuration Status */}
          <div style={{
            background: 'rgba(12, 15, 29, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            borderRadius: 12,
            padding: 20,
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px', color: '#0078d4', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Globe size={16} /> Microsoft Entra ID
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifySelf: 'stretch', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>Client ID Status</span>
                <span style={{ fontSize: 12, color: isMicrosoftClientSet ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                  {isMicrosoftClientSet ? '✓ Configured' : '✗ Missing'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifySelf: 'stretch', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>Tenant Status</span>
                <span style={{ fontSize: 12, color: isMicrosoftTenantSet ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                  {isMicrosoftTenantSet ? '✓ Configured' : '✗ Missing'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifySelf: 'stretch', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>Redirect URI Status</span>
                <span style={{ fontSize: 12, color: '#10B981', fontWeight: 600 }}>
                  {window.location.origin}
                </span>
              </div>
            </div>
          </div>

          {/* Google Configuration Status */}
          <div style={{
            background: 'rgba(12, 15, 29, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            borderRadius: 12,
            padding: 20,
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px', color: '#4285F4', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Globe size={16} /> Google OAuth 2.0
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifySelf: 'stretch', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>Client ID Status</span>
                <span style={{ fontSize: 12, color: isGoogleClientSet ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                  {isGoogleClientSet ? '✓ Configured' : '✗ Missing'}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifySelf: 'stretch', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>Redirect URI Status</span>
                <span style={{ fontSize: 12, color: '#10B981', fontWeight: 600 }}>
                  {window.location.origin}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifySelf: 'stretch', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>Authorized Origins</span>
                <span style={{ fontSize: 12, color: '#10B981', fontWeight: 600 }}>
                  http://localhost:5173
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* Server & Environment health status */}
        <div style={{
          background: 'rgba(12, 15, 29, 0.5)',
          border: '1px solid rgba(255, 255, 255, 0.04)',
          borderRadius: 12,
          padding: 20,
          marginBottom: 32
        }}>
          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 16px', color: '#107C10', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={16} /> Server & Runtime Diagnostics
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>Backend Authentication Status</span>
                <span style={{ fontSize: 12, color: data?.backend === 'Healthy' ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                  {data?.backend === 'Healthy' ? '✓ Online' : '✗ Offline'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>JWT Secret Status</span>
                <span style={{ fontSize: 12, color: data?.jwtSecret ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                  {data?.jwtSecret ? '✓ Configured' : '✗ Missing'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>Database Connection</span>
                <span style={{ fontSize: 12, color: data?.database === 'Healthy' ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                  {data?.database === 'Healthy' ? '✓ Connected' : '✗ Offline'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>Session Status</span>
                <span style={{ fontSize: 12, color: '#10B981', fontWeight: 600 }}>
                  {data ? `✓ Active (${data.sessionsCount} sessions)` : '✗ Unresolved'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: '#cbd5e1' }}>Current Environment</span>
                <span style={{ fontSize: 12, color: '#0078d4', fontWeight: 600 }}>
                  {data?.environment || CURRENT_ENV}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Action/Fix instructions */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: 12,
          padding: '20px',
          marginBottom: 32,
        }}>
          <h4 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Info size={14} /> Troubleshoot Steps
          </h4>
          <ol style={{ fontSize: 13, color: '#cbd5e1', paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
            <li>Verify your <code style={{ color: '#38bdf8' }}>.env</code> file is in the project root.</li>
            <li>Verify Microsoft Client ID and Tenant ID match your Entra ID app registration.</li>
            <li>Verify Google OAuth Client ID matches the client credentials.</li>
            <li>Ensure the backend Node.js api server is running locally on port 3001.</li>
            <li>Click <strong>Retry Diagnostics</strong> to poll status.</li>
          </ol>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#a0aec0',
              padding: '10px 20px',
              borderRadius: 8,
              fontSize: 13,
              cursor: 'pointer'
            }}
          >
            Reload Client
          </button>
          <button
            onClick={handleRetry}
            disabled={isLoading || retrying}
            style={{
              background: '#0078d4',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: isLoading ? 0.7 : 1
            }}
          >
            <RefreshCw size={14} className={retrying ? 'animate-spin' : ''} />
            <span>Retry Diagnostics</span>
          </button>
        </div>
      </div>
    </div>
  );
}
