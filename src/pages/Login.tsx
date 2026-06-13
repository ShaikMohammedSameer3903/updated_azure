import { useState } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { Lock, Shield, CheckCircle } from 'lucide-react';
import { isDemoMode } from '../config/authConfig';

export default function Login() {
  const { login, isLoading } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleMicrosoftLogin = async () => {
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

  return (
    <div className="login-page">
      {/* Background decoration */}
      <div className="login-bg-decor" />

      {/* Left panel — Branding */}
      <div className="login-left">
        <div className="login-logo">
          <div className="login-logo-icon">
            <span className="b1" /><span className="b2" />
            <span className="b3" /><span className="b4" />
          </div>
          <div>
            <div className="login-logo-text">Azure CloudOps</div>
            <div className="login-logo-sub">ENTERPRISE PORTAL</div>
          </div>
        </div>

        <h1 className="login-tagline">
          Intelligent Cloud<br />
          Operations for<br />
          <span>Azure Enterprises</span>
        </h1>

        <p className="login-desc">
          Unified governance, real-time monitoring, and security management
          across all your Azure subscriptions — powered by Microsoft Entra ID.
        </p>

        <div className="login-features">
          {[
            'Real-time Azure resource discovery',
            'Microsoft Defender for Cloud integration',
            'Cost optimization & budget tracking',
            'Compliance & governance dashboards',
            'Azure Monitor & Sentinel alerts',
            'Multi-subscription management',
          ].map(feature => (
            <div key={feature} className="login-feature">
              <div className="login-feature-dot" />
              <span>{feature}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel — Sign in card */}
      <div className="login-right">
        <div className="login-card">
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: 'linear-gradient(135deg, #0078d4, #00B7C3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
              boxShadow: '0 8px 24px rgba(0,120,212,0.35)',
            }}>
              <Shield size={26} color="white" strokeWidth={1.8} />
            </div>
            <div className="login-card-title">Secure Sign In</div>
            <div className="login-card-subtitle">
              Sign in to access your Azure CloudOps dashboard.
            </div>
          </div>

          {error && (
            <div style={{
              background: 'rgba(244, 67, 54, 0.12)',
              color: '#f44336',
              padding: '10px 14px',
              borderRadius: 6,
              fontSize: 13,
              marginBottom: 16,
              border: '1px solid rgba(244, 67, 54, 0.25)',
            }}>
              {error}
            </div>
          )}

          {!isDemoMode ? (
            /* Production Mode: Microsoft Entra ID Sign in */
            <button
              id="btn-microsoft-signin"
              className="login-microsoft-btn"
              onClick={handleMicrosoftLogin}
              disabled={isLoading || isSigningIn}
              aria-label="Sign in with Microsoft"
            >
              {isLoading || isSigningIn ? (
                <>
                  <div className="spinner spinner-sm" style={{ borderColor: 'rgba(255,255,255,.3)', borderTopColor: 'white' }} />
                  <span>Authenticating…</span>
                </>
              ) : (
                <>
                  <div className="login-microsoft-icon">
                    <span className="q1" /><span className="q2" />
                    <span className="q3" /><span className="q4" />
                  </div>
                  <span>Sign in with Microsoft</span>
                </>
              )}
            </button>
          ) : (
            /* Development Mode: Local Admin Form */
            <form onSubmit={handleLocalLogin}>
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
                  Administrator Email
                </label>
                 <input
                  type="email"
                  required
                  placeholder="Enter email address"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontSize: 13.5,
                  }}
                />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
                  Password
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--border-color)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontSize: 13.5,
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={isLoading || isSigningIn}
                style={{
                  width: '100%',
                  padding: '11px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'var(--accent-color, #0078d4)',
                  color: 'white',
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                {isLoading || isSigningIn ? (
                  <>
                    <div className="spinner spinner-sm" style={{ borderColor: 'rgba(255,255,255,.3)', borderTopColor: 'white' }} />
                    <span>Signing in…</span>
                  </>
                ) : (
                  <span>Sign In</span>
                )}
              </button>
            </form>
          )}

          {/* Trust & compliance badges */}
          <div className="login-trust-badges" style={{ marginTop: 24 }}>
            {[
              { icon: <Lock size={12} />, label: 'Entra ID' },
              { icon: <Shield size={12} />, label: 'Zero Trust' },
              { icon: <CheckCircle size={12} />, label: 'MFA Ready' },
            ].map(badge => (
              <div key={badge.label} className="login-trust-badge">
                {badge.icon}
                <span>{badge.label}</span>
              </div>
            ))}
          </div>

          <p style={{
            fontSize: 11.5,
            color: 'var(--text-tertiary)',
            textAlign: 'center',
            marginTop: 20,
            lineHeight: 1.6,
          }}>
            By signing in you agree to your organization's<br />
            terms of service and acceptable use policy.
          </p>
        </div>
      </div>
    </div>
  );
}
