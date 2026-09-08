import React, { useState, useEffect } from 'react';
import { fetchWorkflowById, updateWorkflow } from '../api';
import { X, ArrowUp, ArrowDown, Trash2, Plus, ShieldAlert, Save } from 'lucide-react';

interface WorkflowEditModalProps {
  workflowId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export const WorkflowEditModal: React.FC<WorkflowEditModalProps> = ({
  workflowId,
  isOpen,
  onClose,
  onSaved,
}) => {
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !workflowId) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    fetchWorkflowById(workflowId)
      .then((data) => {
        if (!isMounted) return;
        setName(data.name || '');
        setSteps(Array.isArray(data.steps) ? data.steps : []);
      })
      .catch((err) => {
        if (!isMounted) return;
        setError(err.message || 'Failed to load workflow details.');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, workflowId]);

  if (!isOpen || !workflowId) return null;

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newSteps = [...steps];
    const temp = newSteps[index - 1];
    newSteps[index - 1] = newSteps[index];
    newSteps[index] = temp;
    setSteps(newSteps);
  };

  const handleMoveDown = (index: number) => {
    if (index === steps.length - 1) return;
    const newSteps = [...steps];
    const temp = newSteps[index + 1];
    newSteps[index + 1] = newSteps[index];
    newSteps[index] = temp;
    setSteps(newSteps);
  };

  const handleRemoveStep = (index: number) => {
    const newSteps = steps.filter((_, i) => i !== index);
    setSteps(newSteps);
  };

  const handleAddStep = () => {
    const newStep = {
      action: 'click',
      selectors: { css: '' },
      value: '',
      pageUrl: '',
      isSensitive: false,
    };
    setSteps([...steps, newStep]);
  };

  const handleStepChange = (index: number, field: string, value: any) => {
    const newSteps = [...steps];
    const current = { ...newSteps[index] };

    if (field === 'action') {
      current.action = value;
    } else if (field === 'css') {
      current.selectors = { ...current.selectors, css: value };
    } else if (field === 'text') {
      current.selectors = { ...current.selectors, text: value };
    } else if (field === 'value') {
      current.value = value;
    } else if (field === 'pageUrl') {
      current.pageUrl = value;
    } else if (field === 'isSensitive') {
      current.isSensitive = Boolean(value);
    }

    newSteps[index] = current;
    setSteps(newSteps);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Workflow name is required.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await updateWorkflow(workflowId, {
        name: name.trim(),
        steps,
      });
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save workflow changes.');
    } finally {
      setSaving(false);
    }
  };

  return (
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
      onClick={onClose}
    >
      <div
        style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '680px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          color: '#f8fafc',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid #334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc' }}>
              Edit Workflow
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
              Modify name, action sequence, and approval requirements
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '6px',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '1.5rem', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
              Loading workflow details...
            </div>
          ) : (
            <form onSubmit={handleSave}>
              {error && (
                <div
                  style={{
                    background: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#f87171',
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    marginBottom: '1.25rem',
                  }}
                >
                  {error}
                </div>
              )}

              {/* Workflow Name */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
                  Workflow Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Daily Data Export"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '8px',
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#f8fafc',
                    fontSize: '0.95rem',
                    fontWeight: 500,
                  }}
                  required
                />
              </div>

              {/* Steps Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#cbd5e1' }}>
                  Workflow Steps ({steps.length})
                </label>
                <button
                  type="button"
                  onClick={handleAddStep}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: '#1e293b',
                    border: '1px solid #38bdf8',
                    color: '#38bdf8',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={14} /> Add Step
                </button>
              </div>

              {/* Steps List */}
              {steps.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '2rem',
                    background: '#1e293b',
                    borderRadius: '8px',
                    border: '1px dashed #334155',
                    color: '#94a3b8',
                    fontSize: '0.85rem',
                  }}
                >
                  No steps in this workflow. Click &quot;Add Step&quot; above to create one.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {steps.map((step, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        padding: '10px 12px',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              background: '#0284c7',
                              color: '#ffffff',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '4px',
                              textTransform: 'uppercase',
                            }}
                          >
                            Step {idx + 1}
                          </span>
                          <select
                            value={step.action || 'click'}
                            onChange={(e) => handleStepChange(idx, 'action', e.target.value)}
                            style={{
                              background: '#0f172a',
                              border: '1px solid #334155',
                              color: '#38bdf8',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                            }}
                          >
                            <option value="navigate">Navigate</option>
                            <option value="click">Click</option>
                            <option value="input">Input (Type)</option>
                            <option value="submit">Submit</option>
                            <option value="wait">Wait</option>
                            <option value="scroll">Scroll</option>
                          </select>
                        </div>

                        {/* Reorder and Delete controls */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            type="button"
                            onClick={() => handleMoveUp(idx)}
                            disabled={idx === 0}
                            title="Move Up"
                            style={{
                              background: '#0f172a',
                              border: '1px solid #334155',
                              color: idx === 0 ? '#475569' : '#cbd5e1',
                              padding: '3px 6px',
                              borderRadius: '4px',
                              cursor: idx === 0 ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveDown(idx)}
                            disabled={idx === steps.length - 1}
                            title="Move Down"
                            style={{
                              background: '#0f172a',
                              border: '1px solid #334155',
                              color: idx === steps.length - 1 ? '#475569' : '#cbd5e1',
                              padding: '3px 6px',
                              borderRadius: '4px',
                              cursor: idx === steps.length - 1 ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveStep(idx)}
                            title="Delete Step"
                            style={{
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: '1px solid rgba(239, 68, 68, 0.3)',
                              color: '#f87171',
                              padding: '3px 6px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              marginLeft: '4px',
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Step Details input */}
                      <div style={{ display: 'grid', gridTemplateColumns: step.action === 'input' ? '1fr 1fr' : '1fr', gap: '8px' }}>
                        {step.action === 'navigate' ? (
                          <div>
                            <input
                              type="text"
                              value={step.pageUrl || step.value || ''}
                              onChange={(e) => {
                                handleStepChange(idx, 'pageUrl', e.target.value);
                                handleStepChange(idx, 'value', e.target.value);
                              }}
                              placeholder="URL to navigate (e.g. https://example.com)"
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                background: '#0f172a',
                                border: '1px solid #334155',
                                color: '#f8fafc',
                                padding: '5px 8px',
                                borderRadius: '4px',
                                fontSize: '0.8rem',
                                fontFamily: 'monospace',
                              }}
                            />
                          </div>
                        ) : step.action === 'input' ? (
                          <>
                            <div>
                              <input
                                type="text"
                                value={step.selectors?.css || step.selectors?.name || ''}
                                onChange={(e) => handleStepChange(idx, 'css', e.target.value)}
                                placeholder="CSS Selector (e.g. input[name='q'])"
                                style={{
                                  width: '100%',
                                  boxSizing: 'border-box',
                                  background: '#0f172a',
                                  border: '1px solid #334155',
                                  color: '#f8fafc',
                                  padding: '5px 8px',
                                  borderRadius: '4px',
                                  fontSize: '0.8rem',
                                  fontFamily: 'monospace',
                                }}
                              />
                            </div>
                            <div>
                              <input
                                type="text"
                                value={step.value || ''}
                                onChange={(e) => handleStepChange(idx, 'value', e.target.value)}
                                placeholder="Text to type"
                                style={{
                                  width: '100%',
                                  boxSizing: 'border-box',
                                  background: '#0f172a',
                                  border: '1px solid #334155',
                                  color: '#f8fafc',
                                  padding: '5px 8px',
                                  borderRadius: '4px',
                                  fontSize: '0.8rem',
                                }}
                              />
                            </div>
                          </>
                        ) : (
                          <div>
                            <input
                              type="text"
                              value={step.selectors?.css || step.selectors?.text || step.value || ''}
                              onChange={(e) => handleStepChange(idx, 'css', e.target.value)}
                              placeholder="CSS Selector or Target (e.g. button.submit-btn)"
                              style={{
                                width: '100%',
                                boxSizing: 'border-box',
                                background: '#0f172a',
                                border: '1px solid #334155',
                                color: '#f8fafc',
                                padding: '5px 8px',
                                borderRadius: '4px',
                                fontSize: '0.8rem',
                                fontFamily: 'monospace',
                              }}
                            />
                          </div>
                        )}
                      </div>

                      {/* Sensitivity toggle */}
                      <label
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '0.74rem',
                          color: step.isSensitive ? '#fb7185' : '#94a3b8',
                          marginTop: '6px',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(step.isSensitive)}
                          onChange={(e) => handleStepChange(idx, 'isSensitive', e.target.checked)}
                          style={{ cursor: 'pointer' }}
                        />
                        <ShieldAlert size={12} /> Require approval before executing this step
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </form>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid #334155',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
            background: 'rgba(15, 23, 42, 0.8)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '0.55rem 1.1rem',
              borderRadius: '8px',
              background: '#1e293b',
              border: '1px solid #334155',
              color: '#cbd5e1',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0.55rem 1.25rem',
              borderRadius: '8px',
              background: '#0284c7',
              border: 'none',
              color: '#ffffff',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: saving || loading ? 'not-allowed' : 'pointer',
              opacity: saving || loading ? 0.7 : 1,
            }}
          >
            <Save size={15} /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

