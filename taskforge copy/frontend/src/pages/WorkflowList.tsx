import React, { useEffect, useState } from 'react';
import { fetchWorkflows, triggerWorkflowRun, WorkflowItem } from '../api';
import { Play, Eye, Calendar, Layers, Clock } from 'lucide-react';

interface WorkflowListProps {
  onSelectWorkflow: (workflowId: string) => void;
  onOpenRunStatus: (runId: string) => void;
}

export const WorkflowList: React.FC<WorkflowListProps> = ({ onSelectWorkflow, onOpenRunStatus }) => {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const data = await fetchWorkflows();
      setWorkflows(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRun = async (workflowId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setRunningId(workflowId);
      const res = await triggerWorkflowRun(workflowId);
      onOpenRunStatus(res.runId);
    } catch (err) {
      alert('Failed to trigger workflow run');
    } finally {
      setRunningId(null);
    }
  };

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading workflows...</div>;
  }

  return (
    <div style={{ padding: '0 1.5rem 2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc' }}>Recorded Workflows</h2>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8' }}>Manage and trigger browser automation sequences</p>
        </div>
        <div style={{ fontSize: '0.85rem', color: '#94a3b8', background: '#1e293b', padding: '0.5rem 1rem', borderRadius: '8px' }}>
          {workflows.length} Workflow{workflows.length === 1 ? '' : 's'} Stored
        </div>
      </div>

      {workflows.length === 0 ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
          <Layers size={40} color="#64748b" style={{ marginBottom: '1rem' }} />
          <h3 style={{ fontSize: '1.1rem', color: '#f1f5f9', marginBottom: '0.5rem' }}>No Workflows Found</h3>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', maxWidth: '400px', margin: '0 auto' }}>
            Use the TaskForge Chrome Extension to record actions or run the backend seed script to populate sample workflows.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
          {workflows.map((wf) => (
            <div
              key={wf.id}
              className="glass-panel"
              style={{
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'transform 0.2s ease, border-color 0.2s ease',
                cursor: 'pointer',
              }}
              onClick={() => onSelectWorkflow(wf.id)}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#f8fafc', wordBreak: 'break-word' }}>
                    {wf.name}
                  </h3>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                  <span className="badge badge-running">
                    {wf.steps?.length || 0} Steps
                  </span>
                  {wf.schedule ? (
                    <span className="badge badge-completed" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Calendar size={12} /> {wf.schedule.frequency} ({wf.schedule.time})
                    </span>
                  ) : (
                    <span className="badge" style={{ background: '#334155', color: '#94a3b8' }}>
                      Manual Run Only
                    </span>
                  )}
                </div>

                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  <Clock size={12} /> Created: {new Date(wf.created_at).toLocaleString()}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid #374151' }}>
                <button
                  onClick={(e) => handleRun(wf.id, e)}
                  disabled={runningId === wf.id}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    padding: '0.6rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#0284c7',
                    color: '#ffffff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Play size={14} fill="#ffffff" /> {runningId === wf.id ? 'Launching...' : 'Run Now'}
                </button>

                <button
                  onClick={() => onSelectWorkflow(wf.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '0.6rem',
                    borderRadius: '6px',
                    border: '1px solid #475569',
                    background: '#1e293b',
                    color: '#94a3b8',
                    cursor: 'pointer',
                  }}
                  title="View Visual Graph & Schedule"
                >
                  <Eye size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
