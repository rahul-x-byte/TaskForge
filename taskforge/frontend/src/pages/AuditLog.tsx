import React, { useEffect, useState } from 'react';
import { fetchAuditLogs, RunItem } from '../api';

interface AuditLogProps {
  onSelectRun: (runId: string) => void;
}

export const AuditLog: React.FC<AuditLogProps> = ({ onSelectRun }) => {
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const data = await fetchAuditLogs();
      setRuns(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading audit log...</div>;

  return (
    <div style={{ padding: '0 1.5rem 2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc' }}>Audit Log</h2>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8' }}>Execution history for the last 20 workflow runs</p>
        </div>
        <div style={{ fontSize: '0.85rem', color: '#94a3b8', background: '#1e293b', padding: '0.5rem 1rem', borderRadius: '8px' }}>
          {runs.length} Recent Execution{runs.length === 1 ? '' : 's'}
        </div>
      </div>

      <div className="glass-panel" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ background: '#1e293b', borderBottom: '1px solid #374151', color: '#94a3b8' }}>
              <th style={{ padding: '0.85rem 1rem' }}>Run ID</th>
              <th style={{ padding: '0.85rem 1rem' }}>Workflow</th>
              <th style={{ padding: '0.85rem 1rem' }}>Status</th>
              <th style={{ padding: '0.85rem 1rem' }}>Started At</th>
              <th style={{ padding: '0.85rem 1rem' }}>Finished At</th>
              <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                  No execution history logged yet.
                </td>
              </tr>
            ) : (
              runs.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #1f2937' }}>
                  <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', color: '#38bdf8' }}>
                    {r.id.slice(0, 8)}...
                  </td>
                  <td style={{ padding: '0.85rem 1rem', color: '#f8fafc', fontWeight: 500 }}>
                    {r.workflow_name || r.workflow_id}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <span className={`badge badge-${r.status}`}>
                      {r.status === 'awaiting_approval' ? 'Awaiting Approval' : r.status}
                    </span>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', color: '#94a3b8' }}>
                    {new Date(r.started_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', color: '#94a3b8' }}>
                    {r.finished_at ? new Date(r.finished_at).toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>
                    <button
                      onClick={() => onSelectRun(r.id)}
                      style={{
                        padding: '0.4rem 0.75rem',
                        borderRadius: '6px',
                        border: '1px solid #475569',
                        background: '#1e293b',
                        color: '#38bdf8',
                        cursor: 'pointer',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                      }}
                    >
                      Inspect Status
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
