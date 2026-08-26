import { executeWorkflowRun } from './executor.js';
import { resolveBackendUrl } from './config.js';

const BACKEND_URL = resolveBackendUrl();
const WORKER_SECRET = process.env.WORKER_SECRET || 'taskforge-worker-secret-key-2026';

console.log('[Worker] TaskForge Automation Worker Service starting...');
console.log(`[Worker] Using BACKEND_URL: ${BACKEND_URL}`);
console.log('[Worker] Listening for workflow execution jobs...');

// Polling Loop for execution jobs from backend
export async function pollForJobs() {
  console.log('[Worker] Listening for workflow execution jobs...');

  while (true) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/runs/pending`, {
        headers: { 'X-Worker-Secret': WORKER_SECRET },
      });
      if (res.ok) {
        const pendingRuns = await res.json();
        for (const run of pendingRuns) {
          const claimRes = await fetch(
            `${BACKEND_URL}/api/runs/${run.id}/claim`,
            {
              method: 'POST',
              headers: { 'X-Worker-Secret': WORKER_SECRET },
            }
          );
          if (claimRes.ok) {
            console.log(`[Worker] Claimed run ${run.id}, executing...`);
            await processJob(run.workflow_id, run.version_id, run.id);
          }
        }
      }
    } catch (e) {
      console.error('[Worker] Poll error:', e);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
}

// Single job worker function triggerable via CLI or queue
export async function processJob(workflowId: string, versionId: string, runId: string) {
  console.log(`[Worker] Processing Job -> Workflow: ${workflowId}, Version: ${versionId}, Run: ${runId}`);
  return await executeWorkflowRun(workflowId, versionId, runId);
}

// CLI direct run support
const args = process.argv.slice(2);
if (args.length >= 3) {
  const [wId, vId, rId] = args;
  processJob(wId, vId, rId).then((success) => {
    console.log(`[Worker CLI] Job completed. Success: ${success}`);
    process.exit(success ? 0 : 1);
  });
}
