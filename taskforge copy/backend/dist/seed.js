import { query } from './db/index.js';
import { v4 as uuidv4 } from 'uuid';
async function seed() {
    console.log('[Seed] Seeding sample workflow into database...');
    try {
        const workflowId = uuidv4();
        const versionId = uuidv4();
        const sampleSteps = [
            {
                action: 'navigate',
                timestamp: Date.now(),
                selectors: { css: 'window' },
                value: 'http://localhost:3001/login',
                pageUrl: 'http://localhost:3001/login',
            },
            {
                action: 'input',
                timestamp: Date.now() + 100,
                selectors: { css: '#username', role: 'input', name: 'Username' },
                value: 'admin',
                pageUrl: 'http://localhost:3001/login',
            },
            {
                action: 'input',
                timestamp: Date.now() + 200,
                selectors: { css: '#password', role: 'input', name: 'Password' },
                value: '[REDACTED]',
                pageUrl: 'http://localhost:3001/login',
            },
            {
                action: 'click',
                timestamp: Date.now() + 300,
                selectors: { css: '#login-submit', role: 'button', text: 'Login' },
                pageUrl: 'http://localhost:3001/login',
            },
            {
                action: 'click',
                timestamp: Date.now() + 400,
                selectors: { css: '#download-report-btn', role: 'link', text: 'Download Report' },
                pageUrl: 'http://localhost:3001/reports',
            },
        ];
        // Insert Workflow
        await query(`INSERT INTO workflows (id, name, created_at) VALUES ($1, $2, NOW())`, [workflowId, 'Sample Automated Download Workflow']);
        // Insert Workflow Version
        await query(`INSERT INTO workflow_versions (id, workflow_id, steps, created_at) VALUES ($1, $2, $3, NOW())`, [versionId, workflowId, JSON.stringify(sampleSteps)]);
        // Set Current Version
        await query(`UPDATE workflows SET current_version_id = $1 WHERE id = $2`, [versionId, workflowId]);
        console.log(`[Seed] Seeded Workflow ID: ${workflowId}`);
        console.log(`[Seed] Seeded Version ID: ${versionId}`);
    }
    catch (err) {
        console.error('[Seed Error]', err);
        process.exit(1);
    }
}
seed();
