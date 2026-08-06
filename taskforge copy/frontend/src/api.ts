const API_BASE = 'http://localhost:3001/api';

export interface WorkflowItem {
  id: string;
  name: string;
  created_at: string;
  current_version_id?: string;
  steps?: any[];
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
  status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
  started_at: string;
  finished_at?: string;
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

export async function triggerWorkflowRun(workflowId: string): Promise<{ runId: string; status: string }> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Failed to trigger workflow run');
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

export async function saveWorkflowSchedule(workflowId: string, frequency: string, time: string): Promise<void> {
  const res = await fetch(`${API_BASE}/workflows/${workflowId}/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frequency, time }),
  });
  if (!res.ok) throw new Error('Failed to save schedule');
}
