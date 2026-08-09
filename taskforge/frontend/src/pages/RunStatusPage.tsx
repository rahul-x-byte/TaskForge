import React, { useEffect, useState } from 'react';
import { approveRunGate, cancelRunGate, fetchRunById, fetchWorkflowById, getWsBase, RunItem, WorkflowItem } from '../api';
import { ArrowLeft, CheckCircle2, AlertTriangle, ShieldAlert, XCircle, KeyRound, Clock, FileText, Eye, Download } from 'lucide-react';

interface RunStatusPageProps {
  runId: string;
  onBack: () => void;
}

export const RunStatusPage: React.FC<RunStatusPageProps> = ({ runId, onBack }) => {
  const [run, setRun] = useState<RunItem | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvalModalData, setApprovalModalData] = useState<any | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const loadData = async () => {
    try {
      const data = await fetchRunById(runId);
      setRun(data.run);

      let wfSteps: any[] = [];
      if (data.run.workflow_id) {
        const wf = await fetchWorkflowById(data.run.workflow_id);
        setWorkflow(wf);
        wfSteps = wf.steps || [];
      }

      if (data.run.status === 'awaiting_approval') {
        const stepIdx = data.run.detail?.stepIndex ?? 0;
        const stepObj = wfSteps[stepIdx] || {};
        setApprovalModalData(data.run.detail || {
          stepIndex: stepIdx,
          action: stepObj.action || 'action',
          targetLabel: stepObj.selectors?.name || stepObj.selectors?.text || stepObj.selectors?.css || 'Target element',
          pageUrl: stepObj.pageUrl || '',
        });
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

    // Connect to WebSocket endpoint using derived WS base URL
    const ws = new WebSocket(`${getWsBase()}/ws/runs/${runId}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('[Run WS Event]', msg);
        if (msg.type === 'STATUS_UPDATE' || msg.type === 'APPROVAL_GRANTED' || msg.type === 'RUN_CANCELLED' || msg.type === 'CREDENTIALS_REQUIRED' || msg.type === 'CREDENTIALS_SUBMITTED') {
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
    if (submitting) return;
    setSubmitting(true);
    setApprovalModalData(null);
    try {
      await approveRunGate(runId);
      await loadData();
    } catch (err) {
      alert('Failed to approve run');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (submitting) return;
    setSubmitting(true);
    setApprovalModalData(null);
    try {
      await cancelRunGate(runId);
      await loadData();
    } catch (err) {
      alert('Failed to cancel run');
    } finally {
      setSubmitting(false);
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
          {run.status === 'awaiting_approval' ? 'Awaiting Approval' : run.status === 'awaiting_credentials' ? 'Awaiting Credentials' : run.status === 'awaiting_login' ? 'Interactive Login & CAPTCHA' : run.status === 'timed_out' ? 'Timed Out' : run.status}
        </span>
      </div>

      {/* Step Execution Timeline */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '1rem', color: '#f8fafc' }}>Execution Timeline</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {steps.map((step: any, idx: number) => {
            const activeStepIdx = run.detail?.stepIndex ?? run.current_step_index ?? 0;
            const isCompleted = run.status === 'completed' || (run.status !== 'failed' && run.status !== 'cancelled' && idx < activeStepIdx);
            const isCurrent = run.status !== 'completed' && run.status !== 'failed' && run.status !== 'cancelled' && idx === activeStepIdx;
            const isSensitive = step.isSensitive === true;

            return (
              <div key={idx} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', opacity: isCurrent || isCompleted ? 1 : 0.6 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      background: isCurrent ? '#38bdf8' : isCompleted ? '#059669' : (run.status === 'failed' || run.status === 'timed_out') && idx === activeStepIdx ? '#dc2626' : '#1e293b',
                      border: isCurrent ? '2px solid #38bdf8' : isCompleted ? '2px solid #10b981' : '2px solid #475569',
                      boxShadow: isCurrent ? '0 0 12px rgba(56, 189, 248, 0.6)' : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: isCurrent ? '#0f172a' : '#ffffff',
                    }}
                  >
                    {isCompleted ? <CheckCircle2 size={16} /> : idx + 1}
                  </div>
                  {idx < steps.length - 1 && (
                    <div style={{ width: '2px', height: '32px', background: isCompleted ? '#10b981' : '#374151', margin: '4px 0' }} />
                  )}
                </div>

                <div
                  style={{
                    flex: 1,
                    background: isCurrent ? 'rgba(56, 189, 248, 0.08)' : '#1e293b',
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    border: isCurrent ? '1px solid #38bdf8' : isCompleted ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid #374151',
                    boxShadow: isCurrent ? '0 0 14px rgba(56, 189, 248, 0.15)' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600, color: isCurrent ? '#38bdf8' : '#f8fafc', fontSize: '0.9rem' }}>
                      Step {idx + 1}: {step.action}
                      {isCurrent && <span style={{ marginLeft: '8px', fontSize: '0.7rem', color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>● Current Step</span>}
                    </span>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      {isCurrent && run.status === 'awaiting_approval' && (
                        <span className="badge badge-awaiting_approval" style={{ fontSize: '0.7rem' }}>
                          <ShieldAlert size={12} /> Paused for Approval
                        </span>
                      )}
                      {isCurrent && run.status === 'awaiting_login' && (
                        <span className="badge badge-awaiting_login" style={{ fontSize: '0.7rem' }}>
                          Interactive Login & CAPTCHA
                        </span>
                      )}
                      {isCurrent && run.status === 'running' && (
                        <span className="badge" style={{ background: '#0284c7', color: '#fff', fontSize: '0.7rem' }}>
                          Executing...
                        </span>
                      )}
                      {isCompleted && (
                        <span style={{ fontSize: '0.75rem', color: '#34d399', fontWeight: 600 }}>Completed</span>
                      )}
                      {isSensitive && !isCurrent && (
                        <span className="badge badge-amber" style={{ fontSize: '0.7rem' }}>
                          <ShieldAlert size={12} /> Sensitive Gate
                        </span>
                      )}
                    </div>
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

      {/* Interactive In-Browser Login Banner */}
      {(run.status === 'awaiting_credentials' || run.status === 'awaiting_login') && (
        <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid #38bdf8', background: 'rgba(56, 189, 248, 0.05)', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#38bdf8', fontWeight: 600, marginBottom: '0.5rem' }}>
            <KeyRound size={22} /> Interactive In-Browser Login & CAPTCHA Active
          </div>
          <p style={{ fontSize: '0.875rem', color: '#cbd5e1', margin: 0, lineHeight: 1.5 }}>
            Please enter your credentials and solve CAPTCHA directly on your college portal in the open browser window.
            <br />
            <span style={{ color: '#38bdf8', fontWeight: 600 }}>TaskForge will automatically detect when you log in and navigate to the next page, then auto-resume all remaining steps!</span>
          </p>
        </div>
      )}

      {/* Completed View */}
      {run.status === 'completed' && (
        <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid #10b981', background: 'rgba(16, 185, 129, 0.05)', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#10b981', fontWeight: 600, marginBottom: run.detail?.downloadedFilePath ? '0.75rem' : '0' }}>
            <CheckCircle2 size={22} /> Workflow Execution Completed Successfully
          </div>

          {/* Adaptive Download & Report Preview Center: ONLY rendered when a real file download occurred */}
          {run.detail?.downloadedFilePath && (
            <>
              <div style={{ background: '#0f172a', border: '1px solid #059669', padding: '1rem 1.25rem', borderRadius: '8px', marginTop: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <FileText size={28} style={{ color: '#34d399' }} />
                    <div>
                      <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f8fafc' }}>
                        {run.detail?.downloadFilename || 'Downloaded Report File'}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>
                        Captured from web portal
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button
                      onClick={() => setShowPreview(!showPreview)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.55rem 1.1rem',
                        borderRadius: '8px',
                        border: '1px solid #38bdf8',
                        background: showPreview ? '#0284c7' : 'rgba(56, 189, 248, 0.12)',
                        color: '#ffffff',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                      }}
                    >
                      <Eye size={16} /> {showPreview ? 'Close Preview' : 'Preview Report'}
                    </button>

                    <a
                      href={`http://localhost:3001/api/runs/${runId}/download`}
                      download
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.55rem 1.1rem',
                        borderRadius: '8px',
                        border: 'none',
                        background: '#059669',
                        color: '#ffffff',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        textDecoration: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      <Download size={16} /> Download File
                    </a>
                  </div>
                </div>

                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.75rem', borderTop: '1px solid #1e293b', paddingTop: '0.5rem' }}>
                  Local Disk Path: <code>{run.detail.downloadedFilePath}</code>
                </div>
              </div>

              {showPreview && (
                <div style={{ marginTop: '1rem', border: '1px solid #374151', borderRadius: '8px', overflow: 'hidden', background: '#0f172a' }}>
                  <div style={{ padding: '0.6rem 1rem', background: '#1e293b', borderBottom: '1px solid #374151', fontSize: '0.8rem', color: '#94a3b8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>📄 Document Viewer</span>
                    <span style={{ fontSize: '0.75rem', color: '#38bdf8' }}>http://localhost:3001/api/runs/{runId}/preview</span>
                  </div>
                  <iframe
                    src={`http://localhost:3001/api/runs/${runId}/preview`}
                    style={{ width: '100%', height: '520px', border: 'none', background: '#ffffff' }}
                    title="Report Preview"
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

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

      {/* Timed Out View */}
      {run.status === 'timed_out' && (
        <div className="glass-panel" style={{ padding: '1.5rem', border: '1px solid #f59e0b' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f59e0b', fontWeight: 600, marginBottom: '0.75rem' }}>
            <Clock size={20} /> Execution Timed Out
          </div>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8', margin: 0 }}>
            This run timed out after waiting more than 15 minutes for manual approval or credential input.
          </p>
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
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc', marginBottom: '0.4rem' }}>
                Step {(approvalModalData.stepIndex ?? 0) + 1}{approvalModalData.totalSteps ? ` of ${approvalModalData.totalSteps}` : ''}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#e2e8f0', marginBottom: '0.4rem' }}>
                About to execute <strong>{approvalModalData.action || 'action'}</strong> on <code style={{ color: '#38bdf8' }}>{approvalModalData.targetLabel || 'target element'}</code>
              </div>
              {approvalModalData.pageUrl && (
                <div style={{ fontSize: '0.78rem', color: '#94a3b8', wordBreak: 'break-all' }}>
                  Target Page: <span style={{ color: '#cbd5e1' }}>{approvalModalData.pageUrl}</span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={handleCancel}
                disabled={submitting}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem', borderRadius: '8px', border: 'none', background: '#dc2626', color: '#ffffff', fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}
              >
                <XCircle size={16} /> {submitting ? 'Aborting...' : 'Abort Execution'}
              </button>
              <button
                onClick={handleApprove}
                disabled={submitting}
                style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.75rem', borderRadius: '8px', border: 'none', background: '#059669', color: '#ffffff', fontWeight: 600, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}
              >
                <CheckCircle2 size={16} /> {submitting ? 'Resuming...' : 'Approve & Resume'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
