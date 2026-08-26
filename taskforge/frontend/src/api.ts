export const DEFAULT_PROD_BACKEND_URL = 'https://taskforge-backend-ta4i.onrender.com/api';
export const DEFAULT_LOCAL_BACKEND_URL = 'http://localhost:3001/api';

export const getApiBase = () => {
  if (typeof window !== 'undefined') {
    const isHttps = window.location.protocol === 'https:';
    const saved = localStorage.getItem('taskforge_api_base');
    if (saved) {
      if (saved.includes('ta41') || saved.includes('<YOUR-ACTIVE-BACKEND-URL>')) {
        localStorage.removeItem('taskforge_api_base');
      } else {
        let cleaned = saved.trim().replace(/\/+$/, '');
        if (isHttps) {
          if (cleaned.startsWith('http://') && !cleaned.includes('localhost')) {
            cleaned = cleaned.replace(/^http:\/\//i, 'https://');
          }
          if (cleaned.includes('localhost') || cleaned.includes('127.0.0.1')) {
            cleaned = DEFAULT_PROD_BACKEND_URL;
          }
        }
        if (!cleaned.endsWith('/api')) cleaned = `${cleaned}/api`;
        return cleaned;
      }
    }

    if (isHttps) {
      return DEFAULT_PROD_BACKEND_URL;
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

export const getAuthToken = (): string | null => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('taskforge_auth_token');
  }
  return null;
};

export const setAuthToken = (token: string | null) => {
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem('taskforge_auth_token', token);
    } else {
      localStorage.removeItem('taskforge_auth_token');
    }
  }
};

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(url, {
    ...options,
    headers,
  });
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const currentBase = getApiBase();
    const healthUrl = currentBase.replace(/\/api\/?$/, '') + '/health';
    const res = await authFetch(healthUrl, { method: 'GET' }).catch(() => null);
    if (res && res.ok) return true;

    // Fallback check to /api/workflows
    const wfRes = await authFetch(`${currentBase}/workflows`, { method: 'GET' }).catch(() => null);
    return !!(wfRes && wfRes.ok);
  } catch (err) {
    return false;
  }
}

export const getWsBase = () => {
  if (import.meta.env.VITE_WS_BASE) return import.meta.env.VITE_WS_BASE;
  const httpBase = API_BASE.replace(/\/api\/?$/, '');
  return httpBase.replace(/^http/, 'ws');
};

export interface WorkflowItem {
  id: string;
  user_id?: string;
  user_name?: string;
  user_email?: string;
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
  user_id?: string;
  user_name?: string;
  user_email?: string;
  status: 'pending' | 'running' | 'awaiting_approval' | 'awaiting_credentials' | 'awaiting_login' | 'completed' | 'failed' | 'cancelled' | 'timed_out';
  started_at: string;
  finished_at?: string;
  current_step_index?: number;
  detail?: any;
}

export interface UserItem {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  created_at: string;
  updated_at?: string;
  workflow_count?: number;
  run_count?: number;
}

export interface AdminStats {
  totalUsers: number;
  totalAdmins: number;
  totalNormalUsers: number;
  totalWorkflows: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  currentlyRunning: number;
}

export async function fetchWorkflows(): Promise<WorkflowItem[]> {
  const res = await authFetch(`${API_BASE}/workflows`);
  if (!res.ok) throw new Error('Failed to fetch workflows');
  return await res.json();
}

export async function fetchWorkflowById(id: string): Promise<WorkflowItem> {
  const res = await authFetch(`${API_BASE}/workflows/${id}`);
  if (!res.ok) throw new Error('Failed to fetch workflow');
  return await res.json();
}

export async function updateWorkflowSteps(workflowId: string, steps: any[]): Promise<void> {
  const res = await authFetch(`${API_BASE}/workflows/${workflowId}/steps`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ steps }),
  });
  if (!res.ok) throw new Error('Failed to update workflow steps');
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/workflows/${workflowId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete workflow');
}

export async function triggerWorkflowRun(workflowId: string): Promise<{ runId: string; status: string }> {
  const res = await authFetch(`${API_BASE}/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Failed to trigger workflow run');
  return await res.json();
}

export async function createWorkflowFromTemplate(templateId: string): Promise<{ workflowId: string; versionId: string; name: string; stepCount: number }> {
  const res = await authFetch(`${API_BASE}/workflows/from-template`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId }),
  });
  if (!res.ok) throw new Error('Failed to create workflow from template');
  return await res.json();
}

export async function fetchRunById(runId: string): Promise<{ run: RunItem; steps: any[] }> {
  const res = await authFetch(`${API_BASE}/runs/${runId}`);
  if (!res.ok) throw new Error('Failed to fetch run status');
  return await res.json();
}

export async function fetchAuditLogs(): Promise<RunItem[]> {
  const res = await authFetch(`${API_BASE}/runs`);
  if (!res.ok) throw new Error('Failed to fetch audit log');
  return await res.json();
}

export async function approveRunGate(runId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/runs/${runId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Failed to approve run gate');
}

export async function cancelRunGate(runId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/runs/${runId}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Failed to cancel run gate');
}

export async function submitRunCredentials(runId: string, stepIndex: number, value: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/runs/${runId}/credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stepIndex, value }),
  });
  if (!res.ok) throw new Error('Failed to submit credentials');
}

export async function saveWorkflowSchedule(workflowId: string, frequency: string, time: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/workflows/${workflowId}/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frequency, time }),
  });
  if (!res.ok) throw new Error('Failed to save schedule');
}

// Admin API Functions
export async function fetchAdminUsers(): Promise<UserItem[]> {
  const res = await authFetch(`${API_BASE}/admin/users`);
  if (!res.ok) throw new Error('Failed to fetch users');
  return await res.json();
}

export async function createAdminUser(userData: { name: string; email: string; password: string; role: 'admin' | 'user' }): Promise<UserItem> {
  const res = await authFetch(`${API_BASE}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to create user');
  }
  const data = await res.json();
  return data.user;
}

export async function updateAdminUserRole(userId: string, role: 'admin' | 'user'): Promise<void> {
  const res = await authFetch(`${API_BASE}/admin/users/${userId}/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to update user role');
  }
}

export async function deleteAdminUser(userId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/admin/users/${userId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Failed to delete user');
  }
}

export async function fetchAdminWorkflows(): Promise<WorkflowItem[]> {
  const res = await authFetch(`${API_BASE}/admin/workflows`);
  if (!res.ok) throw new Error('Failed to fetch admin workflows');
  return await res.json();
}

export async function fetchAdminRuns(): Promise<RunItem[]> {
  const res = await authFetch(`${API_BASE}/admin/runs`);
  if (!res.ok) throw new Error('Failed to fetch admin runs');
  return await res.json();
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const res = await authFetch(`${API_BASE}/admin/stats`);
  if (!res.ok) throw new Error('Failed to fetch admin stats');
  return await res.json();
}
