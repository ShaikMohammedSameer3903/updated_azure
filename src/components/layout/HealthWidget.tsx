import { useState, useEffect } from 'react';
import { Activity, ShieldAlert, Heart, RefreshCw } from 'lucide-react';

interface HealthData {
  frontend: string;
  backend: string;
  database: string;
  azure: string;
  authentication: string;
  sse: string;
  discoveryEngine: string;
  securityScanner: string;
  costEngine: string;
}

export default function HealthWidget({ collapsed }: { collapsed: boolean }) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const response = await fetch(`${apiBase}/api/health/diagnose`);
      if (response.ok) {
        const data = await response.json();
        setHealth(data);
      }
    } catch (err) {
      console.error('Failed to poll platform health:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status: string) => {
    if (status === 'Healthy') return '#10B981'; // Green
    if (status === 'Warning') return '#F59E0B'; // Amber
    return '#EF4444'; // Red
  };

  if (collapsed) {
    // Mini heart rate display when sidebar is collapsed
    const worstStatus = health
      ? Object.values(health).some(s => s === 'Critical') ? 'Critical' : Object.values(health).some(s => s === 'Warning') ? 'Warning' : 'Healthy'
      : 'Healthy';
    
    return (
      <div 
        style={{
          padding: '12px 0',
          display: 'flex',
          justifyContent: 'center',
          borderTop: '1px solid var(--border-default, rgba(255,255,255,0.06))'
        }}
        title={`Platform Health: ${worstStatus}`}
      >
        <Activity size={18} color={getStatusColor(worstStatus)} />
      </div>
    );
  }

  return (
    <div style={{
      padding: '12px 14px',
      margin: '8px 12px 12px',
      background: 'rgba(12, 15, 29, 0.4)',
      border: '1px solid var(--border-default, rgba(255, 255, 255, 0.05))',
      borderRadius: 10,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        paddingBottom: 6
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Heart size={13} color="#ef4444" fill="#ef4444" />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
            Platform Health
          </span>
        </div>
        {loading && <RefreshCw size={10} className="animate-spin" style={{ color: 'var(--text-tertiary)' }} />}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '6px 12px',
        fontSize: 10.5
      }}>
        {[
          { label: 'Frontend', key: 'frontend' },
          { label: 'Backend', key: 'backend' },
          { label: 'Database', key: 'database' },
          { label: 'Azure', key: 'azure' },
          { label: 'Auth', key: 'authentication' },
          { label: 'SSE', key: 'sse' },
          { label: 'Discovery', key: 'discoveryEngine' },
          { label: 'Security', key: 'securityScanner' },
          { label: 'Cost', key: 'costEngine' }
        ].map(item => {
          const status = health ? (health as any)[item.key] || 'Healthy' : 'Healthy';
          return (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{item.label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  background: getStatusColor(status)
                }} />
                <span style={{ fontSize: 9.5, fontWeight: 600, color: getStatusColor(status) }}>
                  {status}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
