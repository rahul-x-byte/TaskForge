import { pool } from './db/index.js';
import { executeWorkflowRun } from './executor.js';
import { runDiagnostics } from './runStatus.js';

let isWorkerRunning = false;
let isExecutingJob = false;
let stopRequested = false;

/**
 * Atomically claims the next oldest pending workflow run directly from the database.
 * Uses atomic SQL conditional update to ensure two processes or poll iterations
 * can NEVER claim or execute the same run.
 */
export async function claimNextPendingRun(runId: string): Promise<any | null> {
  try {
    const updateRes = await pool.query(
      "UPDATE runs SET status = 'claimed' WHERE id = $1 AND status = 'pending' RETURNING *",
      [runId]
    );

    if (updateRes.rows && updateRes.rows.length > 0) {
      return updateRes.rows[0];
    }

    return null;
  } catch (err: any) {
    console.error(`[Worker] Error claiming run ${runId}:`, err?.message || err);
    return null;
  }
}

/**
 * Retrieves pending runs directly from the database without any HTTP requests.
 */
export async function getPendingRuns(limit = 5): Promise<any[]> {
  try {
    const res = await pool.query(
      "SELECT id, workflow_id, version_id, started_at FROM runs WHERE status = 'pending' ORDER BY started_at ASC LIMIT $1",
      [limit]
    );
    return res.rows || [];
  } catch (err: any) {
    console.error('[Worker] Error fetching pending runs from database:', err?.message || err);
    return [];
  }
}

/**
 * Starts the embedded automation worker polling loop inside the taskforge-bd process.
 * Enforces a strict singleton guard to ensure exactly ONE worker loop runs.
 */
export async function startWorker(): Promise<void> {
  if (isWorkerRunning) {
    console.log('[Worker] Embedded worker already active; skipping duplicate startup.');
    return;
  }

  isWorkerRunning = true;
  stopRequested = false;

  console.log('[Worker] Embedded automation worker started');
  console.log('[Worker] Polling for pending runs');

  // Launch asynchronous non-blocking polling loop
  (async () => {
    let checkCounter = 0;
    while (!stopRequested) {
      try {
        if (!isExecutingJob) {
          checkCounter++;
          // Log check message periodically to keep Render logs clean while verifying liveness
          if (checkCounter % 5 === 1) {
            console.log('[Worker] Checking for pending runs');
          }

          const pendingRuns = await getPendingRuns(5);

          if (pendingRuns.length > 0) {
            console.log(`[Worker] Found ${pendingRuns.length} pending runs`);

            for (const candidate of pendingRuns) {
              if (stopRequested) break;

              console.log(`[Worker] Attempting to claim run ${candidate.id}`);
              const claimedRun = await claimNextPendingRun(candidate.id);

              if (claimedRun) {
                console.log(`[Worker] Claimed run ${claimedRun.id}`);
                console.log(`[Worker] Starting execution for run ${claimedRun.id}`);
                isExecutingJob = true;

                try {
                  const success = await executeWorkflowRun(
                    claimedRun.workflow_id,
                    claimedRun.version_id,
                    claimedRun.id
                  );

                  if (success) {
                    console.log(`[Worker] Run ${claimedRun.id} completed`);
                  } else {
                    const diag = runDiagnostics.get(claimedRun.id);
                    const errMsg = diag?.error || 'Workflow execution failed';
                    console.log(`[Worker] Run ${claimedRun.id} failed: ${errMsg}`);
                  }
                } catch (execErr: any) {
                  const errMsg = execErr?.message || String(execErr);
                  console.log(`[Worker] Run ${claimedRun.id} failed: ${errMsg}`);
                } finally {
                  isExecutingJob = false;
                }

                // Process one run per iteration to maintain loop responsiveness
                break;
              } else {
                console.log(`[Worker] Run ${candidate.id} was already claimed.`);
              }
            }
          }
        }
      } catch (pollErr: any) {
        console.error('[Worker] Polling loop error:', pollErr?.message || pollErr);
      }

      // Poll interval: 2500ms
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    console.log('[Worker] Embedded worker polling loop stopped.');
  })().catch((fatalErr) => {
    console.error('[Worker] Fatal error in embedded worker loop:', fatalErr);
  });
}

/**
 * Gracefully stops the embedded worker loop.
 */
export function stopWorker(): void {
  stopRequested = true;
  isWorkerRunning = false;
  console.log('[Worker] Embedded worker stop requested.');
}
