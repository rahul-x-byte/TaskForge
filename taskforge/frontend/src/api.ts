export const DEFAULT_PROD_BACKEND_URL = 'https://taskforge-backend-ta4i.onrender.com/api';
export const DEFAULT_LOCAL_BACKEND_URL = 'http://localhost:3001/api';

export const getApiBase = () => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('taskforge_api_base');
    if (saved && saved.trim() && !saved.includes('<YOUR-ACTIVE-BACKEND-URL>')) {
      let cleaned = saved.trim().replace(/\/+$/, '');
      // Auto-correct old typo ta41 to ta4i
      cleaned = cleaned.replace(/ta41\.onrender\.com/g, 'ta4i.onrender.com');
      if (!cleaned.endsWith('/api')) cleaned = `${cleaned}/api`;
      return cleaned;
    }
  }
  if (import.meta.env.VITE_API_BASE) {
    let envBase = import.meta.env.VITE_API_BASE.trim().replace(/\/+$/, '');
    if (!envBase.includes('<YOUR-ACTIVE-BACKEND-URL>')) {
      envBase = envBase.replace(/ta41\.onrender\.com/g, 'ta4i.onrender.com');
      if (!envBase.endsWith('/api')) envBase = `${envBase}/api`;
      return envBase;
    }
  }
  
  // If running on HTTPS (e.g. Vercel deployment), default to active Render production backend
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return DEFAULT_PROD_BACKEND_URL;
  }

  return DEFAULT_LOCAL_BACKEND_URL;
};

export const API_BASE = getApiBase();

export const setApiBase = (url: string) => {
  if (typeof window !== 'undefined') {
    let cleaned = url.trim().replace(/\/+$/, '');
    if (cleaned.includes('<YOUR-ACTIVE-BACKEND-URL>')) return;
    cleaned = cleaned.replace(/ta41\.onrender\.com/g, 'ta4i.onrender.com');
    if (!cleaned.endsWith('/api')) cleaned = `${cleaned}/api`;
    localStorage.setItem('taskforge_api_base', cleaned);
    window.location.reload();
  }
};

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const currentBase = getApiBase();
    const healthUrl = currentBase.replace(/\/api\/?$/, '') + '/health';
    const res = await fetch(healthUrl, { method: 'GET' });
    return res.ok;
  } catch (err) {
    return false;
  }
}

export const getWsBase = () => {
  if (import.meta.env.VITE_WS_BASE) return import.meta.env.VITE_WS_BASE;
  const httpBase = API_BASE.replace(/\/api\/?$/, '');
  return httpBase.replace(/^http/, 'ws'); // http->ws, https->wss automatically
};

export interface WorkflowItem {
  id: string;
  name: string;
  created_at: string;
  current_version_id?: string;
  steps?: any[];
  lastStatus?: 'success' | 'failed' | 'awaiting_approval' | 'never_run';
  latestRunId?: string;
  schedule?: {
    frequency: string;
    time?: string;
    cron?: string;
    enabled: boolean;
  };
}

export interface RunItem {
  id: string;
  workflow_id: string;
  version_id: string;
  workflow_name?: string;
  status: 'pending' | 'running' | 'awaiting_approval' | 'awaiting_credentials' | 'awaiting_login' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
  started_at: string;
  finished_at?: string;
  current_step_index?: number;
  detail?: any;
}

export async function fetchWorkflows(): Promise<WorkflowItem[]> {
  const res = await fetch(`${API_BASE}/workflows`);
  if (!res.ok) throw new Error('Failed to fetch workflows');
  return await res.json();
}

export async function fetchWorkflowById(id: string): Promise<WorkflowItem> {
  const res = await fetch(`${API_BASE}/workflows/${id}`);
  if (!res.ok) throw new Error('Failed to fetch workflow');
  return await res.json();
}

export async function updateWorkflowSteps(workflowId: string, steps: any[]): Promise<void> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/steps`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ steps }),
  });
  if (!res.ok) throw new Error('Failed to update workflow steps');
}

export async function triggerWorkflowRun(workflowId: string): Promise<{ runId: string; status: string }> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Failed to trigger workflow run');
  return await res.json();
}

export async function createWorkflowFromTemplate(templateId: string): Promise<{ workflowId: string; versionId: string; name: string; stepCount: number }> {
  const res = await fetch(`${API_BASE}/workflows/from-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId }),
  });
  if (!res.ok) throw new Error('Failed to create workflow from template');
  return await res.json();
}

export async function fetchRunById(runId: string): Promise<{ run: RunItem; steps: any[] }> {
  const res = await fetch(`${API_BASE}/runs/${runId}`);
  if (!res.ok) throw new Error('Failed to fetch run status');
  return await res.json();
}

export async function fetchAuditLogs(): Promise<RunItem[]> {
  const res = await fetch(`${API_BASE}/runs`);
  if (!res.ok) throw new Error('Failed to fetch audit log');
  return await res.json();
}

export async function approveRunGate(runId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/runs/${runId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Failed to approve run gate');
}

export async function cancelRunGate(runId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/runs/${runId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Failed to cancel run gate');
}

export async function submitRunCredentials(runId: string, stepIndex: number, value: string): Promise<void> {
  const res = await fetch(`${API_BASE}/runs/${runId}/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stepIndex, value }),
  });
  if (!res.ok) throw new Error('Failed to submit credentials');
}

export async function saveWorkflowSchedule(workflowId: string, frequency: string, time: string): Promise<void> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frequency, time }),
  });
  if (!res.ok) throw new Error('Failed to save schedule');
}
