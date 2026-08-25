import React, { useEffect, useState } from 'react';
import { Layers, Server, Clock, Settings, AlertCircle, CheckCircle2 } from 'lucide-react';
import { API_BASE, setApiBase, checkBackendHealth, DEFAULT_PROD_BACKEND_URL } from '../api';

interface NavbarProps {
  activeTab: 'workflows' | 'audit' | 'detail' | 'run';
  setActiveTab: (tab: 'workflows' | 'audit') => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab }) => {
  const [isConnected, setIsConnected] = useState<boolean | null>(null);

  useEffect(() => {
    let isMounted = true;
    const verifyHealth = async () => {
      const ok = await checkBackendHealth();
      if (isMounted) setIsConnected(ok);
    };
    verifyHealth();
    const interval = setInterval(verifyHealth, 6000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const isProductionBackend = API_BASE.includes('onrender.com');
  const serverLabel = isConnected === null
    ? 'Checking Backend...'
    : isConnected
    ? (isProductionBackend ? 'Backend Connected (Render)' : 'Backend Connected (Local)')
    : 'Backend Disconnected';

  const handleConfigureBackend = () => {
    const currentBase = API_BASE.includes('<YOUR-ACTIVE-BACKEND-URL>') ? DEFAULT_PROD_BACKEND_URL : API_BASE;
    const input = window.prompt(
      'Enter your active Backend API URL (e.g. https://taskforge-backend-ta41.onrender.com/api or http://localhost:3001/api):',
      currentBase
    );
    if (input && input.trim() && !input.includes('<YOUR-ACTIVE-BACKEND-URL>')) {
      setApiBase(input.trim());
    }
  };

  const badgeColor = isConnected === false ? '#f87171' : isConnected ? '#34d399' : '#fbbf24';
  const badgeBg = isConnected === false ? 'rgba(248, 113, 113, 0.15)' : isConnected ? 'rgba(52, 211, 153, 0.1)' : 'rgba(251, 191, 36, 0.15)';
  const badgeBorder = isConnected === false ? 'rgba(248, 113, 113, 0.3)' : isConnected ? 'rgba(52, 211, 153, 0.2)' : 'rgba(251, 191, 36, 0.3)';

  return (
    <header className="glass-panel" style={{ margin: '1rem 1.5rem', padding: '0.85rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ background: 'linear-gradient(135deg, #0284c7, #6366f1)', padding: '0.5rem', borderRadius: '8px', display: 'flex', alignItems: 'center' }}>
          <Layers size={22} color="#ffffff" />
        </div>
        <div>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 700, letterSpacing: '-0.02em', background: 'linear-gradient(to right, #38bdf8, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            TaskForge
          </h1>
          <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>Browser Automation & Workflow Orchestrator</p>
        </div>
      </div>

      <nav style={{ display: 'flex', gap: '0.5rem' }}>
        <button
          onClick={() => setActiveTab('workflows')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            borderRadius: '6px',
            border: 'none',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            background: activeTab === 'workflows' || activeTab === 'detail' ? '#1e293b' : 'transparent',
            color: activeTab === 'workflows' || activeTab === 'detail' ? '#38bdf8' : '#94a3b8',
          }}
        >
          <Layers size={16} /> Workflows
        </button>

        <button
          onClick={() => setActiveTab('audit')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            borderRadius: '6px',
            border: 'none',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            background: activeTab === 'audit' ? '#1e293b' : 'transparent',
            color: activeTab === 'audit' ? '#38bdf8' : '#94a3b8',
          }}
        >
          <Clock size={16} /> Audit Log
        </button>
      </nav>

      <div
        onClick={handleConfigureBackend}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.8rem',
          color: badgeColor,
          background: badgeBg,
          padding: '0.35rem 0.75rem',
          borderRadius: '9999px',
          cursor: 'pointer',
          border: `1px solid ${badgeBorder}`,
          transition: 'all 0.2s ease',
        }}
        title={`Connected API: ${API_BASE} (Click to change backend URL)`}
      >
        {isConnected === false ? <AlertCircle size={14} /> : isConnected ? <CheckCircle2 size={14} /> : <Server size={14} />}
        {serverLabel}
        <Settings size={12} style={{ opacity: 0.7 }} />
      </div>
    </header>
  );
};
