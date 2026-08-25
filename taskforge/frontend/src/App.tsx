import { useEffect, useState, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import WorkflowDashboard, { Workflow } from './components/WorkflowDashboard';
import { WorkflowDetail } from './pages/WorkflowDetail';
import { RunStatusPage } from './pages/RunStatusPage';
import { AuditLog } from './pages/AuditLog';
import { fetchWorkflows, createWorkflowFromTemplate, triggerWorkflowRun, WorkflowItem } from './api';

export default function App() {
  const [activeTab, setActiveTab] = useState<'workflows' | 'audit' | 'detail' | 'run'>('workflows');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [rawWorkflows, setRawWorkflows] = useState<WorkflowItem[]>([]);
  const [loadingWorkflows, setLoadingWorkflows] = useState(true);

  const loadWorkflows = useCallback(async () => {
    try {
      const data = await fetchWorkflows();
      setRawWorkflows(data);
    } catch (err) {
      console.error('Failed to load workflows:', err);
    } finally {
      setLoadingWorkflows(false);
    }
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  useEffect(() => {
    const handleFocus = () => {
      if (activeTab === 'workflows') {
        loadWorkflows();
      }
    };
    window.addEventListener('focus', handleFocus);

    const interval = setInterval(() => {
      if (activeTab === 'workflows') {
        loadWorkflows();
      }
    }, 3000);

    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
    };
  }, [activeTab, loadWorkflows]);

  const handleSelectWorkflow = (workflowId: string) => {
    setSelectedWorkflowId(workflowId);
    setActiveTab('detail');
  };

  const handleOpenRunStatus = (runId: string) => {
    setSelectedRunId(runId);
    setActiveTab('run');
  };

  const handleRecordNew = () => {
    if (typeof window !== 'undefined' && (window as any).chrome?.runtime?.sendMessage) {
      try {
        (window as any).chrome.runtime.sendMessage({ type: 'START_RECORDING' }, () => {
          alert('Recording started in TaskForge Chrome Extension! Navigate to any website to record actions.');
        });
        return;
      } catch (e) {
        console.warn('Chrome runtime message error:', e);
      }
    }
    alert(
      'To record a new workflow:\n\n1. Open any web page in Chrome.\n2. Click the TaskForge Chrome Extension icon in your toolbar.\n3. Click "Start Recording", perform your sequence, and click "Stop Recording".'
    );
  };

  const handleUseTemplate = async (templateId: string) => {
    try {
      const res = await createWorkflowFromTemplate(templateId);
      await loadWorkflows();
      setSelectedWorkflowId(res.workflowId);
      setActiveTab('detail');
    } catch (err) {
      console.error('Failed to create workflow from template:', err);
      alert('Failed to create workflow from template. Please ensure backend is running.');
    }
  };

  const handleRunWorkflow = async (workflowId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await triggerWorkflowRun(workflowId);
      handleOpenRunStatus(res.runId);
    } catch (err) {
      console.error('Failed to trigger workflow run:', err);
      alert('Failed to trigger workflow run');
    }
  };

  const workflows: Workflow[] = rawWorkflows.map((wf) => {
    let lastStatus: Workflow['lastStatus'] = wf.lastStatus || 'never_run';
    return {
      id: wf.id,
      name: wf.name,
      stepCount: wf.steps?.length || 0,
      schedule: wf.schedule ? `${wf.schedule.frequency}${wf.schedule.time ? ` (${wf.schedule.time})` : ''}` : undefined,
      lastStatus,
      latestRunId: wf.latestRunId,
    };
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab === 'workflows') {
            setSelectedWorkflowId(null);
            loadWorkflows();
          }
        }}
      />

      <main style={{ flex: 1, maxWidth: '1280px', width: '100%', margin: '0 auto' }}>
        {activeTab === 'workflows' && (
          loadingWorkflows ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: '#8B93A1' }}>Loading workflows...</div>
          ) : (
            <WorkflowDashboard
              workflows={workflows}
              onRecordNew={handleRecordNew}
              onUseTemplate={handleUseTemplate}
              onSelectWorkflow={handleSelectWorkflow}
              onRunWorkflow={handleRunWorkflow}
              onOpenRunStatus={(runId) => {
                setSelectedRunId(runId);
                setActiveTab('run');
              }}
            />
          )
        )}

        {activeTab === 'detail' && selectedWorkflowId && (
          <WorkflowDetail
            workflowId={selectedWorkflowId}
            onBack={() => {
              setActiveTab('workflows');
              loadWorkflows();
            }}
            onOpenRunStatus={handleOpenRunStatus}
          />
        )}

        {activeTab === 'run' && selectedRunId && (
          <RunStatusPage
            runId={selectedRunId}
            onBack={() => {
              setActiveTab('workflows');
              loadWorkflows();
            }}
          />
        )}

        {activeTab === 'audit' && (
          <AuditLog
            onSelectRun={handleOpenRunStatus}
          />
        )}
      </main>
    </div>
  );
}
