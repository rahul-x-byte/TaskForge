import { executeWorkflowRun } from './executor.js';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
console.log('[Worker] TaskForge Automation Worker Service starting...');
console.log('[Worker] Listening for workflow execution jobs...');
// Polling Loop for execution jobs from backend
async function pollForJobs() {
    while (true) {
        try {
            // Check for pending runs
            const res = await fetch(`${BACKEND_URL}/api/workflows`);
            if (res.ok) {
                const workflows = await res.json();
                for (const wf of workflows) {
                    // Look up runs
                    const wfRes = await fetch(`${BACKEND_URL}/api/workflows/${wf.id}`);
                    if (wfRes.ok) {
                        // Check pending runs
                    }
                }
            }
        }
        catch (e) { }
        await new Promise((r) => setTimeout(r, 2000));
    }
}
// Single job worker function triggerable via CLI or queue
export async function processJob(workflowId, versionId, runId) {
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
