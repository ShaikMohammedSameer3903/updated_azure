import { useState, useEffect } from 'react';
import { ShieldAlert, RefreshCw, Server, Database, Key, CheckCircle, XCircle } from 'lucide-react';
import { API_BASE_URL, CURRENT_ENV } from '../config/environment';

interface DiagnosticInfo {
  frontend: string;
  backend: string;
  jwtSecret: boolean;
  database: string;
  azure: string;
  sse: string;
  details: {
    JWT_SECRET: string;
    AZURE_CLIENT_ID: string;
    AZURE_TENANT_ID: string;
    AZURE_CLIENT_SECRET: string;
    AZURE_SUBSCRIPTION_ID: string;
  };
}

export default function DiagnosticPage({ onResolved }: { onResolved: () => void }) {
  const [data, setData] = useState<DiagnosticInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

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
      if (res.jwtSecret && res.database === 'Healthy') {
        // All critical checks passed!
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
        <div>Running system validation probes...</div>
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
        maxWidth: 700,
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
            <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Configuration Validation Status</h2>
            <p style={{ fontSize: 14, color: '#a0aec0', margin: '4px 0 0' }}>
              Ensure your environment variables are configured before launching.
            </p>
          </div>
        </div>

        <div style={{
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: 8,
          padding: '12px 16px',
          marginBottom: 20,
          fontSize: 13,
          color: '#e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}>
          <div><strong>Current Environment:</strong> {CURRENT_ENV}</div>
          <div><strong>Current API URL:</strong> <code style={{ color: '#38bdf8' }}>{API_BASE_URL}</code></div>
          <div><strong>Backend Status:</strong> <span style={{ color: data?.backend === 'Healthy' ? '#10B981' : '#EF4444', fontWeight: 600 }}>{data?.backend === 'Healthy' ? 'Healthy' : 'Failed'}</span></div>
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
            <span>{error}</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 32 }}>
          {/* Status Checks Grid */}
          <div style={{
            background: 'rgba(12, 15, 29, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            borderRadius: 12,
            padding: 20,
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px', color: '#a0aec0' }}>Services Health</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}><Server size={16} /> Frontend Running</span>
                <span style={{ fontSize: 13, color: '#10B981', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={14} /> Active</span>
              </div>
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}><Server size={16} /> Backend Running</span>
                {data?.backend === 'Healthy' ? (
                  <span style={{ fontSize: 13, color: '#10B981', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={14} /> Active</span>
                ) : (
                  <span style={{ fontSize: 13, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}><XCircle size={14} /> Inactive</span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}><Database size={16} /> Database Connection</span>
                {data?.database === 'Healthy' ? (
                  <span style={{ fontSize: 13, color: '#10B981', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={14} /> Connected</span>
                ) : (
                  <span style={{ fontSize: 13, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}><XCircle size={14} /> Disconnected</span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}><Key size={16} /> Token Secrets</span>
                {data?.jwtSecret ? (
                  <span style={{ fontSize: 13, color: '#10B981', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={14} /> Configured</span>
                ) : (
                  <span style={{ fontSize: 13, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}><XCircle size={14} /> Missing</span>
                )}
              </div>
            </div>
          </div>

          <div style={{
            background: 'rgba(12, 15, 29, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            borderRadius: 12,
            padding: 20,
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 16px', color: '#a0aec0' }}>Azure SDK Credentials</h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#e2e8f0' }}>AZURE_CLIENT_ID</span>
                {data?.details.AZURE_CLIENT_ID === 'configured' ? (
                  <span style={{ fontSize: 12, color: '#10B981' }}>✓ Configured</span>
                ) : (
                  <span style={{ fontSize: 12, color: '#ef4444' }}>✗ Missing</span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#e2e8f0' }}>AZURE_TENANT_ID</span>
                {data?.details.AZURE_TENANT_ID === 'configured' ? (
                  <span style={{ fontSize: 12, color: '#10B981' }}>✓ Configured</span>
                ) : (
                  <span style={{ fontSize: 12, color: '#ef4444' }}>✗ Missing</span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#e2e8f0' }}>AZURE_CLIENT_SECRET</span>
                {data?.details.AZURE_CLIENT_SECRET === 'configured' ? (
                  <span style={{ fontSize: 12, color: '#10B981' }}>✓ Configured</span>
                ) : (
                  <span style={{ fontSize: 12, color: '#ef4444' }}>✗ Missing</span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: '#e2e8f0' }}>AZURE_SUBSCRIPTION_ID</span>
                {data?.details.AZURE_SUBSCRIPTION_ID === 'configured' ? (
                  <span style={{ fontSize: 12, color: '#10B981' }}>✓ Configured</span>
                ) : (
                  <span style={{ fontSize: 12, color: '#ef4444' }}>✗ Missing</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action/Fix instructions */}
        <div style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: 12,
          padding: '24px',
          marginBottom: 32,
        }}>
          <h4 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 12px' }}>Fix Instructions</h4>
          <ol style={{ fontSize: 14, color: '#cbd5e1', paddingLeft: 20, margin: 0, lineHeight: 1.8 }}>
            <li>Open the <code style={{ color: '#38bdf8', background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4 }}>.env</code> file in your workspace root.</li>
            <li>Verify that the four Azure credentials listed above are not empty and contain your active Azure App Registration secrets.</li>
            <li>Verify <code style={{ color: '#38bdf8', background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4 }}>JWT_SECRET</code> is configured with a secure string.</li>
            <li>Ensure the backend API service is running locally on port 3001.</li>
            <li>Click the <strong>Retry Validation</strong> button below to refresh status.</li>
          </ol>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleRetry}
            disabled={isLoading || retrying}
            style={{
              background: '#0078d4',
              color: 'white',
              border: 'none',
              padding: '12px 24px',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'background 0.2s',
              opacity: isLoading ? 0.7 : 1
            }}
          >
            <RefreshCw size={16} className={retrying ? 'animate-spin' : ''} />
            <span>Retry Validation</span>
          </button>
        </div>
      </div>
    </div>
  );
}
