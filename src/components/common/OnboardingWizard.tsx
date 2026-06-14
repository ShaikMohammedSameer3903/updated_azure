import { useState } from 'react';
import { Shield, Eye, DollarSign, Settings, CheckCircle2, ChevronRight, X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';

interface OnboardingWizardProps {
  onClose: () => void;
  onComplete: () => void;
}

export default function OnboardingWizard({ onClose, onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [selectedSub, setSelectedSub] = useState('');
  const { subscriptions, setActiveSubscription } = useAppStore();

  const steps = [
    { id: 1, name: 'Connect Azure Account' },
    { id: 2, name: 'Select Subscription' },
    { id: 3, name: 'Enable Monitoring' },
    { id: 4, name: 'Enable Cost Tracking' },
    { id: 5, name: 'Enable Security Monitoring' },
  ];

  const handleNext = () => {
    if (step < 5) {
      setStep(prev => prev + 1);
    } else {
      onComplete();
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      background: 'rgba(12, 15, 29, 0.85)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      fontFamily: 'var(--font-sans, system-ui, sans-serif)'
    }}>
      <div style={{
        background: '#16192b',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: 16,
        width: '90%',
        maxWidth: 600,
        padding: 32,
        boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
        position: 'relative'
      }}>
        <button 
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary, #a0aec0)',
            cursor: 'pointer'
          }}
        >
          <X size={20} />
        </button>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--accent-color, #0078d4)',
            textTransform: 'uppercase',
            letterSpacing: 1.5,
            marginBottom: 8
          }}>
            Enterprise Onboarding
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: 'white', margin: 0 }}>
            Welcome to Azure CloudOps
          </h2>
          <p style={{ color: '#a0aec0', fontSize: 14, marginTop: 4 }}>
            Let's configure your cloud workspace.
          </p>
        </div>

        {/* Steps progress */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: 32,
          position: 'relative'
        }}>
          {steps.map((s, idx) => (
            <div key={s.id} style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              flex: 1,
              position: 'relative',
              zIndex: 2
            }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: step > s.id ? '#107C10' : step === s.id ? 'var(--accent-color, #0078d4)' : '#2d3748',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
                fontSize: 13,
                border: step === s.id ? '2px solid rgba(255,255,255,0.2)' : 'none',
                transition: 'all 0.3s ease'
              }}>
                {step > s.id ? '✓' : s.id}
              </div>
              <span style={{
                fontSize: 10,
                color: step === s.id ? 'white' : '#718096',
                textAlign: 'center',
                marginTop: 8,
                fontWeight: step === s.id ? 600 : 400
              }}>
                {s.name}
              </span>
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div style={{
          background: '#1d2038',
          borderRadius: 12,
          padding: 24,
          minHeight: 220,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          marginBottom: 24
        }}>
          {step === 1 && (
            <div style={{ textAlign: 'center' }}>
              <Shield size={48} color="#0078d4" style={{ marginBottom: 16 }} />
              <h3 style={{ color: 'white', margin: '0 0 8px 0', fontSize: 18 }}>Connect Azure Account</h3>
              <p style={{ color: '#a0aec0', fontSize: 14, margin: '0 auto 16px', maxWidth: 400 }}>
                Authorize with Microsoft Entra ID or supply Azure credentials to securely discover subscription assets.
              </p>
              <div style={{ color: '#107C10', fontWeight: 600, fontSize: 14 }}>
                ✓ Connected as authorized corporate user
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h3 style={{ color: 'white', margin: '0 0 12px 0', fontSize: 18 }}>Select Azure Subscription</h3>
              <p style={{ color: '#a0aec0', fontSize: 14, marginBottom: 16 }}>
                Select an active subscription to import resources. Only resources you have RBAC permissions to will be listed.
              </p>
              <select 
                value={selectedSub}
                onChange={(e) => {
                  setSelectedSub(e.target.value);
                  setActiveSubscription(e.target.value || null);
                }}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: 8,
                  background: '#16192b',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'white',
                  fontSize: 14,
                  outline: 'none'
                }}
              >
                <option value="">Choose a subscription...</option>
                {subscriptions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.displayName || s.name} ({s.subscriptionId || s.subscription_id})
                  </option>
                ))}
                {subscriptions.length === 0 && (
                  <option value="" disabled>No active subscriptions discovered. Connect one in Settings first.</option>
                )}
              </select>
            </div>
          )}

          {step === 3 && (
            <div style={{ textAlign: 'center' }}>
              <Eye size={48} color="#00B7C3" style={{ marginBottom: 16 }} />
              <h3 style={{ color: 'white', margin: '0 0 8px 0', fontSize: 18 }}>Enable Cloud Monitoring</h3>
              <p style={{ color: '#a0aec0', fontSize: 14, margin: '0 auto 16px', maxWidth: 400 }}>
                Activate live metrics tracking for virtual machines, storage accounts, databases, and apps.
              </p>
              <button style={{
                padding: '10px 20px',
                borderRadius: 8,
                background: 'var(--accent-color, #0078d4)',
                color: 'white',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer'
              }}>
                Enable Azure Monitor Integration
              </button>
            </div>
          )}

          {step === 4 && (
            <div style={{ textAlign: 'center' }}>
              <DollarSign size={48} color="#FFB900" style={{ marginBottom: 16 }} />
              <h3 style={{ color: 'white', margin: '0 0 8px 0', fontSize: 18 }}>Enable Cost Tracking</h3>
              <p style={{ color: '#a0aec0', fontSize: 14, margin: '0 auto 16px', maxWidth: 400 }}>
                Import daily consumption data, service costs, and cost optimization recommendations automatically.
              </p>
              <button style={{
                padding: '10px 20px',
                borderRadius: 8,
                background: 'var(--accent-color, #0078d4)',
                color: 'white',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer'
              }}>
                Enable Cost Consumption API
              </button>
            </div>
          )}

          {step === 5 && (
            <div style={{ textAlign: 'center' }}>
              <CheckCircle2 size={48} color="#107C10" style={{ marginBottom: 16 }} />
              <h3 style={{ color: 'white', margin: '0 0 8px 0', fontSize: 18 }}>Secure Cloud Compliance</h3>
              <p style={{ color: '#a0aec0', fontSize: 14, margin: '0 auto 16px', maxWidth: 400 }}>
                Connect Microsoft Defender for Cloud to calculate your organization's Secure Score and compile vulnerability findings.
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, background: 'rgba(16, 124, 16, 0.2)', color: '#107C10', padding: '6px 12px', borderRadius: 16 }}>
                  Defender Active
                </span>
                <span style={{ fontSize: 12, background: 'rgba(0, 120, 212, 0.2)', color: '#0078d4', padding: '6px 12px', borderRadius: 16 }}>
                  Compliance Scopes Configured
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <button 
            disabled={step === 1}
            onClick={() => setStep(prev => prev - 1)}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              background: '#2d3748',
              color: 'white',
              border: 'none',
              cursor: step === 1 ? 'not-allowed' : 'pointer',
              opacity: step === 1 ? 0.5 : 1,
              fontWeight: 600
            }}
          >
            Back
          </button>

          <button 
            onClick={handleNext}
            style={{
              padding: '10px 24px',
              borderRadius: 8,
              background: '#107C10',
              color: 'white',
              border: 'none',
              cursor: 'pointer',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            {step === 5 ? 'Complete Onboarding' : 'Next'}
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
