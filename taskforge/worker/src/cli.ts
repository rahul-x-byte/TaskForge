import { executeWorkflowRun } from './executor.js';

const workflowId = process.argv[2];
const versionId = process.argv[3];
const runId = process.argv[4];

console.log(`[Worker CLI] Command received to execute run:`, { workflowId, versionId, runId });

if (workflowId && versionId && runId) {
  executeWorkflowRun(workflowId, versionId, runId)
    .then((success) => {
      console.log(`[Worker CLI] Execution completed for run ${runId}. Success: ${success}`);
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error(`[Worker CLI Critical Error]`, err);
      process.exit(1);
    });
} else {
  console.error(`[Worker CLI Error] Missing arguments. Usage: tsx cli.ts <workflowId> <versionId> <runId>`);
  process.exit(1);
}
