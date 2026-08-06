import React, { useEffect, useState } from 'react';
import { approveRunGate, cancelRunGate, fetchRunById, fetchWorkflowById, RunItem, WorkflowItem } from '../api';
import { ArrowLeft, CheckCircle2, AlertTriangle, ShieldAlert, XCircle } from 'lucide-react';

interface RunStatusPageProps {
  runId: string;
  onBack: () => void;
}

export const RunStatusPage: React.FC<RunStatusPageProps> = ({ runId, onBack }) => {
  const [run, setRun] = useState<RunItem | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvalModalData, setApprovalModalData] = useState<any | null>(null);

  const loadData = async () => {
    try {
      const data = await fetchRunById(runId);
      setRun(data.run);

      if (data.run.workflow_id) {
        const wf = await fetchWorkflowById(data.run.workflow_id);
        setWorkflow(wf);
      }

      if (data.run.status === 'awaiting_approval') {
        setApprovalModalData({ runId, stepDetail: 'Sensitive action requiring manual signoff' });
      } else {
        setApprovalModalData(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Connect to WebSocket endpoint
    const ws = new WebSocket(`ws://localhost:3001/ws/runs/${runId}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('[Run WS Event]', msg);
        if (msg.type === 'STATUS_UPDATE' || msg.type === 'APPROVAL_GRANTED' || msg.type === 'RUN_CANCELLED') {
          if (msg.status === 'awaiting_approval') {
            setApprovalModalData(msg.detail || { runId, stepDetail: 'Sensitive step requiring signoff' });
          } else {
            setApprovalModalData(null);
          }
          loadData();
        }
      } catch (err) {}
    };

    // Polling fallback every 3 seconds
    const interval = setInterval(loadData, 3000);

    return () => {
      ws.close();
      clearInterval(interval);
    };
  }, [runId]);

  const handleApprove = async () => {
    try {
      await approveRunGate(runId);
      setApprovalModalData(null);
      loadData();
    } catch (err) {
      alert('Failed to approve run');
    }
  };

  const handleCancel = async () => {
    try {
      await cancelRunGate(runId);
      setApprovalModalData(null);
      loadData();
    } catch (err) {
      alert('Failed to cancel run');
    }
  };

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading run status...</div>;
  if (!run) return <div style={{ padding: '3rem', textAlign: 'center', color: '#f87171' }}>Run not found</div>;

  const steps = workflow?.steps || [];

  return (
    <div style={{ padding: '0 1.5rem 2rem' }}>
      <button
        onClick={onBack}
        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', marginBottom: '1rem' }}
      >
        <ArrowLeft size={16} /> Back to Workflows
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc' }}>
            Run Execution Status
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8' }}>Run ID: {run.id}</p>
        </div>

        <span className={`badge badge-${run.status}`} style={{ fontSize: '0.85rem', padding: '6px 14px' }}>
          {run.status === 'awaiting_approval' ? 'Awaiting Approval' : run.status}
        </span>
      </div>

      {/* Step Execution Timeline */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: '#f8fafc' }}>Execution Timeline</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {steps.map((step: any, idx: number) => {
            const isSensitive = step.isSensitive || step.action === 'submit';
            return (
              <div key={idx} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: run.status === 'completed' ? '#059669' : run.status === 'failed' ? '#dc2626' : '#1e293b',
                      border: '2px solid #475569',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: '#ffffff',
                    }}
                  >
                    {idx + 1}
                  </div>
                  {idx < steps.length - 1 && (
                    <div style={{ width: '2px', height: '32px', background: '#374151', margin: '4px 0' }} />
                  )}
                </div>

                <div style={{ flex: 1, background: '#1e293b', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #374151' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: '#f8fafc', fontSize: '0.9rem' }}>
                      Step {idx + 1}: {step.action}
                    </span>
                    {isSensitive && (
                      <span className="badge badge-awaiting_approval" style={{ fontSize: '0.7rem' }}>
                        <ShieldAlert size={12} /> Sensitive Gate
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
                    Target: {step.selectors?.text || step.selectors?.name || step.selectors?.css || step.value || step.pageUrl}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Failure Diagnostic View */}
      {run.status === 'failed' && (
        <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid #f43f5e' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f43f5e', fontWeight: 600, marginBottom: '0.75rem' }}>
            <AlertTriangle size={20} /> Execution Error & Diagnostic Capture
          </div>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', marginBottom: '1rem' }}>
            A step failure occurred during execution. Screenshot and Playwright trace were captured.
          </p>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ background: '#0f172a', padding: '0.75rem 1rem', borderRadius: '6px', fontSize: '0.85rem', color: '#cbd5e1' }}>
              📁 Screenshots: <code>worker/failures/*.png</code>
            </div>
            <div style={{ background: '#0f172a', padding: '0.75rem 1rem', borderRadius: '6px', fontSize: '0.85rem', color: '#cbd5e1' }}>
              📦 Playwright Trace: <code>worker/failures/*.zip</code>
            </div>
          </div>
        </div>
      )}

      {/* Approval Gate Modal */}
      {approvalModalData && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#fb7185', marginBottom: '1rem' }}>
              <ShieldAlert size={28} />
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: '#f8fafc' }}>Approval Required</h3>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0 }}>Workflow execution paused at sensitive step</p>
              </div>
            </div>

            <div style={{ background: '#1e293b', border: '1px solid #374151', padding: '1rem', borderRadius: '8px', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.25rem' }}>Action Description</div>
              <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                The workflow is preparing to execute a sensitive action (form submit / login / payment). Please review and decide whether to approve.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={handleCancel}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem', borderRadius: '8px', border: 'none', background: '#dc2626', color: '#ffffff', fontWeight: 600, cursor: 'pointer' }}
              >
                <XCircle size={16} /> Abort Execution
              </button>
              <button
                onClick={handleApprove}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem', borderRadius: '8px', border: 'none', background: '#059669', color: '#ffffff', fontWeight: 600, cursor: 'pointer' }}
              >
                <CheckCircle2 size={16} /> Approve & Resume
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
