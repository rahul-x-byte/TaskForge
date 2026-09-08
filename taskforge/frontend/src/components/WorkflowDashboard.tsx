import React, { useState } from 'react';
import './workflow-dashboard.css';
import { WorkflowEditModal } from './WorkflowEditModal';
import { deleteWorkflow } from '../api';
import { Play, Edit3, Trash2, AlertTriangle } from 'lucide-react';

export interface Workflow {
  id: string;
  name: string;
  stepCount: number;
  schedule?: string;
  lastStatus?: 'success' | 'failed' | 'awaiting_approval' | 'never_run';
  latestRunId?: string;
  created_at?: string;
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
  onOpenRunStatus,
  onRefresh,
}: {
  workflows: Workflow[];
  onRecordNew?: () => void;
  onSelectWorkflow?: (workflowId: string) => void;
  onRunWorkflow?: (workflowId: string, e: React.MouseEvent) => void;
  onOpenRunStatus?: (runId: string) => void;
  onRefresh?: () => void;
}) {
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [deletingWorkflow, setDeletingWorkflow] = useState<Workflow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const hasWorkflows = workflows.length > 0;

  const handleConfirmDelete = async () => {
    if (!deletingWorkflow) return;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      await deleteWorkflow(deletingWorkflow.id);
      setDeletingWorkflow(null);
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete workflow. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="tf-dashboard">
      <div className="tf-dashboard-header">
        <div>
          <h1>Recorded workflows</h1>
          <p className="tf-subtle">Manage and trigger your browser automation sequences</p>
        </div>
        <div className="tf-header-actions" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
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
                onClick={() => {
                  if (wf.lastStatus === 'awaiting_approval' && wf.latestRunId && onOpenRunStatus) {
                    onOpenRunStatus(wf.latestRunId);
                  } else {
                    onSelectWorkflow?.(wf.id);
                  }
                }}
              >
                <div className="tf-workflow-card-top">
                  <span className="tf-workflow-name">{wf.name}</span>
                  <span
                    className={`tf-badge ${meta.className}`}
                    style={{ cursor: wf.latestRunId && onOpenRunStatus ? 'pointer' : 'default' }}
                    onClick={(e) => {
                      if (wf.latestRunId && onOpenRunStatus) {
                        e.stopPropagation();
                        onOpenRunStatus(wf.latestRunId);
                      }
                    }}
                    title={wf.latestRunId ? 'Click to view run details & approval' : undefined}
                  >
                    {meta.label}
                  </span>
                </div>
                <p className="tf-subtle">
                  {wf.stepCount} steps{wf.schedule ? ` · ${wf.schedule}` : ' · manual trigger'}
                  {wf.created_at ? ` · ${new Date(wf.created_at).toLocaleDateString()}` : ''}
                </p>

                {/* Card Action Controls: [Run] [Edit] [Delete] */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginTop: '16px',
                    flexWrap: 'wrap',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="tf-btn-secondary"
                    style={{
                      margin: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: wf.lastStatus === 'awaiting_approval' ? '#ca8a04' : '#0284c7',
                      color: '#ffffff',
                      border: 'none',
                      fontWeight: 600,
                      fontSize: '0.8rem',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (wf.lastStatus === 'awaiting_approval' && wf.latestRunId && onOpenRunStatus) {
                        onOpenRunStatus(wf.latestRunId);
                      } else if (onRunWorkflow) {
                        onRunWorkflow(wf.id, e);
                      } else if (onSelectWorkflow) {
                        onSelectWorkflow(wf.id);
                      }
                    }}
                  >
                    <Play size={13} fill="currentColor" />
                    {wf.lastStatus === 'awaiting_approval' ? 'Review & Approve' : 'Run'}
                  </button>

                  <button
                    className="tf-btn-secondary"
                    style={{
                      margin: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: '#1e293b',
                      borderColor: '#38bdf8',
                      color: '#38bdf8',
                      fontWeight: 600,
                      fontSize: '0.8rem',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingWorkflowId(wf.id);
                    }}
                  >
                    <Edit3 size={13} />
                    Edit
                  </button>

                  <button
                    className="tf-btn-secondary"
                    style={{
                      margin: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      background: '#1e293b',
                      borderColor: 'rgba(239, 68, 68, 0.4)',
                      color: '#f87171',
                      fontWeight: 600,
                      fontSize: '0.8rem',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingWorkflow(wf);
                    }}
                  >
                    <Trash2 size={13} />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', background: '#1e293b', borderRadius: '12px', border: '1px solid #334155', marginTop: '1.5rem' }}>
          <h2 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>No workflows yet</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginBottom: '1.5rem' }}>Record your automation sequence from any website using the TaskForge Chrome extension.</p>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <button className="tf-btn-primary" onClick={onRecordNew}>
              Record a workflow
            </button>
          </div>
        </div>
      )}

      {/* Edit Workflow Modal */}
      <WorkflowEditModal
        workflowId={editingWorkflowId}
        isOpen={Boolean(editingWorkflowId)}
        onClose={() => setEditingWorkflowId(null)}
        onSaved={() => {
          setEditingWorkflowId(null);
          if (onRefresh) onRefresh();
        }}
      />

      {/* Delete Confirmation Modal */}
      {deletingWorkflow && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
          onClick={() => {
            if (!isDeleting) setDeletingWorkflow(null);
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '12px',
              width: '100%',
              maxWidth: '440px',
              padding: '1.5rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              color: '#f8fafc',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
              <div style={{ background: 'rgba(239, 68, 68, 0.15)', padding: '10px', borderRadius: '50%', color: '#f87171' }}>
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#f8fafc' }}>
                  Delete Workflow
                </h3>
                <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: '#94a3b8' }}>
                  This action cannot be undone.
                </p>
              </div>
            </div>

            <p style={{ fontSize: '0.9rem', color: '#cbd5e1', lineHeight: 1.5, margin: '0 0 1.25rem' }}>
              Are you sure you want to delete <strong style={{ color: '#ffffff' }}>&quot;{deletingWorkflow.name}&quot;</strong>?
            </p>

            {deleteError && (
              <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', padding: '8px 12px', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '1rem' }}>
                {deleteError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setDeletingWorkflow(null)}
                disabled={isDeleting}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  background: '#1e293b',
                  border: '1px solid #334155',
                  color: '#cbd5e1',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '0.5rem 1.15rem',
                  borderRadius: '6px',
                  background: '#dc2626',
                  border: 'none',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  opacity: isDeleting ? 0.7 : 1,
                }}
              >
                <Trash2 size={14} />
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
