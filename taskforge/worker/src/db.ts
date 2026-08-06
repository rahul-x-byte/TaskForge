const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

export async function getWorkflowWithVersion(workflowId: string): Promise<any> {
  const res = await fetch(`${BACKEND_URL}/api/workflows/${workflowId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch workflow ${workflowId}: HTTP ${res.status}`);
  }
  return await res.json();
}

export async function getRunStatus(runId: string): Promise<any> {
  const res = await fetch(`${BACKEND_URL}/api/runs/${runId}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch run ${runId}: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.run;
}

export async function updateRunStatus(runId: string, status: string, finishedAt?: string): Promise<void> {
  // Post status update to internal helper endpoint or update via approval/cancel
  console.log(`[Worker DB] Updating run ${runId} status to: ${status}`);
}
