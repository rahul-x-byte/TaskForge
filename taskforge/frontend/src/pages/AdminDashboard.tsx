import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAdminStats, fetchAdminWorkflows, fetchAdminRuns, AdminStats, WorkflowItem, RunItem } from '../api';
import { Users, Workflow, Play, Clock } from 'lucide-react';

export const AdminDashboard: React.FC = () => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAdminData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [statsData, workflowsData, runsData] = await Promise.all([
        fetchAdminStats(),
        fetchAdminWorkflows(),
        fetchAdminRuns(),
      ]);
      setStats(statsData);
      setWorkflows(workflowsData);
      setRuns(runsData);
    } catch (err: any) {
      setError(err?.message || 'Failed to load admin dashboard data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
        Loading Admin Operations Control Center...
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0, color: '#f8fafc' }}>
              Admin Operations Dashboard
            </h1>
            <span style={{
              background: '#a855f7',
              color: '#ffffff',
              padding: '2px 8px',
              borderRadius: '9999px',
              fontSize: '0.72rem',
              fontWeight: 700,
              textTransform: 'uppercase',
            }}>
              ADMIN CONTROL CENTER
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', color: '#94a3b8', fontSize: '0.85rem' }}>
            Platform-wide workflow orchestration, user accounts, and execution metrics.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <Link
            to="/admin/users"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#0284c7',
              color: '#ffffff',
              padding: '8px 14px',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '0.85rem',
              textDecoration: 'none',
            }}
          >
            <Users size={16} />
            <span>Manage Users</span>
          </Link>
        </div>
      </div>

      {error && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid #ef4444',
          color: '#fca5a5',
          padding: '12px 16px',
          borderRadius: '8px',
          marginBottom: '1.5rem',
        }}>
          {error}
        </div>
      )}

      {/* System Statistics Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '1rem',
        marginBottom: '2rem',
      }}>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#38bdf8' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Total Users</span>
            <Users size={20} />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#f8fafc', marginTop: '6px' }}>
            {stats?.totalUsers || 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
            {stats?.totalAdmins || 0} Admins • {stats?.totalNormalUsers || 0} Users
          </div>
        </div>

        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#a855f7' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Total Workflows</span>
            <Workflow size={20} />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#f8fafc', marginTop: '6px' }}>
            {stats?.totalWorkflows || 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>Across all registered users</div>
        </div>

        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#34d399' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Total Executions</span>
            <Play size={20} />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#f8fafc', marginTop: '6px' }}>
            {stats?.totalRuns || 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#34d399', marginTop: '4px' }}>
            {stats?.successfulRuns || 0} Successful
          </div>
        </div>

        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: '#fbbf24' }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>Active / Pending</span>
            <Clock size={20} />
          </div>
          <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#f8fafc', marginTop: '6px' }}>
            {stats?.currentlyRunning || 0}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '4px' }}>
            {stats?.failedRuns || 0} Failed Runs
          </div>
        </div>
      </div>

      {/* Two Column Layout: Workflows Overview & Recent Audit Log */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '1.5rem' }}>
        {/* Workflows Across Users */}
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f8fafc', fontWeight: 700 }}>
              All Workflows ({workflows.length})
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '350px', overflowY: 'auto' }}>
            {workflows.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No workflows found.</div>
            ) : (
              workflows.map((wf) => (
                <div
                  key={wf.id}
                  style={{
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <Link to={`/workflows/${wf.id}`} style={{ color: '#38bdf8', fontWeight: 700, textDecoration: 'none', fontSize: '0.9rem' }}>
                      {wf.name}
                    </Link>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>
                      Owner: <strong style={{ color: '#e2e8f0' }}>{wf.user_name || 'Unknown'}</strong> ({wf.user_email || 'n/a'})
                    </div>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                    {wf.steps?.length || 0} steps
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Runs Audit Log Across Users */}
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '10px', padding: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f8fafc', fontWeight: 700 }}>
              System Audit History ({runs.length})
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '350px', overflowY: 'auto' }}>
            {runs.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: '0.85rem' }}>No execution history found.</div>
            ) : (
              runs.map((r) => (
                <div
                  key={r.id}
                  style={{
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    padding: '10px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ color: '#f8fafc', fontWeight: 600, fontSize: '0.85rem' }}>
                      {r.workflow_name || r.workflow_id}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                      User: <strong>{r.user_name || 'Unknown'}</strong> • {new Date(r.started_at).toLocaleTimeString()}
                    </div>
                  </div>

                  <span style={{
                    padding: '3px 8px',
                    borderRadius: '4px',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    background: r.status === 'completed' ? 'rgba(52, 211, 153, 0.2)' : r.status === 'failed' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                    color: r.status === 'completed' ? '#34d399' : r.status === 'failed' ? '#f87171' : '#38bdf8',
                  }}>
                    {r.status}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
