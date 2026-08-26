import React, { useEffect, useState, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Navbar } from './components/Navbar';
import WorkflowDashboard, { Workflow } from './components/WorkflowDashboard';
import { WorkflowDetail } from './pages/WorkflowDetail';
import { RunStatusPage } from './pages/RunStatusPage';
import { AuditLog } from './pages/AuditLog';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { AdminDashboard } from './pages/AdminDashboard';
import { UserManagement } from './pages/UserManagement';
import { fetchWorkflows, createWorkflowFromTemplate, triggerWorkflowRun, WorkflowItem } from './api';
import { ShieldAlert, ArrowLeft } from 'lucide-react';

const ProtectedRoute: React.FC<{ children: React.ReactNode; requireAdmin?: boolean }> = ({ children, requireAdmin }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Checking permissions...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requireAdmin && user.role !== 'admin') {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', maxWidth: '500px', margin: '3rem auto', background: '#1e293b', border: '1px solid #ef4444', borderRadius: '12px' }}>
        <div style={{ display: 'inline-flex', padding: '12px', background: 'rgba(239, 68, 68, 0.2)', color: '#f87171', borderRadius: '50%', marginBottom: '1rem' }}>
          <ShieldAlert size={36} />
        </div>
        <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '1.4rem' }}>403 Forbidden</h2>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '8px' }}>
          You do not have administrative permissions to view this page.
        </p>
        <Link to="/dashboard" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: '#0284c7', color: '#fff', padding: '8px 16px', borderRadius: '6px', textDecoration: 'none', fontWeight: 600, marginTop: '1rem' }}>
          <ArrowLeft size={16} /> Return to My Dashboard
        </Link>
      </div>
    );
  }

  return <>{children}</>;
};

// Main Workflows View Wrapper
const WorkflowsView: React.FC = () => {
  const navigate = useNavigate();
  const [rawWorkflows, setRawWorkflows] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadWorkflows = useCallback(async () => {
    try {
      const data = await fetchWorkflows();
      setRawWorkflows(data);
    } catch (err) {
      console.error('Failed to load workflows:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const handleRecordNew = () => {
    if (typeof window !== 'undefined' && (window as any).chrome?.runtime?.sendMessage) {
      try {
        (window as any).chrome.runtime.sendMessage({ type: 'START_RECORDING' }, () => {
          alert('Recording started in TaskForge Chrome Extension! Navigate to any website to record actions.');
        });
        return;
      } catch (e) {}
    }
    alert('To record a new workflow:\n\n1. Open any web page in Chrome.\n2. Click the TaskForge Chrome Extension icon.\n3. Click "Start Recording", perform your sequence, and click "Stop Recording".');
  };

  const handleUseTemplate = async (templateId: string) => {
    try {
      const res = await createWorkflowFromTemplate(templateId);
      await loadWorkflows();
      navigate(`/workflows/${res.workflowId}`);
    } catch (err) {
      console.error('Failed to create workflow from template:', err);
      alert('Failed to create workflow from template.');
    }
  };

  const handleRunWorkflow = async (workflowId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await triggerWorkflowRun(workflowId);
      navigate(`/runs/${res.runId}`);
    } catch (err) {
      console.error('Failed to trigger workflow run:', err);
      alert('Failed to trigger workflow run');
    }
  };

  const workflows: Workflow[] = rawWorkflows.map((wf) => ({
    id: wf.id,
    name: wf.name,
    stepCount: wf.steps?.length || 0,
    schedule: wf.schedule ? `${wf.schedule.frequency}${wf.schedule.time ? ` (${wf.schedule.time})` : ''}` : undefined,
    lastStatus: wf.lastStatus || 'never_run',
    latestRunId: wf.latestRunId,
  }));

  if (loading) {
    return <div style={{ padding: '3rem', textAlign: 'center', color: '#8B93A1' }}>Loading workflows...</div>;
  }

  return (
    <WorkflowDashboard
      workflows={workflows}
      onRecordNew={handleRecordNew}
      onUseTemplate={handleUseTemplate}
      onSelectWorkflow={(id) => navigate(`/workflows/${id}`)}
      onRunWorkflow={handleRunWorkflow}
      onOpenRunStatus={(runId) => navigate(`/runs/${runId}`)}
    />
  );
};

const WorkflowDetailView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  return <WorkflowDetail workflowId={id!} onBack={() => navigate('/dashboard')} onOpenRunStatus={(runId) => navigate(`/runs/${runId}`)} />;
};

const RunStatusView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  return <RunStatusPage runId={id!} onBack={() => navigate('/dashboard')} />;
};

const RootRedirect: React.FC = () => {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  return <Navigate to="/dashboard" replace />;
};

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
          <Navbar />
          <main style={{ flex: 1, maxWidth: '1280px', width: '100%', margin: '0 auto', paddingBottom: '2rem' }}>
            <Routes>
              <Route path="/" element={<RootRedirect />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />

              <Route path="/dashboard" element={<ProtectedRoute><WorkflowsView /></ProtectedRoute>} />
              <Route path="/workflows" element={<ProtectedRoute><WorkflowsView /></ProtectedRoute>} />
              <Route path="/workflows/:id" element={<ProtectedRoute><WorkflowDetailView /></ProtectedRoute>} />
              <Route path="/runs/:id" element={<ProtectedRoute><RunStatusView /></ProtectedRoute>} />
              <Route path="/audit" element={<ProtectedRoute><AuditLog onSelectRun={(id) => window.location.href = `/runs/${id}`} /></ProtectedRoute>} />

              <Route path="/admin" element={<ProtectedRoute requireAdmin><AdminDashboard /></ProtectedRoute>} />
              <Route path="/admin/users" element={<ProtectedRoute requireAdmin><UserManagement /></ProtectedRoute>} />
              <Route path="/admin/workflows" element={<ProtectedRoute requireAdmin><WorkflowsView /></ProtectedRoute>} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}
