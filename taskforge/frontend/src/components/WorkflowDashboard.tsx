import './workflow-dashboard.css';

// Component for displaying workflow list, status badges, and template starters.
// Rendered at frontend/src/components/WorkflowDashboard.tsx

export interface Workflow {
  id: string;
  name: string;
  stepCount: number;
  schedule?: string;
  lastStatus?: 'success' | 'failed' | 'awaiting_approval' | 'never_run';
}

function statusMeta(status?: Workflow['lastStatus']) {
  switch (status) {
    case 'success': return { label: 'Last run succeeded', className: 'badge-success' };
    case 'failed': return { label: 'Last run failed', className: 'badge-danger' };
    case 'awaiting_approval': return { label: 'Awaiting approval', className: 'badge-amber' };
    default: return { label: 'Never run', className: 'badge-neutral' };
  }
}

export default function WorkflowDashboard({
  workflows,
  onRecordNew,
  onSelectWorkflow,
  onRunWorkflow,
}: {
  workflows: Workflow[];
  onUseTemplate?: (templateId: string) => void;
  onRecordNew?: () => void;
  onSelectWorkflow?: (workflowId: string) => void;
  onRunWorkflow?: (workflowId: string, e: React.MouseEvent) => void;
}) {
  const hasWorkflows = workflows.length > 0;

  return (
    <div className="tf-dashboard">
      <div className="tf-dashboard-header">
        <div>
          <h1>Recorded workflows</h1>
          <p className="tf-subtle">Manage and trigger your browser automation sequences</p>
        </div>
        <div className="tf-header-actions">
          <span className="tf-count-pill">{workflows.length} workflow{workflows.length === 1 ? '' : 's'} stored</span>
          <button className="tf-btn-primary" onClick={onRecordNew}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="6" /></svg>
            Record a workflow
          </button>
        </div>
      </div>

      {hasWorkflows ? (
        <div className="tf-workflow-grid">
          {workflows.map((wf) => {
            const meta = statusMeta(wf.lastStatus);
            return (
              <div
                key={wf.id}
                className="tf-workflow-card"
                style={{ cursor: onSelectWorkflow ? 'pointer' : 'default' }}
                onClick={() => onSelectWorkflow?.(wf.id)}
              >
                <div className="tf-workflow-card-top">
                  <span className="tf-workflow-name">{wf.name}</span>
                  <span className={`tf-badge ${meta.className}`}>{meta.label}</span>
                </div>
                <p className="tf-subtle">{wf.stepCount} steps{wf.schedule ? ` · ${wf.schedule}` : ' · manual trigger'}</p>
                <button
                  className="tf-btn-secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onRunWorkflow) {
                      onRunWorkflow(wf.id, e);
                    } else if (onSelectWorkflow) {
                      onSelectWorkflow(wf.id);
                    }
                  }}
                >
                  Run now
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', background: '#1e293b', borderRadius: '12px', border: '1px solid #334155', marginTop: '1.5rem' }}>
          <h2 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>No workflows yet</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Record your automation from any website using the TaskForge Chrome extension.</p>
          <button className="tf-btn-primary" onClick={onRecordNew} style={{ margin: '0 auto' }}>
            Record a workflow
          </button>
        </div>
      )}
    </div>
  );
}
