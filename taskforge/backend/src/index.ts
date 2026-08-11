import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const fastify = Fastify({
  logger: true,
});

// WebSocket connections map
const wsConnections = new Map<string, Set<any>>();
const memorySchedules = new Map<string, any>();

// Register plugins
await fastify.register(fastifyCors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});
await fastify.register(fastifyWebsocket);
await fastify.register(fastifyFormbody);

// Register binary buffer parser for worker file uploads
fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (req, body, done) => {
  done(null, body);
});

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Serve Frontend Static Bundle if built
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDistPath)) {
  await fastify.register(fastifyStatic, {
    root: frontendDistPath,
    prefix: '/',
  });
  fastify.setNotFoundHandler((request, reply) => {
    if (request.raw.url && (request.raw.url.startsWith('/api') || request.raw.url.startsWith('/ws'))) {
      return reply.status(404).send({ error: 'Endpoint not found' });
    }
    return reply.sendFile('index.html', frontendDistPath);
  });
}

// Health check endpoints
fastify.get('/', async () => {
  return { status: 'ok', service: 'TaskForge Backend API' };
});

fastify.get('/health', async () => {
  return { status: 'ok', service: 'backend' };
});

// Broadcast helper for WebSockets
export function broadcastRunUpdate(runId: string, payload: any) {
  const clients = wsConnections.get(runId);
  if (clients) {
    const msg = JSON.stringify(payload);
    clients.forEach((ws) => {
      try {
        ws.send(msg);
      } catch (err) {
        // connection closed
      }
    });
  }
}

// WebSocket Endpoint: /ws/runs/:id
fastify.register(async function (fastifyApp) {
  fastifyApp.get('/ws/runs/:id', { websocket: true }, (connection, req) => {
    const { id } = req.params as { id: string };
    const socket = (connection as any).socket || connection;
    fastify.log.info(`WebSocket client connected for run: ${id}`);
    
    if (!wsConnections.has(id)) {
      wsConnections.set(id, new Set());
    }
    wsConnections.get(id)!.add(socket);

    // Echo initial connected message
    socket.send(JSON.stringify({
      type: 'STATUS_UPDATE',
      runId: id,
      status: 'connected',
      timestamp: Date.now(),
    }));

    socket.on('close', () => {
      wsConnections.get(id)?.delete(socket);
    });

    socket.on('message', (message: Buffer) => {
      fastify.log.info(`Received message on run ${id}: ${message.toString()}`);
    });
  });
});

// -------------------------------------------------------------
// REST ENDPOINTS
// -------------------------------------------------------------

// 1. POST /api/recordings & POST /recordings — Accepts raw JSON array, creates workflow & version
const handleCreateRecording = async (request: any, reply: any) => {
  const body = request.body as { name?: string; steps: any[] } | any[];
  const steps = Array.isArray(body) ? body : body?.steps || [];
  const name = (!Array.isArray(body) && body?.name) ? body.name : `Recorded Workflow ${new Date().toLocaleDateString()}`;

  const workflowId = uuidv4();
  const versionId = uuidv4();

  try {
    await pool.query(
      `INSERT INTO workflows (id, name, created_at) VALUES ($1, $2, NOW())`,
      [workflowId, name]
    );

    await pool.query(
      `INSERT INTO workflow_versions (id, workflow_id, steps, created_at) VALUES ($1, $2, $3, NOW())`,
      [versionId, workflowId, JSON.stringify(steps)]
    );

    await pool.query(
      `UPDATE workflows SET current_version_id = $1 WHERE id = $2`,
      [versionId, workflowId]
    );

    return reply.status(201).send({
      message: 'Workflow recorded successfully',
      workflowId,
      versionId,
      stepCount: steps.length,
    });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to save recorded workflow', message: err?.message });
  }
};

fastify.post('/api/recordings', handleCreateRecording);
fastify.post('/recordings', handleCreateRecording);

// 1b. POST /api/workflows/from-template — Create workflow pre-populated from JSON fixture template
fastify.post('/api/workflows/from-template', async (request, reply) => {
  const { templateId } = (request.body || {}) as { templateId: string };

  if (!templateId) {
    return reply.status(400).send({ error: 'templateId is required' });
  }

  const templateNames: Record<string, string> = {
    'report-download': 'Report Download Workflow',
    'form-fill': 'Spreadsheet Form-Fill Workflow',
    'page-watch': 'Page Change Watcher Workflow',
  };

  const fallbackSteps: Record<string, any[]> = {
    'report-download': [
      { action: 'navigate', timestamp: 1700000000000, selectors: { css: 'window' }, value: 'http://localhost:3001/login', pageUrl: 'http://localhost:3001/login' },
      { action: 'click', timestamp: 1700000000100, selectors: { css: '#download-report-btn', role: 'link', name: 'Download Report', text: 'Download Report' }, isSensitive: false, pageUrl: 'http://localhost:3001/reports' },
      { action: 'download', timestamp: 1700000000200, selectors: { css: '#download-report-btn' }, value: 'report_{{date}}.csv', isDownloadAction: true, pageUrl: 'http://localhost:3001/reports' }
    ],
    'form-fill': [
      { action: 'navigate', timestamp: 1700000000000, selectors: { css: 'window' }, value: 'http://localhost:3001/form', pageUrl: 'http://localhost:3001/form' },
      { action: 'input', timestamp: 1700000000100, selectors: { css: "input[name='full_name']", role: 'textbox', name: 'Full Name' }, value: '{{row.full_name}}', pageUrl: 'http://localhost:3001/form' },
      { action: 'input', timestamp: 1700000000200, selectors: { css: "input[name='email_address']", role: 'textbox', name: 'Email Address' }, value: '{{row.email_address}}', pageUrl: 'http://localhost:3001/form' },
      { action: 'click', timestamp: 1700000000300, selectors: { css: "button[type='submit']", role: 'button', name: 'Submit Form' }, isSensitive: true, pageUrl: 'http://localhost:3001/form' }
    ],
    'page-watch': [
      { action: 'navigate', timestamp: 1700000000000, selectors: { css: 'window' }, value: 'http://localhost:3001/status', pageUrl: 'http://localhost:3001/status' },
      { action: 'check_change', timestamp: 1700000000100, selectors: { css: '.status-indicator', text: 'Status Page' }, value: 'snapshot_comparison', snapshotKey: 'previous_page_snapshot', pageUrl: 'http://localhost:3001/status' },
      { action: 'notify', timestamp: 1700000000200, selectors: { css: 'window' }, value: "console.log('[Page Watcher] Detected content change on target page')", pageUrl: 'http://localhost:3001/status' }
    ]
  };

  const name = templateNames[templateId] || `Template Workflow (${templateId})`;
  let steps: any[] = fallbackSteps[templateId] || [];

  const possiblePaths = [
    path.join(__dirname, 'templates', `${templateId}.json`),
    path.join(__dirname, '../src/templates', `${templateId}.json`),
    path.join(process.cwd(), 'src/templates', `${templateId}.json`),
    path.join(process.cwd(), 'backend/src/templates', `${templateId}.json`),
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const fileContent = fs.readFileSync(p, 'utf-8');
        steps = JSON.parse(fileContent);
        break;
      }
    } catch (e) {}
  }

  const workflowId = uuidv4();
  const versionId = uuidv4();

  try {
    await pool.query(
      `INSERT INTO workflows (id, name, created_at) VALUES ($1, $2, NOW())`,
      [workflowId, name]
    );

    await pool.query(
      `INSERT INTO workflow_versions (id, workflow_id, steps, created_at) VALUES ($1, $2, $3, NOW())`,
      [versionId, workflowId, JSON.stringify(steps)]
    );

    await pool.query(
      `UPDATE workflows SET current_version_id = $1 WHERE id = $2`,
      [versionId, workflowId]
    );

    return reply.status(201).send({
      message: 'Workflow created from template successfully',
      workflowId,
      versionId,
      name,
      stepCount: steps.length,
    });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to create workflow from template', message: err?.message });
  }
});

// 2. GET /api/workflows — List all workflows
fastify.get('/api/workflows', async (request, reply) => {
  try {
    const res = await pool.query(
      `SELECT w.id, w.name, w.created_at, w.current_version_id, wv.steps
       FROM workflows w
       LEFT JOIN workflow_versions wv ON w.current_version_id = wv.id
       ORDER BY w.created_at DESC`
    );
    const list = res.rows.map((wf) => ({
      ...wf,
      schedule: memorySchedules.get(wf.id) || null,
      lastStatus: wf.lastStatus || wf.last_status || 'never_run',
    }));
    return reply.send(list);
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch workflows', message: err?.message });
  }
});

// 3. GET /api/workflows/:id — Get single workflow with latest version
fastify.get('/api/workflows/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const res = await pool.query(
      `SELECT w.id, w.name, w.created_at, w.current_version_id, wv.steps
       FROM workflows w
       LEFT JOIN workflow_versions wv ON w.current_version_id = wv.id
       WHERE w.id = $1`,
      [id]
    );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    const item = res.rows[0];
    item.schedule = memorySchedules.get(id) || null;
    return reply.send(item);
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch workflow', message: err?.message });
  }
});

// In-memory credentials map for temporary execution storage (runId -> { stepIndex, value })
const pendingCredentialsMap = new Map<string, { stepIndex: number; value: string }>();

// 3b. PUT /api/workflows/:id/steps — Update workflow steps
fastify.put('/api/workflows/:id/steps', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { steps } = (request.body || {}) as { steps: any[] };

  if (!Array.isArray(steps)) {
    return reply.status(400).send({ error: 'steps must be an array' });
  }

  try {
    const wfRes = await pool.query(`SELECT id, current_version_id FROM workflows WHERE id = $1`, [id]);
    if (wfRes.rows.length === 0 || !wfRes.rows[0].current_version_id) {
      return reply.status(404).send({ error: 'Workflow or active version not found' });
    }

    const versionId = wfRes.rows[0].current_version_id;
    await pool.query(
      `UPDATE workflow_versions SET steps = $1 WHERE id = $2`,
      [JSON.stringify(steps), versionId]
    );

    return reply.send({
      message: 'Workflow steps updated successfully',
      workflowId: id,
      versionId,
      stepCount: steps.length,
    });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to update workflow steps', message: err?.message });
  }
});

// 4. POST /api/workflows/:id/run — Enqueue a run job & trigger worker execution
fastify.post('/api/workflows/:id/run', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const wfRes = await pool.query(`SELECT id, name, current_version_id FROM workflows WHERE id = $1`, [id]);
    if (wfRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    const workflow = wfRes.rows[0];
    if (!workflow.current_version_id) {
      return reply.status(400).send({ error: 'Workflow has no active version' });
    }

    const runId = uuidv4();
    const versionId = workflow.current_version_id;

    // Create run record in DB
    await pool.query(
      `INSERT INTO runs (id, workflow_id, version_id, status, started_at) VALUES ($1, $2, $3, 'pending', NOW())`,
      [runId, id, versionId]
    );

    return reply.status(202).send({
      message: 'Workflow run enqueued',
      runId,
      workflowId: id,
      versionId,
      status: 'pending',
    });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to enqueue workflow run', message: err?.message });
  }
});

// 5. POST /api/workflows/:id/schedule — Set recurring schedule for a workflow
fastify.post('/api/workflows/:id/schedule', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { frequency, time, cron } = (request.body || {}) as { frequency: string; time?: string; cron?: string };

  const scheduleConfig = {
    workflowId: id,
    frequency: frequency || 'daily',
    time: time || '09:00',
    cron: cron || '0 9 * * *',
    enabled: true,
    updatedAt: new Date().toISOString(),
  };

  memorySchedules.set(id, scheduleConfig);

  return reply.send({
    message: 'Workflow schedule saved successfully',
    schedule: scheduleConfig,
  });
});

// 6. GET /api/runs — Audit log listing recent runs across all workflows
fastify.get('/api/runs', async (request, reply) => {
  try {
    const res = await pool.query(
      `SELECT r.id, r.workflow_id, r.version_id, r.status, r.started_at, r.finished_at, w.name as workflow_name
       FROM runs r
       LEFT JOIN workflows w ON r.workflow_id = w.id
       ORDER BY r.started_at DESC LIMIT 20`
    );
    return reply.send(res.rows);
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch audit log runs', message: err?.message });
  }
});

// 6b. GET /api/runs/pending — Returns pending runs ordered by started_at ASC (limit 5)
fastify.get('/api/runs/pending', async (request, reply) => {
  try {
    const res = await pool.query(
      `SELECT id, workflow_id, version_id, status, started_at FROM runs WHERE status = 'pending' ORDER BY started_at ASC LIMIT 5`
    );
    return reply.send(res.rows);
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch pending runs', message: err?.message });
  }
});

// 6c. POST /api/runs/:id/claim — Atomically claim a pending run job for worker execution
fastify.post('/api/runs/:id/claim', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const res = await pool.query(
      `UPDATE runs SET status = 'claimed' WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id]
    );

    if (res.rows.length === 0) {
      return reply.status(409).send({ error: 'Run already claimed or not pending' });
    }

    const run = res.rows[0];
    broadcastRunUpdate(id, {
      type: 'STATUS_UPDATE',
      runId: id,
      status: 'claimed',
      timestamp: Date.now(),
    });

    return reply.send(run);
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to claim run', message: err?.message });
  }
});

// 7. GET /api/runs/:id — Get run status and step history
fastify.get('/api/runs/:id', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const runRes = await pool.query(`SELECT * FROM runs WHERE id = $1`, [id]);
    if (runRes.rows.length === 0) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    const stepsRes = await pool.query(
      `SELECT * FROM run_steps WHERE run_id = $1 ORDER BY step_index ASC`,
      [id]
    );

    return reply.send({
      run: runRes.rows[0],
      steps: stepsRes.rows,
    });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch run status', message: err?.message });
  }
});

// 8. PATCH /api/runs/:id/status — Internal endpoint to update status & broadcast WS
fastify.patch('/api/runs/:id/status', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { status, finishedAt, error, detail } = (request.body || {}) as { status: string; finishedAt?: string; error?: string; detail?: any };

  try {
    const res = await pool.query(
      `UPDATE runs SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );

    const run = res.rows[0] || { id, status };
    if (detail) {
      run.detail = detail;
      if (typeof detail.stepIndex === 'number') {
        run.current_step_index = detail.stepIndex;
      }
    }
    
    // Broadcast status update
    broadcastRunUpdate(id, {
      type: 'STATUS_UPDATE',
      runId: id,
      status,
      detail,
      error,
      timestamp: Date.now(),
    });

    // Broadcast specific CREDENTIALS_REQUIRED event if awaiting credentials
    if (status === 'awaiting_credentials') {
      broadcastRunUpdate(id, {
        type: 'CREDENTIALS_REQUIRED',
        runId: id,
        status,
        detail,
        timestamp: Date.now(),
      });
    }

    return reply.send({ message: 'Run status updated', run });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to update run status', message: err?.message });
  }
});

// 8b. POST /api/runs/:id/credentials — Submit sensitive credentials in memory
fastify.post('/api/runs/:id/credentials', async (request, reply) => {
  const { id } = request.params as { id: string };
  const { stepIndex, value } = (request.body || {}) as { stepIndex: number; value: string };

  if (value === undefined || value === null) {
    return reply.status(400).send({ error: 'Credential value is required' });
  }

  // Store credential value ONLY in memory
  pendingCredentialsMap.set(id, { stepIndex: stepIndex ?? 0, value });

  // Resume status to running
  await pool.query(`UPDATE runs SET status = 'running' WHERE id = $1`, [id]);

  broadcastRunUpdate(id, {
    type: 'CREDENTIALS_SUBMITTED',
    runId: id,
    status: 'running',
    detail: { stepIndex },
    timestamp: Date.now(),
  });

  return reply.send({ message: 'Credentials accepted' });
});

// 8c. GET /api/runs/:id/credentials — Worker retrieves and clears memory credential
fastify.get('/api/runs/:id/credentials', async (request, reply) => {
  const { id } = request.params as { id: string };
  const cred = pendingCredentialsMap.get(id);

  if (cred) {
    // Delete immediately on retrieval to purge secret from memory
    pendingCredentialsMap.delete(id);
    return reply.send({ found: true, credential: cred });
  }

  return reply.send({ found: false });
});

// 9. POST /api/runs/:id/approve — Resolve a pending approval gate
fastify.post('/api/runs/:id/approve', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const res = await pool.query(
      `UPDATE runs SET status = 'running' WHERE id = $1 RETURNING *`,
      [id]
    );

    const run = res.rows[0];
    broadcastRunUpdate(id, {
      type: 'APPROVAL_GRANTED',
      runId: id,
      status: 'running',
      timestamp: Date.now(),
    });

    return reply.send({ message: 'Approval gate resolved', run });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to approve run', message: err?.message });
  }
});

// 10. POST /api/runs/:id/cancel — Cancel a running or pending run
fastify.post('/api/runs/:id/cancel', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const res = await pool.query(
      `UPDATE runs SET status = 'cancelled', finished_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );

    const run = res.rows[0];
    broadcastRunUpdate(id, {
      type: 'RUN_CANCELLED',
      runId: id,
      status: 'cancelled',
      timestamp: Date.now(),
    });

    return reply.send({ message: 'Run cancelled successfully', run });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to cancel run', message: err?.message });
  }
});

// 10b. POST /api/runs/:id/upload-result — Save uploaded binary file from worker
fastify.post('/api/runs/:id/upload-result', async (request, reply) => {
  const { id } = request.params as { id: string };
  const rawHeaderFilename = request.headers['x-filename'] as string;
  const filename = rawHeaderFilename ? path.basename(rawHeaderFilename) : `download_${id}_${Date.now()}.bin`;
  const fileBuffer = request.body as Buffer;

  if (!Buffer.isBuffer(fileBuffer)) {
    return reply.status(400).send({ error: 'Invalid or missing binary file buffer' });
  }

  const destPath = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(destPath, fileBuffer);
  console.log(`[Backend Upload Endpoint] Saved uploaded result file for run ${id}: ${destPath}`);

  const runRes = await pool.query(`SELECT * FROM runs WHERE id = $1`, [id]);
  const existingRun = runRes.rows[0] || {};
  const detail = existingRun.detail || {};

  detail.downloadedFilePath = destPath;
  detail.downloadFilename = filename;
  detail.downloadUrl = `/api/runs/${id}/download`;
  detail.previewUrl = `/api/runs/${id}/preview`;

  await pool.query(
    `UPDATE runs SET status = status WHERE id = $1 RETURNING *`,
    [id]
  );

  broadcastRunUpdate(id, {
    type: 'STATUS_UPDATE',
    runId: id,
    status: existingRun.status || 'completed',
    detail,
    timestamp: Date.now(),
  });

  return reply.send({ message: 'Result file uploaded successfully', filename, destPath });
});

// 11. GET /api/runs/:id/download — Download resulting report file directly to browser
fastify.get('/api/runs/:id/download', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const res = await pool.query(`SELECT * FROM runs WHERE id = $1`, [id]);
    const run = res.rows[0];
    let filePath = run?.detail?.downloadedFilePath;

    if (!filePath || !fs.existsSync(filePath)) {
      if (run?.detail?.downloadFilename) {
        const potentialUploadPath = path.join(UPLOADS_DIR, run.detail.downloadFilename);
        if (fs.existsSync(potentialUploadPath)) filePath = potentialUploadPath;
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      if (fs.existsSync(UPLOADS_DIR)) {
        const files = fs.readdirSync(UPLOADS_DIR).map((f) => ({
          name: f,
          path: path.join(UPLOADS_DIR, f),
          time: fs.statSync(path.join(UPLOADS_DIR, f)).mtimeMs,
        }));
        files.sort((a, b) => b.time - a.time);
        if (files.length > 0) {
          filePath = files[0].path;
        }
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      const downloadsDir = path.join(process.cwd(), '../worker/downloads');
      if (fs.existsSync(downloadsDir)) {
        const files = fs.readdirSync(downloadsDir).map((f) => ({
          name: f,
          path: path.join(downloadsDir, f),
          time: fs.statSync(path.join(downloadsDir, f)).mtimeMs,
        }));
        files.sort((a, b) => b.time - a.time);
        if (files.length > 0) {
          filePath = files[0].path;
        }
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Downloaded report file not found on disk' });
    }

    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.pdf') contentType = 'application/pdf';
    else if (ext === '.csv') contentType = 'text/csv';
    else if (ext === '.html' || ext === '.htm') contentType = 'text/html; charset=utf-8';

    reply
      .type(contentType)
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(fs.readFileSync(filePath));
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to download report file', message: err?.message });
  }
});

// 12. GET /api/runs/:id/preview — Serve report file inline for browser preview
fastify.get('/api/runs/:id/preview', async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const res = await pool.query(`SELECT * FROM runs WHERE id = $1`, [id]);
    const run = res.rows[0];
    let filePath = run?.detail?.downloadedFilePath;

    if (!filePath || !fs.existsSync(filePath)) {
      if (run?.detail?.downloadFilename) {
        const potentialUploadPath = path.join(UPLOADS_DIR, run.detail.downloadFilename);
        if (fs.existsSync(potentialUploadPath)) filePath = potentialUploadPath;
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      if (fs.existsSync(UPLOADS_DIR)) {
        const files = fs.readdirSync(UPLOADS_DIR).map((f) => ({
          name: f,
          path: path.join(UPLOADS_DIR, f),
          time: fs.statSync(path.join(UPLOADS_DIR, f)).mtimeMs,
        }));
        files.sort((a, b) => b.time - a.time);
        if (files.length > 0) {
          filePath = files[0].path;
        }
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      const downloadsDir = path.join(process.cwd(), '../worker/downloads');
      if (fs.existsSync(downloadsDir)) {
        const files = fs.readdirSync(downloadsDir).map((f) => ({
          name: f,
          path: path.join(downloadsDir, f),
          time: fs.statSync(path.join(downloadsDir, f)).mtimeMs,
        }));
        files.sort((a, b) => b.time - a.time);
        if (files.length > 0) {
          filePath = files[0].path;
        }
      }
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return reply.status(404).send({ error: 'Report preview file not found' });
    }

    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'application/octet-stream';
    if (ext === '.pdf') contentType = 'application/pdf';
    else if (ext === '.csv') contentType = 'text/csv';
    else if (ext === '.txt') contentType = 'text/plain; charset=utf-8';
    else if (ext === '.html' || ext === '.htm') contentType = 'text/html; charset=utf-8';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';

    const filename = path.basename(filePath);
    reply
      .type(contentType)
      .header('Content-Disposition', `inline; filename="${filename}"`)
      .send(fs.readFileSync(filePath));
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to preview report', message: err?.message });
  }
});

// -------------------------------------------------------------
// MOCK SITE ROUTES FOR TEST RUNNER
// -------------------------------------------------------------

fastify.get('/login', async (request, reply) => {
  reply.type('text/html').send(`
    <!DOCTYPE html>
    <html>
      <head><title>TaskForge Test Site - Login</title></head>
      <body style="font-family: sans-serif; padding: 2rem;">
        <h2>Login to TaskForge Test Portal</h2>
        <form action="/login" method="POST" id="login-form">
          <div>
            <label for="username">Username:</label><br/>
            <input type="text" id="username" name="username" required />
          </div>
          <br/>
          <div>
            <label for="password">Password:</label><br/>
            <input type="password" id="password" name="password" required />
          </div>
          <br/>
          <button type="submit" id="login-submit">Login</button>
        </form>
      </body>
    </html>
  `);
});

fastify.post('/login', async (request, reply) => {
  reply.redirect('/reports', 303);
});

fastify.get('/reports', async (request, reply) => {
  reply.type('text/html').send(`
    <!DOCTYPE html>
    <html>
      <head><title>TaskForge Test Site - Reports</title></head>
      <body style="font-family: sans-serif; padding: 2rem;">
        <h2>System Reports</h2>
        <p>Welcome, authenticated user.</p>
        <a href="/download-report" id="download-report-btn" style="display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 4px;">Download Report</a>
      </body>
    </html>
  `);
});

fastify.get('/download-report', async (request, reply) => {
  const csvData = `Date,Employee,Status,Hours
2026-07-28,Alice,Present,8
2026-07-28,Bob,Present,8
2026-07-28,Charlie,Remote,8
`;
  reply
    .header('Content-Type', 'text/csv')
    .header('Content-Disposition', 'attachment; filename="attendance_report.csv"')
    .send(csvData);
});

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Backend service listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
