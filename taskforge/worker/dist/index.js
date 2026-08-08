import http from 'http';
import { pollForJobs } from './worker.js';
console.log('[Worker] TaskForge Worker service initialized.');
console.log('[Worker] Ready to process automation tasks with Playwright.');
// Start lightweight HTTP server for Render free web service health checks
const port = Number(process.env.PORT) || 3002;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'taskforge-worker' }));
});
server.listen(port, () => {
    console.log(`[Worker] Health check HTTP server listening on port ${port}`);
});
// Start continuous polling loop for workflow jobs from backend
pollForJobs().catch((err) => {
    console.error('[Worker Fatal Error]', err);
});
