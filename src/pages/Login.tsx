import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { useAuth } from '../providers/AuthProvider';
import { Shield, CheckCircle, Smartphone, AlertCircle, ExternalLink, Activity, Info, RefreshCw, Key } from 'lucide-react';
import { API_BASE_URL, CURRENT_ENV } from '../config/environment';
import { LoginButton } from '../components/common/LoginButton';

interface MappedError {
  title: string;
  message: string;
  instructions: string[];
}

// Check configuration status of providers
const isMicrosoftConfigured = !!(
  import.meta.env.VITE_AZURE_CLIENT_ID &&
  import.meta.env.VITE_AZURE_CLIENT_ID.trim() !== '' &&
  !import.meta.env.VITE_AZURE_CLIENT_ID.includes('YOUR_')
);

const isGoogleConfigured = !!(
  import.meta.env.VITE_GOOGLE_CLIENT_ID &&
  import.meta.env.VITE_GOOGLE_CLIENT_ID.trim() !== '' &&
  !import.meta.env.VITE_GOOGLE_CLIENT_ID.includes('YOUR_')
);

// Map raw OAuth errors to clear, friendly user notifications
const getFriendlyError = (errStr: string): MappedError => {
  try {
    const parsed = JSON.parse(errStr);
    if (parsed.code === 'USER_NOT_APPROVED') {
      return {
        title: 'Access Denied: Unapproved Account',
        message: 'This account is not on the pre-approved user whitelist.',
        instructions: [
          `Email used: ${parsed.email || 'Unknown'}`,
          `Status: ${parsed.approvalStatus || 'Not Approved'}`,
          `Administrator Contact: ${parsed.adminContact || 'admin@cloudops-local.com'}`,
          parsed.instructions || 'Please contact your platform administrator to request access.'
        ]
      };
    }
  } catch (e) {
    // Not JSON, continue with string matching
  }

  const normalized = errStr.toLowerCase();
  
  if (normalized.includes('aadsts500113') || normalized.includes('reply address') || normalized.includes('redirect uri')) {
    return {
      title: 'Microsoft Redirect URI Missing',
      message: 'The redirect URI http://localhost:5173 is not registered in the Entra ID Application Registration.',
      instructions: [
        'Open the Microsoft Entra Admin Center.',
        'Navigate to App registrations > select your application.',
        'Under Manage, select Authentication.',
        'Click Add a platform and select Single-page application (SPA).',
        'Add the Redirect URI: http://localhost:5173',
        'Ensure both Access Tokens and ID Tokens are enabled under implicit flows.',
        'Save the registration and retry login.'
      ]
    };
  }
  
  if (normalized.includes('invalid_client') || normalized.includes('client not found') || normalized.includes('401')) {
    return {
      title: 'Google OAuth Client Missing',
      message: 'The Google OAuth Client ID configured is invalid or was not found.',
      instructions: [
        'Verify your VITE_GOOGLE_CLIENT_ID matches the Client ID in the Google Cloud Console.',
        'Ensure Authorized JavaScript Origins contains: http://localhost:5173',
        'Ensure Authorized Redirect URIs contains: http://localhost:5173',
        'Restart the frontend server if you edited the .env file.'
      ]
    };
  }
  
  if (normalized.includes('timed_out') || normalized.includes('timeout') || normalized.includes('popup_closed') || normalized.includes('user_cancelled')) {
    return {
      title: 'Popup Timed Out / Closed',
      message: 'The login popup was closed or timed out before authentication was completed.',
      instructions: [
        'Allow popups for this origin in your browser settings.',
        'Click the sign-in button again and keep the popup open.',
        'Complete the authentication flow in the popup window.'
      ]
    };
  }
  
  if (normalized.includes('configuration') || normalized.includes('missing') || normalized.includes('not configured')) {
    return {
      title: 'Configuration Required',
      message: 'Some OAuth configuration parameters are missing or invalid.',
      instructions: [
        'Open the .env file in your project root.',
        'Ensure VITE_AZURE_CLIENT_ID and VITE_AZURE_TENANT_ID are defined.',
        'Ensure VITE_GOOGLE_CLIENT_ID is defined.',
        'Restart the frontend and backend servers.'
      ]
    };
  }

  if (normalized.includes('pre-approval') || normalized.includes('approved')) {
    return {
      title: 'Access Denied: Unapproved Account',
      message: 'This account is not on the pre-approved user whitelist.',
      instructions: [
        'Access to this platform is restricted to approved email addresses.',
        'Please contact your platform administrator to request access.',
        'To log in as local admin, use the administrator form below.'
      ]
    };
  }

  return {
    title: 'Authentication Error',
    message: errStr,
    instructions: [
      'Check the browser console logs for additional technical details.',
      'Check backend connection and database connectivity.'
    ]
  };
};

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, loginWithGoogle, isAuthenticated, isLoading, msalRedirectError } = useAuth();
  const { inProgress } = useMsal();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Redirection on successful authentication
  useEffect(() => {
    if (isAuthenticated) {
      const from = (location.state as any)?.from?.pathname || '/';
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, location]);

  // Diagnostics state
  const [diagData, setDiagData] = useState<any>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);

  const fetchDiagnostics = async () => {
    setDiagLoading(true);
    setDiagError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/health/diagnose`);
      if (response.ok) {
        const res = await response.json();
        setDiagData(res);
      } else {
        throw new Error(`Server returned HTTP ${response.status}`);
      }
    } catch (e: any) {
      setDiagError(e.message || 'Failed to fetch diagnostic data from backend.');
    } finally {
      setDiagLoading(false);
    }
  };

  // Surface any error that occurred during the Microsoft redirect callback.
  // main.tsx stores it in sessionStorage; AuthProvider reads and exposes it
  // as msalRedirectError before Login renders.
  useEffect(() => {
    if (msalRedirectError) {
      setError(msalRedirectError);
    }
  }, [msalRedirectError]);

  useEffect(() => {
    if (showDiagnostics) {
      fetchDiagnostics();
    }
  }, [showDiagnostics]);

  const handleMicrosoftLogin = async () => {
    if (!isMicrosoftConfigured) {
      setError('Configuration Required: Microsoft Entra ID is not configured.');
      return;
    }
    if (isSigningIn || inProgress !== 'none') {
      return; // Prevent double clicks and nested popups
    }
    setIsSigningIn(true);
    setError('');
    try {
      await login();
    } catch (err: any) {
      setError(err.message || 'Entra ID login failed.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (!isGoogleConfigured) {
      setError('Configuration Required: Google OAuth is not configured.');
      return;
    }
    setIsSigningIn(true);
    setError('');
    try {
      await loginWithGoogle();
    } catch (err: any) {
      setError(err.message || 'Google Sign-in failed.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleLocalLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSigningIn(true);
    setError('');
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Invalid administrator credentials.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const friendlyError = error ? getFriendlyError(error) : null;

  return (
    <div className="login-page" style={{ display: 'flex', minHeight: '100vh', width: '100%', background: '#0c0f1d', fontFamily: 'var(--font-sans, system-ui, sans-serif)', color: 'white' }}>
      {/* Left panel — Branding */}
      <div className="login-left" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 48, background: 'linear-gradient(135deg, #0e1227 0%, #060814 100%)', borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
        <div className="login-logo" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 40 }}>
          <div className="login-logo-icon" style={{ width: 28, height: 28, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <span style={{ background: '#0078d4', borderRadius: 2 }} />
            <span style={{ background: '#00B7C3', borderRadius: 2 }} />
            <span style={{ background: '#107C10', borderRadius: 2 }} />
            <span style={{ background: '#FFB900', borderRadius: 2 }} />
          </div>
          <div>
            <div className="login-logo-text" style={{ fontSize: 18, fontWeight: 800 }}>Azure CloudOps</div>
            <div className="login-logo-sub" style={{ fontSize: 10, letterSpacing: 1.5, color: '#0078d4' }}>ENTERPRISE CONTROL</div>
          </div>
        </div>

        <h1 className="login-tagline" style={{ fontSize: 40, fontWeight: 800, lineHeight: 1.2, margin: '0 0 24px 0' }}>
          Intelligent Cloud<br />
          Operations for<br />
          <span style={{ color: '#0078d4' }}>Azure Enterprises</span>
        </h1>

        <p className="login-desc" style={{ color: '#a0aec0', fontSize: 16, lineHeight: 1.6, margin: '0 0 32px 0', maxWidth: 460 }}>
          Production-grade multi-tenant workspace with Azure RBAC, automated compliance policies, real-time alerts, and cost optimization.
        </p>

        <div style={{ marginTop: 'auto' }}>
          <button
            onClick={() => setShowDiagnostics(true)}
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#a0aec0',
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              transition: 'all 0.2s'
            }}
            onMouseOver={e => { e.currentTarget.style.color = 'white'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
            onMouseOut={e => { e.currentTarget.style.color = '#a0aec0'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
          >
            <Activity size={14} />
            System Diagnostics
          </button>
        </div>
      </div>

      {/* Right panel — Sign in card */}
      <div className="login-right" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div className="login-card" style={{ width: '100%', maxWidth: 420, background: '#16192b', padding: 32, borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', boxShadow: '0 20px 40px rgba(0,0,0,0.4)' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: 'linear-gradient(135deg, #0078d4, #00B7C3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              boxShadow: '0 8px 24px rgba(0,120,212,0.3)'
            }}>
              <Shield size={26} color="white" />
            </div>
            <div className="login-card-title" style={{ fontSize: 20, fontWeight: 700 }}>Secure Operations Sign In</div>
            <div className="login-card-subtitle" style={{ color: '#a0aec0', fontSize: 13, marginTop: 6 }}>
              Choose a secure identity provider to access dashboards.
            </div>
          </div>

          {/* Friendly Error Message Container */}
          {friendlyError && (
            <div style={{
              background: 'rgba(209, 52, 56, 0.12)',
              color: '#FF8F95',
              padding: 16,
              borderRadius: 10,
              fontSize: 13,
              marginBottom: 20,
              border: '1px solid rgba(209, 52, 56, 0.3)',
              lineHeight: 1.5
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
                    {friendlyError.title}
                  </strong>
                  <div>{friendlyError.message}</div>
                </div>
              </div>
              
              <div style={{ marginTop: 12, borderTop: '1px solid rgba(209,52,56,0.2)', paddingTop: 10 }}>
                <div style={{ fontWeight: 600, color: 'white', marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Setup Instructions:
                </div>
                <ul style={{ paddingLeft: 16, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {friendlyError.instructions.map((inst, index) => (
                    <li key={index} style={{ color: '#e2e8f0' }}>{inst}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Social login buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
            <LoginButton
              provider="microsoft"
              onFailure={(err) => setError(err)}
            />
            <LoginButton
              provider="google"
              onFailure={(err) => setError(err)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0', color: '#718096' }}>
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
            <span style={{ padding: '0 10px', fontSize: 11, fontWeight: 600 }}>OR LOCAL ADMIN</span>
            <hr style={{ flex: 1, border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
          </div>

          {/* Local administrator credentials form */}
          <form onSubmit={handleLocalLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#a0aec0' }}>Email Address</label>
              <input
                type="email"
                required
                placeholder="admin@cloudops-local.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1d2038', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6, color: '#a0aec0' }}>Password</label>
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#1d2038', border: '1px solid rgba(255,255,255,0.1)', color: 'white' }}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || isSigningIn}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: 8,
                background: 'var(--accent-color, #0078d4)',
                color: 'white',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
                marginTop: 8
              }}
            >
              Sign In
            </button>
          </form>

          {/* Device indicators */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginTop: 24, color: '#718096', fontSize: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Smartphone size={14} /> Mobile ready</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle size={14} /> MFA Ready</span>
          </div>
        </div>
      </div>

      {/* Configuration Instructions Overlay */}
      {showConfig && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 24
        }}>
          <div style={{
            background: '#16192b',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            padding: 32,
            maxWidth: 600,
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
          }}>
            <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>Configure Microsoft Entra ID</h2>
            
            <div style={{ fontSize: 14, color: '#a0aec0', lineHeight: 1.6 }}>
              <ol style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <li>Navigate to the <strong>Microsoft Entra Admin Center</strong> and select <strong>App registrations</strong> &gt; <strong>New registration</strong>.</li>
                <li>Name the application (e.g., CloudOps Enterprise Platform).</li>
                <li>Under Manage, select <strong>Authentication</strong>. Add a platform &gt; <strong>Single-page application (SPA)</strong>.</li>
                <li>Add the Redirect URIs:
                  <ul style={{ marginTop: 4, paddingLeft: 20, listStyleType: 'circle' }}>
                    <li><code>http://localhost:5173</code> (Development)</li>
                    <li><code>https://your-production-domain.com</code> (Production Placeholder)</li>
                  </ul>
                </li>
                <li>Under Implicit grant and hybrid flows, check both <strong>Access tokens</strong> and <strong>ID tokens</strong>.</li>
                <li>Go to <strong>API permissions</strong> and grant Admin Consent for: <code>User.Read</code>, <code>openid</code>, <code>profile</code>, <code>email</code>, and <code>offline_access</code>.</li>
                <li>Create a <code>.env</code> file in the project root and add the following variables:
                  <div style={{ background: '#0e1227', padding: 12, borderRadius: 6, marginTop: 8, border: '1px solid rgba(255,255,255,0.05)', fontFamily: 'monospace' }}>
                    VITE_AZURE_CLIENT_ID=your-client-id<br/>
                    VITE_AZURE_TENANT_ID=your-tenant-id<br/><br/>
                    # Backend variables<br/>
                    AZURE_CLIENT_ID=your-client-id<br/>
                    AZURE_TENANT_ID=your-tenant-id<br/>
                    AZURE_CLIENT_SECRET=your-client-secret<br/>
                    AZURE_SUBSCRIPTION_ID=your-subscription-id
                  </div>
                </li>
                <li>Restart both the frontend and backend servers.</li>
              </ol>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24 }}>
              <button
                onClick={() => setShowConfig(false)}
                style={{
                  padding: '10px 24px',
                  background: '#0078d4',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diagnostics Panel Modal (For Unauthenticated Troubleshooting) */}
      {showDiagnostics && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 24
        }}>
          <div style={{
            background: '#16192b',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            padding: 32,
            maxWidth: 680,
            width: '100%',
            maxHeight: '95vh',
            overflowY: 'auto',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Activity color="#0078d4" /> Authentication Diagnostics
              </h2>
              <button
                onClick={fetchDiagnostics}
                disabled={diagLoading}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#0078d4',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 600
                }}
              >
                <RefreshCw size={14} className={diagLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
              {/* Microsoft Status */}
              <div style={{ background: '#1d2038', padding: 16, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: 14, color: '#0078d4', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 6 }}>Microsoft Entra ID</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: '#a0aec0' }}>Current Client ID:</span>
                    <span style={{ fontFamily: 'monospace', color: isMicrosoftConfigured ? '#10B981' : '#EF4444', wordBreak: 'break-all' }}>
                      {import.meta.env.VITE_AZURE_CLIENT_ID || 'Missing'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: '#a0aec0' }}>Current Tenant ID:</span>
                    <span style={{ fontFamily: 'monospace', color: import.meta.env.VITE_AZURE_TENANT_ID ? '#10B981' : '#EF4444', wordBreak: 'break-all' }}>
                      {import.meta.env.VITE_AZURE_TENANT_ID || 'Missing'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: '#a0aec0' }}>Current Redirect URI:</span>
                    <span style={{ fontFamily: 'monospace', color: '#10B981', wordBreak: 'break-all' }}>
                      {window.location.origin}
                    </span>
                  </div>
                </div>
              </div>

              {/* Google Status */}
              <div style={{ background: '#1d2038', padding: 16, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: 14, color: '#4285F4', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 6 }}>Google OAuth</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Client ID:</span>
                    <span style={{ color: isGoogleConfigured ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                      {isGoogleConfigured ? 'Configured' : 'Missing'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Redirect URI:</span>
                    <span style={{ color: '#10B981', fontWeight: 600 }}>
                      {window.location.origin}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Authorized Origin:</span>
                    <span style={{ color: '#10B981', fontWeight: 600 }}>
                      http://localhost:5173
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Backend status panel */}
            <div style={{ background: '#1d2038', padding: 16, borderRadius: 8, border: '1px solid rgba(255,255,255,0.05)', marginBottom: 24 }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: 14, color: '#107C10', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 6 }}>System & Environment</h4>
              
              {diagLoading ? (
                <div style={{ textAlign: 'center', padding: 12, fontSize: 13, color: '#a0aec0' }}>Querying system status...</div>
              ) : diagError ? (
                <div style={{ color: '#EF4444', padding: 8, fontSize: 12 }}>
                  <strong>Error:</strong> {diagError}
                  <div style={{ marginTop: 4, color: '#cbd5e1' }}>Please verify that the backend api server is running on port 3001.</div>
                </div>
              ) : diagData ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 12 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Backend Status:</span>
                      <span style={{ color: diagData.backend === 'Healthy' ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                        {diagData.backend}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Database Connection:</span>
                      <span style={{ color: diagData.database === 'Healthy' ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                        {diagData.database}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>JWT Secret Configuration:</span>
                      <span style={{ color: diagData.jwtSecret ? '#10B981' : '#EF4444', fontWeight: 600 }}>
                        {diagData.jwtSecret ? 'Configured' : 'Missing'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Active Sessions:</span>
                      <span style={{ color: '#10B981', fontWeight: 600 }}>
                        Active
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Current Environment:</span>
                      <span style={{ color: '#0078d4', fontWeight: 600 }}>
                        {CURRENT_ENV}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#a0aec0' }}>No diagnostic details retrieved. Click Refresh to probe.</div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDiagnostics(false)}
                style={{
                  padding: '10px 24px',
                  background: '#0078d4',
                  color: 'white',
                  border: 'none',
                  borderRadius: 6,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Close Diagnostics
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
