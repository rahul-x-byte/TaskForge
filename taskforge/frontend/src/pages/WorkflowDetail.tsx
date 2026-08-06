import React, { useEffect, useState, useCallback } from 'react';
import { fetchWorkflowById, saveWorkflowSchedule, triggerWorkflowRun, updateWorkflowSteps, WorkflowItem } from '../api';
import { ReactFlow, Controls, Background, Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Play, Calendar, ArrowLeft, ShieldAlert } from 'lucide-react';

interface WorkflowDetailProps {
  workflowId: string;
  onBack: () => void;
  onOpenRunStatus: (runId: string) => void;
}

export const WorkflowDetail: React.FC<WorkflowDetailProps> = ({ workflowId, onBack, onOpenRunStatus }) => {
  const [workflow, setWorkflow] = useState<WorkflowItem | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [frequency, setFrequency] = useState('daily');
  const [scheduleTime, setScheduleTime] = useState('09:00');

  const handleToggleSensitive = useCallback(async (stepIdx: number, currentSteps: any[]) => {
    const newSteps = [...currentSteps];
    const isCurrentSensitive = newSteps[stepIdx].isSensitive === true;
    newSteps[stepIdx] = {
      ...newSteps[stepIdx],
      isSensitive: !isCurrentSensitive,
    };

    try {
      await updateWorkflowSteps(workflowId, newSteps);
      const updated = await fetchWorkflowById(workflowId);
      setWorkflow(updated);
    } catch (err) {
      alert('Failed to update step sensitivity');
    }
  }, [workflowId]);

  const renderGraph = useCallback((steps: any[]) => {
    const flowNodes: Node[] = steps.map((step: any, idx: number) => {
      const isSensitive = step.isSensitive === true || step.action === 'submit';
      return {
        id: `node-${idx}`,
        position: { x: 180, y: idx * 140 + 40 },
        data: {
          label: (
            <div style={{ padding: '10px 12px', minWidth: '250px', background: isSensitive ? '#450a0a' : '#1e293b', border: isSensitive ? '1px solid #f43f5e' : '1px solid #475569', borderRadius: '8px', color: '#f8fafc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 700, color: isSensitive ? '#fb7185' : '#38bdf8' }}>
                  Step {idx + 1}: {step.action}
                </span>
                {isSensitive && <ShieldAlert size={14} color="#f43f5e" />}
              </div>
              <div style={{ fontSize: '0.8rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '8px' }}>
                {step.selectors?.text || step.selectors?.name || step.selectors?.css || step.value || step.pageUrl}
              </div>
              <label
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem', color: '#cbd5e1', cursor: 'pointer', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '6px' }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={step.isSensitive === true}
                  onChange={() => handleToggleSensitive(idx, steps)}
                  style={{ cursor: 'pointer' }}
                />
                Require approval before this step
              </label>
            </div>
          ),
        },
      };
    });

    const flowEdges: Edge[] = [];
    for (let i = 0; i < steps.length - 1; i++) {
      flowEdges.push({
        id: `edge-${i}-${i + 1}`,
        source: `node-${i}`,
        target: `node-${i + 1}`,
        animated: true,
        style: { stroke: '#38bdf8' },
      });
    }

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [handleToggleSensitive]);

  useEffect(() => {
    fetchWorkflowById(workflowId)
      .then((data) => {
        setWorkflow(data);
        if (data.schedule) {
          setFrequency(data.schedule.frequency || 'daily');
          setScheduleTime(data.schedule.time || '09:00');
        }
        renderGraph(data.steps || []);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [workflowId, renderGraph]);

  const handleRun = async () => {
    try {
      const res = await triggerWorkflowRun(workflowId);
      onOpenRunStatus(res.runId);
    } catch (err) {
      alert('Failed to trigger run');
    }
  };

  const handleSaveSchedule = async () => {
    try {
      await saveWorkflowSchedule(workflowId, frequency, scheduleTime);
      setShowScheduleModal(false);
      const updated = await fetchWorkflowById(workflowId);
      setWorkflow(updated);
    } catch (err) {
      alert('Failed to save schedule');
    }
  };

  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading graph...</div>;
  if (!workflow) return <div style={{ padding: '3rem', textAlign: 'center', color: '#f87171' }}>Workflow not found</div>;

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
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f8fafc' }}>{workflow.name}</h2>
          <p style={{ fontSize: '0.875rem', color: '#94a3b8' }}>Visual Step Node Graph ({workflow.steps?.length || 0} Steps)</p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={() => setShowScheduleModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem', borderRadius: '6px', border: '1px solid #475569', background: '#1e293b', color: '#f8fafc', fontWeight: 600, cursor: 'pointer' }}
          >
            <Calendar size={16} /> {workflow.schedule ? `Scheduled: ${workflow.schedule.frequency}` : 'Schedule'}
          </button>

          <button
            onClick={handleRun}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem', borderRadius: '6px', border: 'none', background: '#0284c7', color: '#ffffff', fontWeight: 600, cursor: 'pointer' }}
          >
            <Play size={16} fill="#ffffff" /> Run Workflow
          </button>
        </div>
      </div>

      {/* React Flow Graph */}
      <div className="glass-panel" style={{ height: '520px', width: '100%', borderRadius: '12px', overflow: 'hidden' }}>
        <ReactFlow nodes={nodes} edges={edges} fitView>
          <Background color="#334155" gap={16} />
          <Controls />
        </ReactFlow>
      </div>

      {/* Schedule Modal */}
      {showScheduleModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1rem', color: '#f8fafc' }}>Schedule Workflow Run</h3>
            
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.5rem' }}>Frequency</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                style={{ width: '100%', padding: '0.6rem', background: '#1e293b', border: '1px solid #475569', borderRadius: '6px', color: '#f8fafc' }}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.5rem' }}>Trigger Time (24h)</label>
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                style={{ width: '100%', padding: '0.6rem', background: '#1e293b', border: '1px solid #475569', borderRadius: '6px', color: '#f8fafc' }}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowScheduleModal(false)}
                style={{ padding: '0.6rem 1.2rem', background: '#334155', border: 'none', borderRadius: '6px', color: '#94a3b8', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSchedule}
                style={{ padding: '0.6rem 1.2rem', background: '#0284c7', border: 'none', borderRadius: '6px', color: '#ffffff', fontWeight: 600, cursor: 'pointer' }}
              >
                Save Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
