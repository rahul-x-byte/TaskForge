import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Layers, Server, Clock, Settings, AlertCircle, CheckCircle2, Shield, Users, LogOut } from 'lucide-react';
import { API_BASE, setApiBase, checkBackendHealth, DEFAULT_PROD_BACKEND_URL } from '../api';
import { useAuth } from '../auth/AuthContext';

export const Navbar: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

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
    ? 'Checking...'
    : isConnected
    ? (isProductionBackend ? 'Render Backend' : 'Local Backend')
    : 'Disconnected';

  const handleConfigureBackend = () => {
    const currentBase = API_BASE.includes('<YOUR-ACTIVE-BACKEND-URL>') ? DEFAULT_PROD_BACKEND_URL : API_BASE;
    const input = window.prompt(
      'Enter your active Backend API URL (e.g. https://taskforge-backend-ta4i.onrender.com/api or http://localhost:3001/api):',
      currentBase
    );
    if (input && input.trim() && !input.includes('<YOUR-ACTIVE-BACKEND-URL>')) {
      setApiBase(input.trim());
    }
  };

  const badgeColor = isConnected === false ? '#f87171' : isConnected ? '#34d399' : '#fbbf24';
  const badgeBg = isConnected === false ? 'rgba(248, 113, 113, 0.15)' : isConnected ? 'rgba(52, 211, 153, 0.1)' : 'rgba(251, 191, 36, 0.15)';
  const badgeBorder = isConnected === false ? 'rgba(248, 113, 113, 0.3)' : isConnected ? 'rgba(52, 211, 153, 0.2)' : 'rgba(251, 191, 36, 0.3)';

  const path = location.pathname;

  return (
    <header className="glass-panel" style={{ margin: '1rem 1.5rem', padding: '0.85rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
      {/* Brand */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <Link to={user?.role === 'admin' ? '/admin' : '/dashboard'} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
          <div style={{ background: 'linear-gradient(135deg, #0284c7, #6366f1)', padding: '0.5rem', borderRadius: '8px', display: 'flex', alignItems: 'center' }}>
            <Layers size={22} color="#ffffff" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '1.2rem', fontWeight: 800, letterSpacing: '-0.02em', background: 'linear-gradient(to right, #38bdf8, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', margin: 0 }}>
                TaskForge
              </h1>
              {user && (
                <span style={{
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  padding: '2px 7px',
                  borderRadius: '9999px',
                  textTransform: 'uppercase',
                  background: user.role === 'admin' ? 'rgba(168, 85, 247, 0.25)' : 'rgba(52, 211, 153, 0.25)',
                  color: user.role === 'admin' ? '#c084fc' : '#34d399',
                  border: `1px solid ${user.role === 'admin' ? '#a855f7' : '#059669'}`,
                }}>
                  {user.role}
                </span>
              )}
            </div>
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: 0 }}>Browser Automation Orchestrator</p>
          </div>
        </Link>
      </div>

      {/* Navigation Links */}
      {user && (
        <nav style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          {user.role === 'admin' && (
            <>
              <Link
                to="/admin"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                  background: path === '/admin' ? '#1e293b' : 'transparent',
                  color: path === '/admin' ? '#a855f7' : '#94a3b8',
                }}
              >
                <Shield size={16} /> Admin Dashboard
              </Link>

              <Link
                to="/admin/users"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.45rem 0.85rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  textDecoration: 'none',
                  background: path === '/admin/users' ? '#1e293b' : 'transparent',
                  color: path === '/admin/users' ? '#a855f7' : '#94a3b8',
                }}
              >
                <Users size={16} /> Users
              </Link>
            </>
          )}

          <Link
            to="/dashboard"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.85rem',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 600,
              textDecoration: 'none',
              background: path === '/dashboard' || path === '/' ? '#1e293b' : 'transparent',
              color: path === '/dashboard' || path === '/' ? '#38bdf8' : '#94a3b8',
            }}
          >
            <Layers size={16} /> Workflows
          </Link>

          <Link
            to="/audit"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.85rem',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 600,
              textDecoration: 'none',
              background: path === '/audit' ? '#1e293b' : 'transparent',
              color: path === '/audit' ? '#38bdf8' : '#94a3b8',
            }}
          >
            <Clock size={16} /> Audit Log
          </Link>
        </nav>
      )}

      {/* Backend Status & User Profile / Logout */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div
          onClick={handleConfigureBackend}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.75rem',
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
          <span>{serverLabel}</span>
          <Settings size={12} style={{ opacity: 0.7 }} />
        </div>

        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderLeft: '1px solid #334155', paddingLeft: '0.75rem' }}>
            <div style={{ fontSize: '0.8rem', textAlign: 'right' }}>
              <div style={{ color: '#f8fafc', fontWeight: 600 }}>{user.name}</div>
              <div style={{ color: '#64748b', fontSize: '0.7rem' }}>{user.email}</div>
            </div>
            <button
              onClick={() => {
                logout();
                navigate('/login');
              }}
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                padding: '6px 10px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.75rem',
                fontWeight: 600,
              }}
              title="Sign Out"
            >
              <LogOut size={14} />
              <span>Logout</span>
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link
              to="/login"
              style={{
                background: '#0284c7',
                color: '#ffffff',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Login
            </Link>
            <Link
              to="/register"
              style={{
                background: '#334155',
                color: '#f8fafc',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.8rem',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Register
            </Link>
          </div>
        )}
      </div>
    </header>
  );
};
