import { useState } from 'react';
import { Navbar } from './components/Navbar';
import { WorkflowList } from './pages/WorkflowList';
import { WorkflowDetail } from './pages/WorkflowDetail';
import { RunStatusPage } from './pages/RunStatusPage';
import { AuditLog } from './pages/AuditLog';

export default function App() {
  const [activeTab, setActiveTab] = useState<'workflows' | 'audit' | 'detail' | 'run'>('workflows');
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const handleSelectWorkflow = (workflowId: string) => {
    setSelectedWorkflowId(workflowId);
    setActiveTab('detail');
  };

  const handleOpenRunStatus = (runId: string) => {
    setSelectedRunId(runId);
    setActiveTab('run');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        activeTab={activeTab}
        setActiveTab={(tab) => {
          setActiveTab(tab);
          if (tab === 'workflows') setSelectedWorkflowId(null);
        }}
      />

      <main style={{ flex: 1, maxWidth: '1280px', width: '100%', margin: '0 auto' }}>
        {activeTab === 'workflows' && (
          <WorkflowList
            onSelectWorkflow={handleSelectWorkflow}
            onOpenRunStatus={handleOpenRunStatus}
          />
        )}

        {activeTab === 'detail' && selectedWorkflowId && (
          <WorkflowDetail
            workflowId={selectedWorkflowId}
            onBack={() => setActiveTab('workflows')}
            onOpenRunStatus={handleOpenRunStatus}
          />
        )}

        {activeTab === 'run' && selectedRunId && (
          <RunStatusPage
            runId={selectedRunId}
            onBack={() => setActiveTab('workflows')}
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
