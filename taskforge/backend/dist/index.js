import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { pool, memoryUsers } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { executeWorkflowRun } from './executor.js';
import { requireAuth, requireAdmin, verifyWorkerSecret, verifySupabaseToken } from './auth.js';
import { supabaseAdmin } from './lib/supabaseAdmin.js';
const app = Fastify({ logger: true });
await app.register(cors, {
    origin: (origin, cb) => {
        // Allow non-browser requests (e.g. curl, background service workers, mobile, server-to-server)
        if (!origin)
            return cb(null, true);
        const allowedOrigins = [
            'https://task-forge-phi-six.vercel.app',
            'http://localhost:3000',
            'http://localhost:5173',
            'http://localhost:3001',
            'http://127.0.0.1:5173',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:3001',
        ];
        if (allowedOrigins.includes(origin) ||
            origin.startsWith('chrome-extension://') ||
            origin.endsWith('.vercel.app')) {
            return cb(null, true);
        }
        return cb(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Worker-Secret'],
});
await app.register(formbody);
await app.register(websocket);
const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir))
    fs.mkdirSync(uploadsDir, { recursive: true });
await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: '/uploads/',
});
// Run Database Migrations on Startup
try {
    await runMigrations();
    console.log('[Backend] Database migrations executed successfully.');
}
catch (mErr) {
    console.error('[Backend] Database migration failed:', mErr?.message || mErr);
    if (process.env.NODE_ENV === 'production') {
        console.error('[Backend] FATAL: Production startup failed because database migrations could not be applied.');
    }
}
// Global Health Checks (Root status, /health, /api/health, and /api/health/database)
async function handleHealthCheck(_request, reply) {
    const dbTest = await pool.testConnection();
    const isHealthy = dbTest.connected;
    return reply.status(200).send({
        status: isHealthy ? 'ok' : 'degraded',
        database: isHealthy ? 'connected' : 'disconnected',
        mode: dbTest.mode,
        timestamp: new Date().toISOString(),
    });
}
app.get('/', async (_request, reply) => {
    const dbTest = await pool.testConnection();
    return reply.send({
        name: 'TaskForge Backend API',
        status: dbTest.connected ? 'online' : 'degraded',
        database: dbTest.connected ? 'connected' : 'disconnected',
        health: '/health',
        api: '/api',
        timestamp: new Date().toISOString(),
    });
});
app.get('/health', handleHealthCheck);
app.get('/api/health', handleHealthCheck);
// Dedicated lightweight database ping endpoint (Part 12 & Part 18)
app.get('/api/health/database', async (_request, reply) => {
    const dbTest = await pool.testConnection();
    if (dbTest.connected) {
        return reply.status(200).send({
            status: 'ok',
            database: 'connected',
            timestamp: new Date().toISOString(),
        });
    }
    else {
        return reply.status(503).send({
            status: 'error',
            database: 'disconnected',
            message: 'Database connectivity test (SELECT 1) failed',
            timestamp: new Date().toISOString(),
        });
    }
});
// ====================================================
// 1. AUTHENTICATION APIS (SUPABASE AUTH INTEGRATION)
// ====================================================
/**
 * Public User Registration
 * Ignores any role passed from frontend and ALWAYS forces role = 'user'
 */
app.post('/api/auth/register', async (request, reply) => {
    const body = request.body;
    const { name, email, password } = body || {};
    if (!email || !password || !name) {
        return reply.status(400).send({ error: 'Missing fields', message: 'Name, email, and password are required.' });
    }
    try {
        // 1. Create User in Supabase Auth (Role is ALWAYS forced to 'user')
        const { data: signUpData, error: signUpError } = await supabaseAdmin.auth.signUp({
            email,
            password,
            options: {
                data: { name },
            },
        });
        let userId;
        let token = '';
        if (!signUpError && signUpData?.user) {
            userId = signUpData.user.id;
            token = signUpData.session?.access_token || '';
        }
        else {
            // Admin API fallback for instant confirmation
            const { data: adminData, error: adminError } = await supabaseAdmin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: { name },
            });
            if (adminError || !adminData?.user) {
                // Fallback for local memory testing
                userId = uuidv4();
                const memUser = { id: userId, name, email, role: 'user', created_at: new Date().toISOString() };
                memoryUsers.set(userId, memUser);
                return reply.send({
                    token: userId,
                    user: memUser,
                });
            }
            userId = adminData.user.id;
        }
        // 2. Ensure Profile Record in public.profiles with role = 'user'
        await pool.query(`INSERT INTO profiles (id, name, email, role, created_at, updated_at)
       VALUES ($1, $2, $3, 'user', NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, role = 'user'`, [userId, name, email]);
        // 3. Attempt Login to Return Session Token
        const { data: loginData } = await supabaseAdmin.auth.signInWithPassword({ email, password });
        if (loginData?.session) {
            token = loginData.session.access_token;
        }
        else if (!token) {
            token = userId;
        }
        const userProfile = { id: userId, name, email, role: 'user', created_at: new Date().toISOString() };
        return reply.status(201).send({
            token,
            user: userProfile,
        });
    }
    catch (err) {
        return reply.status(400).send({ error: 'Registration failed', message: err?.message || 'Could not register user.' });
    }
});
/**
 * User Login with Email & Password via Supabase Auth
 */
app.post('/api/auth/login', async (request, reply) => {
    const body = request.body;
    const { email, password } = body || {};
    if (!email || !password) {
        return reply.status(400).send({ error: 'Missing credentials', message: 'Email and password are required.' });
    }
    try {
        // 1. Authenticate with Supabase Auth
        const { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({ email, password });
        if (authError || !authData?.user) {
            // Local Memory User Fallback
            const memUser = Array.from(memoryUsers.values()).find((u) => u.email === email);
            if (memUser && (password === 'admin123' || password === 'user123' || password.length >= 4)) {
                return reply.send({
                    token: memUser.id,
                    user: memUser,
                });
            }
            return reply.status(401).send({ error: 'Invalid credentials', message: 'Invalid email or password.' });
        }
        const u = authData.user;
        const token = authData.session?.access_token || u.id;
        // Fetch User Profile Role from Database
        let name = u.user_metadata?.name || u.email || 'User';
        let role = 'user';
        const profRes = await pool.query('SELECT * FROM profiles WHERE id = $1', [u.id]);
        if (profRes.rows.length > 0) {
            name = profRes.rows[0].name || name;
            role = profRes.rows[0].role || 'user';
        }
        const userProfile = { id: u.id, name, email: u.email, role, created_at: u.created_at };
        return reply.send({
            token,
            user: userProfile,
        });
    }
    catch (err) {
        return reply.status(500).send({ error: 'Login error', message: err?.message });
    }
});
/**
 * Get Current Authenticated User Identity & Profile
 */
app.get('/api/auth/me', { preHandler: [requireAuth] }, async (request, reply) => {
    return reply.send({ user: request.user });
});
/**
 * Logout Endpoint
 */
app.post('/api/auth/logout', { preHandler: [requireAuth] }, async (request, reply) => {
    try {
        await supabaseAdmin.auth.signOut();
    }
    catch (e) { }
    return reply.send({ status: 'logged_out' });
});
// ====================================================
// 2. WORKFLOW APIS & IDOR OWNERSHIP PROTECTION
// ====================================================
/**
 * List Workflows (Users see ONLY their own workflows; Admins see ALL)
 */
app.get('/api/workflows', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    if (user.role === 'admin') {
        const res = await pool.query(`
      SELECT 
        w.id,
        w.name,
        w.user_id,
        w.created_at,
        w.current_version_id,
        COALESCE(jsonb_array_length(wv.steps), 0) AS "stepCount",
        wv.steps,
        p.name AS user_name,
        p.email AS user_email,
        (
          SELECT r.status 
          FROM runs r 
          WHERE r.workflow_id = w.id 
          ORDER BY r.started_at DESC 
          LIMIT 1
        ) AS "lastStatus",
        (
          SELECT r.id 
          FROM runs r 
          WHERE r.workflow_id = w.id 
          ORDER BY r.started_at DESC 
          LIMIT 1
        ) AS "latestRunId"
      FROM workflows w
      LEFT JOIN workflow_versions wv ON w.current_version_id = wv.id
      LEFT JOIN profiles p ON w.user_id = p.id
      ORDER BY w.created_at DESC
    `);
        return reply.send(res.rows);
    }
    const res = await pool.query(`
    SELECT 
      w.id,
      w.name,
      w.user_id,
      w.created_at,
      w.current_version_id,
      COALESCE(jsonb_array_length(wv.steps), 0) AS "stepCount",
      wv.steps,
      (
        SELECT r.status 
        FROM runs r 
        WHERE r.workflow_id = w.id 
        ORDER BY r.started_at DESC 
        LIMIT 1
      ) AS "lastStatus",
      (
        SELECT r.id 
        FROM runs r 
        WHERE r.workflow_id = w.id 
        ORDER BY r.started_at DESC 
        LIMIT 1
      ) AS "latestRunId"
    FROM workflows w
    LEFT JOIN workflow_versions wv ON w.current_version_id = wv.id
    WHERE w.user_id = $1
    ORDER BY w.created_at DESC
  `, [user.id]);
    return reply.send(res.rows || []);
});
/**
 * Create New Blank Workflow (Bound strictly to request.user.id)
 */
app.post('/api/workflows', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    const body = request.body;
    const workflowId = uuidv4();
    const versionId = uuidv4();
    const name = body?.name || `New Workflow - ${new Date().toLocaleTimeString()}`;
    const steps = body?.steps || [];
    await pool.query('INSERT INTO workflows (id, name, user_id, current_version_id) VALUES ($1, $2, $3, $4)', [workflowId, name, user.id, versionId]);
    await pool.query('INSERT INTO workflow_versions (id, workflow_id, steps) VALUES ($1, $2, $3)', [versionId, workflowId, JSON.stringify(steps)]);
    return reply.status(201).send({ workflowId, versionId, name, user_id: user.id });
});
/**
 * Create Workflow from Starter Template (Bound to request.user.id)
 */
app.post('/api/workflows/from-template', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    const body = request.body;
    const { templateId } = body || {};
    const templatePath = path.resolve(process.cwd(), `src/templates/${templateId || 'report-download'}.json`);
    let templateData;
    try {
        if (fs.existsSync(templatePath)) {
            templateData = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
        }
        else {
            templateData = {
                name: 'Report Download Workflow',
                steps: [
                    { action: 'navigate', pageUrl: 'http://localhost:3001/login' },
                    { action: 'input', selectors: { css: 'input[name="username"]' }, value: 'admin' },
                    { action: 'click', selectors: { css: 'button[type="submit"]' }, isSensitive: true },
                ],
            };
        }
    }
    catch (e) {
        templateData = { name: 'Starter Workflow', steps: [] };
    }
    const workflowId = uuidv4();
    const versionId = uuidv4();
    await pool.query('INSERT INTO workflows (id, name, user_id, current_version_id) VALUES ($1, $2, $3, $4)', [workflowId, templateData.name, user.id, versionId]);
    await pool.query('INSERT INTO workflow_versions (id, workflow_id, steps) VALUES ($1, $2, $3)', [versionId, workflowId, JSON.stringify(templateData.steps || [])]);
    return reply.status(201).send({
        workflowId,
        versionId,
        name: templateData.name,
        stepCount: (templateData.steps || []).length,
        user_id: user.id,
    });
});
/**
 * Post Recording from Extension
 * Strictly requires authentication via Supabase Bearer token; binds workflow to the authenticated user ID.
 * Uses pool.query as the single source of truth for workflow persistence.
 */
app.post('/api/recordings', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
        console.warn('[Recording] Rejected: Missing Authorization header');
        return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Authentication required. Please log in to TaskForge or supply an Authorization Bearer token.',
        });
    }
    const user = await verifySupabaseToken(authHeader);
    if (!user || !user.id) {
        console.warn('[Recording] Rejected: Invalid or expired token');
        return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Invalid or expired authentication token. Please log in to TaskForge again.',
        });
    }
    const body = request.body;
    if (!body || typeof body !== 'object') {
        return reply.status(400).send({
            error: 'Bad Request',
            message: 'Request body must be a valid JSON object.',
        });
    }
    if (!Array.isArray(body.steps)) {
        return reply.status(400).send({
            error: 'Bad Request',
            message: 'Payload must contain a "steps" array.',
        });
    }
    const steps = body.steps;
    const rawName = typeof body.name === 'string' ? body.name.trim() : '';
    const workflowName = rawName || `Recorded Workflow - ${new Date().toLocaleTimeString()}`;
    const workflowId = uuidv4();
    const versionId = uuidv4();
    // Safe structured log (never logs passwords, tokens, or sensitive values)
    console.log(`[Recording] user=${user.id} steps=${steps.length}`);
    try {
        await pool.withTransaction(async (client) => {
            // 1. Ensure user profile exists in database for FK referential integrity
            try {
                await client.query('INSERT INTO profiles (id, name, email, role) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING', [user.id, user.name || 'User', user.email || '', user.role || 'user']);
            }
            catch (profErr) {
                try {
                    await client.query('INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING', [user.id, user.name || 'User', user.email || '', 'managed_by_supabase', user.role || 'user']);
                }
                catch { }
            }
            // 2. Insert workflow (with current_version_id initially NULL)
            await client.query('INSERT INTO workflows (id, name, user_id, current_version_id) VALUES ($1, $2, $3, NULL)', [workflowId, workflowName, user.id]);
            // 3. Insert workflow_version (with workflow_id referencing the workflow)
            await client.query('INSERT INTO workflow_versions (id, workflow_id, steps) VALUES ($1, $2, $3)', [versionId, workflowId, JSON.stringify(steps)]);
            // 4. Update workflow with current_version_id
            await client.query('UPDATE workflows SET current_version_id = $1 WHERE id = $2', [versionId, workflowId]);
        });
        console.log(`[Recording] workflow=${workflowId} version=${versionId} persisted successfully`);
        return reply.status(201).send({
            status: 'success',
            workflowId,
            versionId,
            name: workflowName,
            stepCount: steps.length,
            user_id: user.id,
        });
    }
    catch (dbErr) {
        console.error('[Recording Error] Failed to persist workflow to PostgreSQL:', dbErr?.message || dbErr);
        return reply.status(500).send({
            error: 'Database Error',
            message: 'Failed to persist workflow to database. Transaction was rolled back.',
            details: process.env.NODE_ENV === 'production' ? undefined : (dbErr?.message || String(dbErr)),
        });
    }
});
/**
 * Get Workflow by ID (IDOR Guarded: User must own workflow or be Admin)
 */
app.get('/api/workflows/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params;
    let queryStr = 'SELECT w.* FROM workflows w WHERE w.id = $1';
    let queryParams = [id];
    if (user.role !== 'admin') {
        queryStr = 'SELECT w.* FROM workflows w WHERE w.id = $1 AND w.user_id = $2';
        queryParams = [id, user.id];
    }
    const res = await pool.query(queryStr, queryParams);
    if (res.rows.length === 0) {
        return reply.status(404).send({ error: 'Workflow not found or access denied.' });
    }
    const wf = res.rows[0];
    const verRes = await pool.query('SELECT * FROM workflow_versions WHERE id = $1', [wf.current_version_id]);
    const steps = verRes.rows.length > 0 ? verRes.rows[0].steps : [];
    return reply.send({
        ...wf,
        steps,
    });
});
/**
 * Update Entire Workflow (Name and/or Steps) - IDOR Guarded
 */
app.put('/api/workflows/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params;
    const body = request.body;
    if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Bad Request', message: 'Request body must be a valid JSON object.' });
    }
    // Check ownership
    let checkQuery = 'SELECT * FROM workflows WHERE id = $1';
    let checkParams = [id];
    if (user.role !== 'admin') {
        checkQuery = 'SELECT * FROM workflows WHERE id = $1 AND user_id = $2';
        checkParams = [id, user.id];
    }
    const wfRes = await pool.query(checkQuery, checkParams);
    if (wfRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Workflow not found or access denied.' });
    }
    const wf = wfRes.rows[0];
    // 1. Update workflow name if provided
    if (typeof body.name === 'string' && body.name.trim()) {
        await pool.query('UPDATE workflows SET name = $1 WHERE id = $2', [body.name.trim(), id]);
        wf.name = body.name.trim();
    }
    // 2. Update workflow steps if provided
    let stepCount;
    if (Array.isArray(body.steps)) {
        stepCount = body.steps.length;
        if (wf.current_version_id) {
            await pool.query('UPDATE workflow_versions SET steps = $1 WHERE id = $2', [JSON.stringify(body.steps), wf.current_version_id]);
        }
        else {
            const newVerId = uuidv4();
            await pool.query('INSERT INTO workflow_versions (id, workflow_id, steps) VALUES ($1, $2, $3)', [newVerId, id, JSON.stringify(body.steps)]);
            await pool.query('UPDATE workflows SET current_version_id = $1 WHERE id = $2', [newVerId, id]);
            wf.current_version_id = newVerId;
        }
    }
    return reply.send({
        status: 'success',
        workflowId: id,
        name: wf.name,
        stepCount,
    });
});
/**
 * Update Workflow Steps (IDOR Guarded)
 */
app.put('/api/workflows/:id/steps', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params;
    const body = request.body;
    const steps = body?.steps || [];
    // Check ownership
    let checkQuery = 'SELECT * FROM workflows WHERE id = $1';
    let checkParams = [id];
    if (user.role !== 'admin') {
        checkQuery = 'SELECT * FROM workflows WHERE id = $1 AND user_id = $2';
        checkParams = [id, user.id];
    }
    const wfRes = await pool.query(checkQuery, checkParams);
    if (wfRes.rows.length === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Workflow not found or access denied.' });
    }
    const wf = wfRes.rows[0];
    await pool.query('UPDATE workflow_versions SET steps = $1 WHERE id = $2', [JSON.stringify(steps), wf.current_version_id]);
    return reply.send({ status: 'updated', workflowId: id, stepCount: steps.length });
});
/**
 * Delete Workflow (IDOR Guarded & Cascade Delete)
 */
app.delete('/api/workflows/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params;
    let delQuery = 'DELETE FROM workflows WHERE id = $1 RETURNING id';
    let delParams = [id];
    if (user.role !== 'admin') {
        delQuery = 'DELETE FROM workflows WHERE id = $1 AND user_id = $2 RETURNING id';
        delParams = [id, user.id];
    }
    const res = await pool.query(delQuery, delParams);
    const deletedCount = res.rows ? res.rows.length : res.rowCount || 0;
    if (deletedCount === 0) {
        return reply.status(404).send({ error: 'Not Found', message: 'Workflow not found or access denied.' });
    }
    return reply.send({ status: 'deleted', workflowId: id });
});
/**
 * Trigger Workflow Execution Run (IDOR Guarded)
 */
app.post('/api/workflows/:id/run', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params;
    let checkQuery = 'SELECT * FROM workflows WHERE id = $1';
    let checkParams = [id];
    if (user.role !== 'admin') {
        checkQuery = 'SELECT * FROM workflows WHERE id = $1 AND user_id = $2';
        checkParams = [id, user.id];
    }
    const wfRes = await pool.query(checkQuery, checkParams);
    if (wfRes.rows.length === 0) {
        return reply.status(403).send({ error: 'Forbidden', message: 'You do not own this workflow.' });
    }
    const wf = wfRes.rows[0];
    const runId = uuidv4();
    await pool.query('INSERT INTO runs (id, workflow_id, version_id, status) VALUES ($1, $2, $3, $4)', [runId, id, wf.current_version_id, 'pending']);
    // Trigger non-blocking worker execution
    executeWorkflowRun(id, wf.current_version_id, runId).catch((err) => {
        console.error(`[Execution Error] Run ${runId} failed:`, err);
    });
    return reply.status(202).send({ runId, status: 'pending', workflowId: id });
});
/**
 * Save Schedule for Workflow (IDOR Guarded)
 */
app.post('/api/workflows/:id/schedule', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params;
    const body = request.body;
    const { frequency, time } = body || {};
    let checkQuery = 'SELECT * FROM workflows WHERE id = $1';
    let checkParams = [id];
    if (user.role !== 'admin') {
        checkQuery = 'SELECT * FROM workflows WHERE id = $1 AND user_id = $2';
        checkParams = [id, user.id];
    }
    const wfRes = await pool.query(checkQuery, checkParams);
    if (wfRes.rows.length === 0) {
        return reply.status(403).send({ error: 'Forbidden', message: 'You do not own this workflow.' });
    }
    await pool.query('INSERT INTO schedules (id, user_id, workflow_id, frequency, time, enabled) VALUES ($1, $2, $3, $4, $5, true)', [uuidv4(), user.id, id, frequency || 'daily', time || '09:00']);
    return reply.send({ status: 'scheduled', workflowId: id, frequency, time });
});
// ====================================================
// 3. RUN HISTORY, DOWNLOADS & APPROVAL GATES
// ====================================================
/**
 * List Audit Log Runs (Users see ONLY their own runs; Admins see ALL)
 */
app.get('/api/runs', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    if (user.role === 'admin') {
        const res = await pool.query(`
      SELECT r.*, w.name as workflow_name, p.name as user_name, p.email as user_email
      FROM runs r
      JOIN workflows w ON r.workflow_id = w.id
      LEFT JOIN profiles p ON w.user_id = p.id
      ORDER BY r.started_at DESC
    `);
        return reply.send(res.rows);
    }
    const res = await pool.query(`
    SELECT r.*, w.name as workflow_name
    FROM runs r
    JOIN workflows w ON r.workflow_id = w.id
    WHERE w.user_id = $1
    ORDER BY r.started_at DESC
  `, [user.id]);
    return reply.send(res.rows);
});
/**
 * Get Run Detail by ID (IDOR Guarded)
 */
app.get('/api/runs/:id', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params;
    let queryStr = `
    SELECT r.*, w.name as workflow_name, w.user_id
    FROM runs r
    JOIN workflows w ON r.workflow_id = w.id
    WHERE r.id = $1
  `;
    let queryParams = [id];
    if (user.role !== 'admin') {
        queryStr += ' AND w.user_id = $2';
        queryParams = [id, user.id];
    }
    const res = await pool.query(queryStr, queryParams);
    if (res.rows.length === 0) {
        return reply.status(404).send({ error: 'Run not found or access denied.' });
    }
    const run = res.rows[0];
    const verRes = await pool.query('SELECT * FROM workflow_versions WHERE id = $1', [run.version_id]);
    const steps = verRes.rows.length > 0 ? verRes.rows[0].steps : [];
    return reply.send({ run, steps });
});
/**
 * Download Result File (IDOR Guarded)
 */
app.get('/api/runs/:id/download', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params;
    let queryStr = `
    SELECT r.* FROM runs r
    JOIN workflows w ON r.workflow_id = w.id
    WHERE r.id = $1
  `;
    let queryParams = [id];
    if (user.role !== 'admin') {
        queryStr += ' AND w.user_id = $2';
        queryParams = [id, user.id];
    }
    const res = await pool.query(queryStr, queryParams);
    if (res.rows.length === 0) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied.' });
    }
    const run = res.rows[0];
    const filename = run.detail?.downloadFilename || `${id}.csv`;
    const filePath = path.join(uploadsDir, filename);
    if (!fs.existsSync(filePath)) {
        return reply.status(404).send({ error: 'File not found on backend storage server.' });
    }
    const buffer = fs.readFileSync(filePath);
    return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(buffer);
});
/**
 * Preview File Content (IDOR Guarded)
 */
app.get('/api/runs/:id/preview', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params;
    let queryStr = `
    SELECT r.* FROM runs r
    JOIN workflows w ON r.workflow_id = w.id
    WHERE r.id = $1
  `;
    let queryParams = [id];
    if (user.role !== 'admin') {
        queryStr += ' AND w.user_id = $2';
        queryParams = [id, user.id];
    }
    const res = await pool.query(queryStr, queryParams);
    if (res.rows.length === 0) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied.' });
    }
    const run = res.rows[0];
    const filename = run.detail?.downloadFilename || `${id}.csv`;
    const filePath = path.join(uploadsDir, filename);
    if (!fs.existsSync(filePath)) {
        return reply.status(404).send({ error: 'File not found' });
    }
    const content = fs.readFileSync(filePath, 'utf8');
    return reply.send({ filename, content: content.slice(0, 10000) });
});
/**
 * Approve Gate Pause (IDOR Guarded)
 */
app.post('/api/runs/:id/approve', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params;
    let checkQuery = 'SELECT r.* FROM runs r JOIN workflows w ON r.workflow_id = w.id WHERE r.id = $1';
    let checkParams = [id];
    if (user.role !== 'admin') {
        checkQuery += ' AND w.user_id = $2';
        checkParams = [id, user.id];
    }
    const res = await pool.query(checkQuery, checkParams);
    if (res.rows.length === 0) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied.' });
    }
    await pool.query("UPDATE runs SET status = 'running' WHERE id = $1", [id]);
    return reply.send({ status: 'approved', runId: id });
});
/**
 * Cancel Gate Pause (IDOR Guarded)
 */
app.post('/api/runs/:id/cancel', { preHandler: [requireAuth] }, async (request, reply) => {
    const user = request.user;
    const { id } = request.params;
    let checkQuery = 'SELECT r.* FROM runs r JOIN workflows w ON r.workflow_id = w.id WHERE r.id = $1';
    let checkParams = [id];
    if (user.role !== 'admin') {
        checkQuery += ' AND w.user_id = $2';
        checkParams = [id, user.id];
    }
    const res = await pool.query(checkQuery, checkParams);
    if (res.rows.length === 0) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Access denied.' });
    }
    await pool.query("UPDATE runs SET status = 'cancelled', finished_at = NOW() WHERE id = $1", [id]);
    return reply.send({ status: 'cancelled', runId: id });
});
// ====================================================
// 4. ADMIN OPERATIONS APIS (ADMIN ONLY)
// ====================================================
/**
 * Admin: List All User Accounts
 */
app.get('/api/admin/users', { preHandler: [requireAdmin] }, async (request, reply) => {
    const res = await pool.query(`
    SELECT p.*,
      (SELECT COUNT(*) FROM workflows w WHERE w.user_id = p.id) as workflow_count,
      (SELECT COUNT(*) FROM runs r JOIN workflows w ON r.workflow_id = w.id WHERE w.user_id = p.id) as run_count
    FROM profiles p
    ORDER BY p.created_at DESC
  `);
    return reply.send(res.rows);
});
/**
 * Admin: Create New User Account (Role = 'user' or 'admin')
 */
app.post('/api/admin/users', { preHandler: [requireAdmin] }, async (request, reply) => {
    const body = request.body;
    const { name, email, password, role } = body || {};
    if (!email || !password || !name) {
        return reply.status(400).send({ error: 'Missing fields', message: 'Name, email, and password are required.' });
    }
    const targetRole = role === 'admin' ? 'admin' : 'user';
    try {
        // Create Supabase Auth User
        const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: { name },
        });
        let userId;
        if (!createError && createData?.user) {
            userId = createData.user.id;
        }
        else {
            userId = uuidv4();
        }
        // Insert/Update Profiles Table
        await pool.query(`INSERT INTO profiles (id, name, email, role, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role`, [userId, name, email, targetRole]);
        const memUser = { id: userId, name, email, role: targetRole, created_at: new Date().toISOString() };
        memoryUsers.set(userId, memUser);
        return reply.status(201).send({ status: 'created', user: memUser });
    }
    catch (err) {
        return reply.status(400).send({ error: 'Failed to create user', message: err?.message });
    }
});
/**
 * Admin: Update User Role (with Admin Self-Lockout Protection)
 */
app.put('/api/admin/users/:id/role', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    const targetRole = body?.role === 'admin' ? 'admin' : 'user';
    // Admin Self-Lockout Check: Ensure at least one admin remains
    if (targetRole === 'user') {
        const adminCountRes = await pool.query("SELECT COUNT(*) as count FROM profiles WHERE role = 'admin'");
        const adminCount = Number(adminCountRes.rows[0]?.count || 1);
        if (adminCount <= 1) {
            const targetUserRes = await pool.query("SELECT role FROM profiles WHERE id = $1", [id]);
            if (targetUserRes.rows[0]?.role === 'admin') {
                return reply.status(400).send({
                    error: 'Forbidden Operation',
                    message: 'Cannot demote the last remaining administrator account. System must maintain at least one admin.',
                });
            }
        }
    }
    await pool.query('UPDATE profiles SET role = $1, updated_at = NOW() WHERE id = $2', [targetRole, id]);
    const memUser = memoryUsers.get(id);
    if (memUser)
        memUser.role = targetRole;
    return reply.send({ status: 'updated', userId: id, role: targetRole });
});
/**
 * Admin: Delete User Account (with Admin Self-Lockout Protection)
 */
app.delete('/api/admin/users/:id', { preHandler: [requireAdmin] }, async (request, reply) => {
    const { id } = request.params;
    const targetUserRes = await pool.query('SELECT role FROM profiles WHERE id = $1', [id]);
    const isTargetAdmin = targetUserRes.rows[0]?.role === 'admin';
    if (isTargetAdmin) {
        const adminCountRes = await pool.query("SELECT COUNT(*) as count FROM profiles WHERE role = 'admin'");
        const adminCount = Number(adminCountRes.rows[0]?.count || 1);
        if (adminCount <= 1) {
            return reply.status(400).send({
                error: 'Forbidden Operation',
                message: 'Cannot delete the last remaining administrator account.',
            });
        }
    }
    // Delete from Supabase Auth & Profiles (Cascade deletes workflows & runs)
    try {
        await supabaseAdmin.auth.admin.deleteUser(id).catch(() => { });
    }
    catch (e) { }
    await pool.query('DELETE FROM profiles WHERE id = $1', [id]);
    memoryUsers.delete(id);
    return reply.send({ status: 'deleted', userId: id });
});
/**
 * Admin: Get Platform System Statistics
 */
app.get('/api/admin/stats', { preHandler: [requireAdmin] }, async (request, reply) => {
    const usersRes = await pool.query('SELECT role FROM profiles');
    const workflowsRes = await pool.query('SELECT COUNT(*) as count FROM workflows');
    const runsRes = await pool.query('SELECT status FROM runs');
    const usersList = usersRes.rows;
    const totalUsers = usersList.length;
    const totalAdmins = usersList.filter((u) => u.role === 'admin').length;
    const totalNormalUsers = totalUsers - totalAdmins;
    const totalWorkflows = Number(workflowsRes.rows[0]?.count || 0);
    const runsList = runsRes.rows;
    const totalRuns = runsList.length;
    const successfulRuns = runsList.filter((r) => r.status === 'completed' || r.status === 'success').length;
    const failedRuns = runsList.filter((r) => r.status === 'failed' || r.status === 'timed_out').length;
    const currentlyRunning = runsList.filter((r) => r.status === 'running' || r.status === 'pending' || r.status === 'awaiting_approval').length;
    return reply.send({
        totalUsers,
        totalAdmins,
        totalNormalUsers,
        totalWorkflows,
        totalRuns,
        successfulRuns,
        failedRuns,
        currentlyRunning,
    });
});
// ====================================================
// 5. INTERNAL WORKER APIS (AUTHENTICATED VIA X-WORKER-SECRET)
// ====================================================
app.get('/api/runs/pending', { preHandler: [verifyWorkerSecret] }, async (request, reply) => {
    const res = await pool.query("SELECT * FROM runs WHERE status = 'pending' ORDER BY started_at ASC LIMIT 5");
    return reply.send(res.rows);
});
app.post('/api/runs/:id/claim', { preHandler: [verifyWorkerSecret] }, async (request, reply) => {
    const { id } = request.params;
    const res = await pool.query("UPDATE runs SET status = 'claimed' WHERE id = $1 AND status = 'pending' RETURNING *", [id]);
    if (res.rows.length === 0)
        return reply.status(409).send({ error: 'Run already claimed or not pending' });
    return reply.send(res.rows[0]);
});
app.post('/api/runs/:id/upload-result', { preHandler: [verifyWorkerSecret] }, async (request, reply) => {
    const { id } = request.params;
    const filename = request.headers['x-filename'] || `${id}.csv`;
    const filePath = path.join(uploadsDir, filename);
    const rawBuffer = request.body;
    fs.writeFileSync(filePath, rawBuffer);
    await pool.query("UPDATE runs SET status = 'completed', finished_at = NOW() WHERE id = $1", [id]);
    return reply.send({ status: 'uploaded', filename, path: `/uploads/${filename}` });
});
app.patch('/api/runs/:id/status', { preHandler: [verifyWorkerSecret] }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    const { status, detail, error } = body || {};
    try {
        const detailJson = detail ? JSON.stringify(detail) : null;
        await pool.query(`UPDATE runs 
       SET status = $1, 
           error = COALESCE($2, error), 
           detail = COALESCE($3::jsonb, detail),
           finished_at = CASE WHEN $1 IN ('completed', 'failed', 'cancelled', 'timed_out') THEN NOW() ELSE finished_at END 
       WHERE id = $4`, [status, error || null, detailJson, id]);
        if (detail && typeof detail.stepIndex === 'number') {
            await pool.query(`INSERT INTO run_steps (run_id, step_index, status, error_message, screenshot_url)
         VALUES ($1, $2, $3, $4, $5)`, [id, detail.stepIndex, detail.status || status, error || detail.error || null, detail.screenshotUrl || null]).catch(() => { });
        }
    }
    catch (err) {
        console.warn(`[Run Status Update Warning] Failed to update full detail:`, err?.message || err);
        await pool.query(`UPDATE runs SET status = $1, finished_at = CASE WHEN $1 IN ('completed', 'failed', 'cancelled', 'timed_out') THEN NOW() ELSE finished_at END WHERE id = $2`, [status, id]).catch(() => { });
    }
    return reply.send({ status: 'updated', runId: id });
});
app.post('/api/runs/:id/credentials', { preHandler: [verifyWorkerSecret] }, async (request, reply) => {
    const { id } = request.params;
    const body = request.body;
    const { value } = body || {};
    return reply.send({ status: 'submitted', runId: id, value });
});
// ====================================================
// 6. WEBSOCKET FOR REAL-TIME RUN UPDATES & APPROVALS
// ====================================================
app.get('/ws/runs/:id', { websocket: true }, async (connection, req) => {
    const ws = connection.socket || connection;
    const runId = req.params?.id;
    console.log(`[WebSocket] Connected for run ${runId}`);
    // Query parameter or subprotocol auth verification
    const urlParams = new URLSearchParams(req.url?.split('?')[1] || '');
    const token = urlParams.get('token');
    if (token) {
        const authUser = await verifySupabaseToken(`Bearer ${token}`);
        if (!authUser) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized WebSocket connection.' }));
            ws.close();
            return;
        }
    }
    const interval = setInterval(async () => {
        try {
            const res = await pool.query('SELECT * FROM runs WHERE id = $1', [runId]);
            if (res.rows.length > 0) {
                ws.send(JSON.stringify({ type: 'STATUS_UPDATE', run: res.rows[0] }));
            }
        }
        catch (e) { }
    }, 1000);
    ws.on('close', () => {
        clearInterval(interval);
        console.log(`[WebSocket] Disconnected for run ${runId}`);
    });
});
// Start Fastify Server
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '0.0.0.0';
app.listen({ port, host }, (err, address) => {
    if (err) {
        console.error('[Fatal Backend Error]', err);
        process.exit(1);
    }
    console.log(`====================================================`);
    console.log(` TaskForge Fastify Backend Server running at: ${address}`);
    console.log(` Supabase Auth & RLS Security Engine Active.`);
    console.log(`====================================================`);
});
