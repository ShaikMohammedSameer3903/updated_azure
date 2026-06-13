import { useState, useEffect } from 'react';
import { useOperationStore } from '../../store/operationStore';
import { useAppStore } from '../../store/appStore';
import { Activity, Play, Terminal, CheckCircle2, AlertCircle, Clock, Loader2, Sparkles } from 'lucide-react';
import { api } from '../../services/api';

export default function ActivityPanel() {
  const { operations, activeOperationId, setActiveOperationId } = useOperationStore();
  const { isRefreshing, lastResourceSync } = useAppStore();
  const [dbOps, setDbOps] = useState<any[]>([]);
  const [scanDuration, setScanDuration] = useState(0);
  const [scanStatus, setScanStatus] = useState<'Idle' | 'Scanning'>('Idle');
  const [scanStage, setScanStage] = useState(0);

  // Sync operations from database on mount & when operations store changes
  const loadPastOperations = async () => {
    try {
      const data = await api.get<any[]>('/api/actions/operations');
      setDbOps(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadPastOperations();
  }, [operations]);

  // Handle Scan Timer increments in real-time
  useEffect(() => {
    let timer: any = null;
    if (isRefreshing) {
      setScanStatus('Scanning');
      timer = setInterval(() => {
        setScanDuration(prev => prev + 1);
        setScanStage(prev => (prev < 4 ? prev + 1 : 0));
      }, 1000);
    } else {
      setScanStatus('Idle');
      setScanDuration(0);
      setScanStage(0);
      if (timer) clearInterval(timer);
    }
    return () => { if (timer) clearInterval(timer); };
  }, [isRefreshing]);

  const activeOp = operations.find(o => o.status === 'Running') || operations[0];

  const getStageCheck = (stageIndex: number) => {
    if (scanStage >= stageIndex) return <CheckCircle2 size={13} color="#10B981" />;
    if (isRefreshing && scanStage === stageIndex - 1) return <Loader2 size={13} className="animate-spin" color="#38bdf8" />;
    return <div style={{ width: 13, height: 13, border: '1px solid rgba(255,255,255,0.2)', borderRadius: '50%' }} />;
  };

  return (
    <div style={{
      width: 340,
      background: 'var(--bg-secondary, #111424)',
      borderLeft: '1px solid var(--border-default, rgba(255, 255, 255, 0.08))',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflowY: 'auto',
      flexShrink: 0,
      fontFamily: 'Outfit, sans-serif'
    }}>
      {/* 1. Discovery Scan Progress Panel */}
      <div style={{
        padding: 16,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(12, 15, 29, 0.2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={14} color="#38bdf8" />
            <span style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-primary)' }}>
              Discovery Scan Status
            </span>
          </div>
          {scanStatus === 'Scanning' && (
            <span style={{
              fontSize: 10,
              background: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              padding: '2px 8px',
              borderRadius: 20,
              fontWeight: 700,
              animation: 'pulse 1.5s infinite'
            }}>
              Scanning ({scanDuration}s)
            </span>
          )}
        </div>

        {scanStatus === 'Scanning' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, background: 'rgba(0,0,0,0.15)', padding: 12, borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Subscriptions</span>
              {getStageCheck(1)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Resource Groups</span>
              {getStageCheck(2)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Storage Accounts</span>
              {getStageCheck(3)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Virtual Machines</span>
              {getStageCheck(4)}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
            Last discovery check: {lastResourceSync ? new Date(lastResourceSync).toLocaleTimeString() : 'Unknown'}
          </div>
        )}
      </div>

      {/* 2. Active Operation Manager */}
      {activeOp && (
        <div style={{
          padding: 16,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(0,0,0,0.1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Activity size={14} color="#0078d4" />
            <span style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-primary)' }}>
              Active Azure Provisioning
            </span>
          </div>

          <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{activeOp.name}</span>
              <span style={{
                fontSize: 10,
                color: activeOp.status === 'Succeeded' ? '#10B981' : activeOp.status === 'Failed' ? '#EF4444' : '#38bdf8',
                fontWeight: 700
              }}>
                {activeOp.status}
              </span>
            </div>

            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Stage: <strong>{activeOp.stage}</strong> | Est. Time: {activeOp.timeRemaining}
            </div>

            {/* Progress Bar */}
            <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
              <div style={{
                width: `${activeOp.percent}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #0078d4, #38bdf8)',
                transition: 'width 0.4s ease'
              }} />
            </div>

            {/* Logs window terminal */}
            {activeOp.logs && activeOp.logs.length > 0 && (
              <div style={{
                background: '#090d16',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: 6,
                padding: '8px 10px',
                maxHeight: 110,
                overflowY: 'auto',
                fontFamily: 'Consolas, monospace',
                fontSize: 9.5,
                color: '#34d399',
                display: 'flex',
                flexDirection: 'column',
                gap: 4
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4, marginBottom: 4 }}>
                  <Terminal size={10} />
                  <span>Live Stream Logs</span>
                </div>
                {activeOp.logs.map((l, index) => (
                  <div key={index} style={{ wordBreak: 'break-all' }}>
                    &gt; {l.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Enterprise Activity Timeline */}
      <div style={{ padding: 16, flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Clock size={14} color="#f59e0b" />
          <span style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-primary)' }}>
            Enterprise Activity Log
          </span>
        </div>

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflowY: 'auto',
          flex: 1,
          paddingRight: 4
        }}>
          {dbOps.length > 0 ? (
            dbOps.map((op) => (
              <div key={op.id} style={{
                position: 'relative',
                paddingLeft: 16,
                borderLeft: `2px solid ${op.status === 'Succeeded' ? '#10B981' : op.status === 'Failed' ? '#EF4444' : '#38bdf8'}`
              }}>
                <div style={{
                  position: 'absolute',
                  left: -5,
                  top: 3,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: op.status === 'Succeeded' ? '#10B981' : op.status === 'Failed' ? '#EF4444' : '#38bdf8'
                }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{op.name}</span>
                  <span style={{ fontSize: 9.5, color: 'var(--text-tertiary)' }}>
                    {new Date(op.created_at).toLocaleTimeString()}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {op.stage} • User: {op.user_email}
                </div>
              </div>
            ))
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center', marginTop: 20 }}>
              No recent activity recorded.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
