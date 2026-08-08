import React from 'react';
import { Layers, Server, Clock } from 'lucide-react';
import { API_BASE } from '../api';

interface NavbarProps {
  activeTab: 'workflows' | 'audit' | 'detail' | 'run';
  setActiveTab: (tab: 'workflows' | 'audit') => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeTab, setActiveTab }) => {
  const isProductionBackend = API_BASE.includes('onrender.com');
  const serverLabel = isProductionBackend ? 'Backend Ready (Render)' : 'Backend Ready (Port 3001)';
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

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#34d399', background: 'rgba(52, 211, 153, 0.1)', padding: '0.35rem 0.75rem', borderRadius: '9999px' }}>
        <Server size={14} /> {serverLabel}
      </div>
    </header>
  );
};
