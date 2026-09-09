import { executeWorkflowRun } from './executor.js';
import { resolveBackendUrl } from './config.js';

const BACKEND_URL = resolveBackendUrl();

const workerSecretEnv = process.env.WORKER_SECRET;
if (!workerSecretEnv || workerSecretEnv.trim() === '') {
  console.error('[Worker] FATAL: WORKER_SECRET environment variable is missing.');
  throw new Error('WORKER_SECRET environment variable is required.');
}
const WORKER_SECRET: string = workerSecretEnv;

console.log('[Worker] WORKER_SECRET configured: true');
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
        if (Array.isArray(pendingRuns) && pendingRuns.length > 0) {
          console.log(`[Worker] Found ${pendingRuns.length} pending run(s).`);
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
            } else if (claimRes.status === 401 || claimRes.status === 403) {
              console.error(`[Worker] Authentication failed: POST /api/runs/${run.id}/claim returned HTTP ${claimRes.status}. Check WORKER_SECRET.`);
            } else if (claimRes.status !== 409) {
              console.warn(`[Worker] Failed to claim run ${run.id}: HTTP ${claimRes.status}`);
            }
          }
        }
      } else if (res.status === 401 || res.status === 403) {
        console.error(`[Worker] Authentication failed: GET /api/runs/pending returned HTTP ${res.status}. Check that WORKER_SECRET matches backend.`);
      } else {
        console.warn(`[Worker] GET /api/runs/pending returned HTTP ${res.status}: ${res.statusText}`);
      }
    } catch (e: any) {
      console.error('[Worker] Poll error:', e?.message || e);
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
} else if (process.argv[1]?.endsWith('worker.js') || process.argv[1]?.endsWith('worker.ts')) {
  // If worker is invoked directly as entrypoint without arguments, start polling loop
  pollForJobs().catch((err) => {
    console.error('[Worker Fatal Error]', err);
  });
}
