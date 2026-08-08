import { pollForJobs } from './worker.js';
console.log('[Worker] TaskForge Worker service initialized.');
console.log('[Worker] Ready to process automation tasks with Playwright.');
// Start continuous polling loop for workflow jobs from backend
pollForJobs().catch((err) => {
    console.error('[Worker Fatal Error]', err);
});
