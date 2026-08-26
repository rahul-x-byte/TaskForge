import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyFormbody from '@fastify/formbody';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, memoryUsers } from './db/index.js';
import { executeWorkflowRun } from './executor.js';
import {
  requireAuth,
  requireAdmin,
  requireUser,
  verifyWorkerSecret,
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
} from './auth.js';
import { UserRole } from '@taskforge/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({
  logger: true,
});

// WebSocket connections map
const wsConnections = new Map<string, Set<any>>();
const memorySchedules = new Map<string, any>();

// In-memory credentials map for temporary execution storage (runId -> { stepIndex, value })
const pendingCredentialsMap = new Map<string, { stepIndex: number; value: string }>();

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

// Helper: Check workflow ownership
async function getWorkflowOwnership(workflowId: string): Promise<{ exists: boolean; userId?: string; workflow?: any }> {
  const res = await pool.query('SELECT * FROM workflows WHERE id = $1', [workflowId]);
  if (res.rows.length === 0) return { exists: false };
  return { exists: true, userId: res.rows[0].user_id, workflow: res.rows[0] };
}

// Helper: Check run ownership via associated workflow
async function getRunOwnership(runId: string): Promise<{ exists: boolean; userId?: string; run?: any; workflowId?: string }> {
  const res = await pool.query(
    `SELECT r.*, w.user_id 
     FROM runs r 
     LEFT JOIN workflows w ON r.workflow_id = w.id 
     WHERE r.id = $1`,
    [runId]
  );
  if (res.rows.length === 0) return { exists: false };
  return { exists: true, userId: res.rows[0].user_id, run: res.rows[0], workflowId: res.rows[0].workflow_id };
}

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
  fastifyApp.get('/ws/runs/:id', { websocket: true }, async (connection, req) => {
    const { id } = req.params as { id: string };
    const socket = (connection as any).socket || connection;

    // Verify token from query parameter ?token=xxx or auth header
    const urlObj = new URL(req.raw.url || '', 'http://localhost');
    const tokenQuery = urlObj.searchParams.get('token');
    const authHeader = req.headers.authorization;
    const token = tokenQuery || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null);

    if (!token) {
      socket.send(JSON.stringify({ type: 'ERROR', error: 'Unauthorized WebSocket connection' }));
      socket.close(4001, 'Unauthorized');
      return;
    }

    const payload = verifyToken(token);
    if (!payload) {
      socket.send(JSON.stringify({ type: 'ERROR', error: 'Invalid WebSocket auth token' }));
      socket.close(4001, 'Unauthorized');
      return;
    }

    // Verify run ownership if user is not admin
    if (payload.role !== 'admin') {
      const ownership = await getRunOwnership(id);
      if (ownership.exists && ownership.userId && ownership.userId !== payload.id) {
        socket.send(JSON.stringify({ type: 'ERROR', error: 'Forbidden: You do not own this run' }));
        socket.close(4003, 'Forbidden');
        return;
      }
    }

    fastify.log.info(`WebSocket client connected for run ${id} (User: ${payload.email}, Role: ${payload.role})`);

    if (!wsConnections.has(id)) {
      wsConnections.set(id, new Set());
    }
    wsConnections.get(id)!.add(socket);

    socket.send(
      JSON.stringify({
        type: 'STATUS_UPDATE',
        runId: id,
        status: 'connected',
        timestamp: Date.now(),
      })
    );

    socket.on('close', () => {
      wsConnections.get(id)?.delete(socket);
    });

    socket.on('message', (message: Buffer) => {
      fastify.log.info(`Received message on run ${id}: ${message.toString()}`);
    });
  });
});

// -------------------------------------------------------------
// AUTHENTICATION API ENDPOINTS
// -------------------------------------------------------------

// POST /api/auth/register — Public User Registration (ALWAYS creates role = 'user')
fastify.post('/api/auth/register', async (request, reply) => {
  const { name, email, password } = (request.body || {}) as { name?: string; email?: string; password?: string };

  if (!name || !email || !password) {
    return reply.status(400).send({ error: 'Name, email, and password are required' });
  }

  if (password.length < 4) {
    return reply.status(400).send({ error: 'Password must be at least 4 characters long' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows && existing.rows.length > 0) {
      return reply.status(409).send({ error: 'An account with this email address already exists' });
    }

    const userId = uuidv4();
    const passwordHash = await hashPassword(password);

    // SECURITY: ALWAYS force role = 'user' on public registration (never trust role from body)
    const role: UserRole = 'user';

    await pool.query(
      'INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
      [userId, name, normalizedEmail, passwordHash, role]
    );

    const safeUser = {
      id: userId,
      name,
      email: normalizedEmail,
      role,
      created_at: new Date().toISOString(),
    };

    const token = generateToken(safeUser);
    return reply.status(201).send({
      message: 'Registration successful',
      token,
      user: safeUser,
    });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Registration failed', message: err?.message });
  }
});

// POST /api/auth/login — User & Admin Login
fastify.post('/api/auth/login', async (request, reply) => {
  const { email, password } = (request.body || {}) as { email?: string; password?: string };

  if (!email || !password) {
    return reply.status(400).send({ error: 'Email and password are required' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const res = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
    if (!res.rows || res.rows.length === 0) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const user = res.rows[0];
    const passwordValid = await comparePassword(password, user.password_hash);
    if (!passwordValid) {
      return reply.status(401).send({ error: 'Invalid email or password' });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role as UserRole,
      created_at: user.created_at,
    };

    const token = generateToken(safeUser);
    return reply.send({
      message: 'Login successful',
      token,
      user: safeUser,
    });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Login failed', message: err?.message });
  }
});

// GET /api/auth/me — Current User Identity
fastify.get('/api/auth/me', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  try {
    const res = await pool.query('SELECT id, name, email, role, created_at FROM users WHERE id = $1', [reqUser.id]);
    if (res.rows && res.rows.length > 0) {
      return reply.send({ user: res.rows[0] });
    }
    return reply.send({ user: reqUser });
  } catch (err: any) {
    return reply.send({ user: reqUser });
  }
});

// POST /api/auth/logout
fastify.post('/api/auth/logout', async (request, reply) => {
  return reply.send({ message: 'Logged out successfully' });
});

// -------------------------------------------------------------
// ADMIN MANAGEMENT API ENDPOINTS (requireAuth + requireAdmin)
// -------------------------------------------------------------

// GET /api/admin/users — List all registered users with workflow and run counts
fastify.get('/api/admin/users', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
  try {
    const res = await pool.query('SELECT id, name, email, role, created_at, updated_at FROM users ORDER BY created_at DESC');
    return reply.send(res.rows);
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch users', message: err?.message });
  }
});

// GET /api/admin/users/:id — Get user details
fastify.get('/api/admin/users/:id', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
  const { id } = request.params as { id: string };
  try {
    const res = await pool.query('SELECT id, name, email, role, created_at, updated_at FROM users WHERE id = $1', [id]);
    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }
    return reply.send(res.rows[0]);
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch user', message: err?.message });
  }
});

// POST /api/admin/users — Admin creates a new user or admin account
fastify.post('/api/admin/users', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
  const { name, email, password, role } = (request.body || {}) as { name?: string; email?: string; password?: string; role?: UserRole };

  if (!name || !email || !password) {
    return reply.status(400).send({ error: 'Name, email, and password are required' });
  }

  const assignedRole: UserRole = role === 'admin' ? 'admin' : 'user';
  const normalizedEmail = email.toLowerCase().trim();

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows && existing.rows.length > 0) {
      return reply.status(409).send({ error: 'An account with this email address already exists' });
    }

    const userId = uuidv4();
    const passwordHash = await hashPassword(password);

    await pool.query(
      'INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
      [userId, name, normalizedEmail, passwordHash, assignedRole]
    );

    const newUser = {
      id: userId,
      name,
      email: normalizedEmail,
      role: assignedRole,
      created_at: new Date().toISOString(),
    };

    return reply.status(201).send({ message: 'User created successfully', user: newUser });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to create user', message: err?.message });
  }
});

// PUT /api/admin/users/:id — Admin updates user profile / role
fastify.put('/api/admin/users/:id', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const { name, email, role } = (request.body || {}) as { name?: string; email?: string; role?: UserRole };

  try {
    const targetUserRes = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (targetUserRes.rows.length === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const targetUser = targetUserRes.rows[0];

    // Prevent demoting last admin
    if (targetUser.role === 'admin' && role === 'user') {
      const adminCountRes = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
      const count = Number(adminCountRes.rows[0]?.count || 1);
      if (count <= 1) {
        return reply.status(400).send({ error: 'Cannot demote the last remaining admin account' });
      }
    }

    const updatedName = name || targetUser.name;
    const updatedEmail = email ? email.toLowerCase().trim() : targetUser.email;
    const updatedRole = role || targetUser.role;

    await pool.query('UPDATE users SET name = $1, email = $2, role = $3, updated_at = NOW() WHERE id = $4', [
      updatedName,
      updatedEmail,
      updatedRole,
      id,
    ]);

    return reply.send({
      message: 'User updated successfully',
      user: { id, name: updatedName, email: updatedEmail, role: updatedRole },
    });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to update user', message: err?.message });
  }
});

// PUT /api/admin/users/:id/role — Admin changes a user's role
fastify.put('/api/admin/users/:id/role', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const { role } = (request.body || {}) as { role?: UserRole };

  if (role !== 'admin' && role !== 'user') {
    return reply.status(400).send({ error: "Invalid role. Role must be 'admin' or 'user'" });
  }

  try {
    const targetUserRes = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (targetUserRes.rows.length === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const targetUser = targetUserRes.rows[0];

    // Prevent demoting last admin
    if (targetUser.role === 'admin' && role === 'user') {
      const adminCountRes = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
      const count = Number(adminCountRes.rows[0]?.count || 1);
      if (count <= 1) {
        return reply.status(400).send({ error: 'Cannot demote the last remaining admin account' });
      }
    }

    await pool.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, id]);

    return reply.send({
      message: `User role updated to ${role} successfully`,
      user: { id, email: targetUser.email, role },
    });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to update user role', message: err?.message });
  }
});

// DELETE /api/admin/users/:id — Admin deletes a user account
fastify.delete('/api/admin/users/:id', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
  const { id } = request.params as { id: string };

  try {
    const targetUserRes = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (targetUserRes.rows.length === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const targetUser = targetUserRes.rows[0];

    // Prevent deleting last admin
    if (targetUser.role === 'admin') {
      const adminCountRes = await pool.query("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
      const count = Number(adminCountRes.rows[0]?.count || 1);
      if (count <= 1) {
        return reply.status(400).send({ error: 'Cannot delete the last remaining admin account' });
      }
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    return reply.send({ message: 'User account deleted successfully' });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to delete user', message: err?.message });
  }
});

// GET /api/admin/workflows — View all workflows across all users
fastify.get('/api/admin/workflows', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
  try {
    const res = await pool.query(
      `SELECT w.id, w.name, w.user_id, w.created_at, w.current_version_id, wv.steps, u.name as user_name, u.email as user_email
       FROM workflows w
       LEFT JOIN workflow_versions wv ON w.current_version_id = wv.id
       LEFT JOIN users u ON w.user_id = u.id
       ORDER BY w.created_at DESC`
    );
    return reply.send(res.rows);
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch admin workflows', message: err?.message });
  }
});

// GET /api/admin/runs — View all runs across all users
fastify.get('/api/admin/runs', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
  try {
    const res = await pool.query(
      `SELECT r.id, r.workflow_id, r.version_id, r.status, r.started_at, r.finished_at, w.name as workflow_name, w.user_id, u.name as user_name, u.email as user_email
       FROM runs r
       LEFT JOIN workflows w ON r.workflow_id = w.id
       LEFT JOIN users u ON w.user_id = u.id
       ORDER BY r.started_at DESC LIMIT 50`
    );
    return reply.send(res.rows);
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch admin runs', message: err?.message });
  }
});

// GET /api/admin/stats — System level statistics
fastify.get('/api/admin/stats', { preHandler: [requireAuth, requireAdmin] }, async (request, reply) => {
  try {
    const usersRes = await pool.query('SELECT role FROM users');
    const workflowsRes = await pool.query('SELECT id FROM workflows');
    const runsRes = await pool.query('SELECT status FROM runs');

    const users = usersRes.rows || [];
    const totalUsers = users.length;
    const totalAdmins = users.filter((u) => u.role === 'admin').length;
    const totalNormalUsers = users.filter((u) => u.role === 'user').length;

    const totalWorkflows = (workflowsRes.rows || []).length;

    const runs = runsRes.rows || [];
    const totalRuns = runs.length;
    const successfulRuns = runs.filter((r) => r.status === 'completed' || r.status === 'success').length;
    const failedRuns = runs.filter((r) => r.status === 'failed' || r.status === 'timed_out').length;
    const currentlyRunning = runs.filter((r) => r.status === 'running' || r.status === 'pending' || r.status === 'claimed').length;

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
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch admin stats', message: err?.message });
  }
});

// -------------------------------------------------------------
// WORKFLOW & RECORDING ENDPOINTS (Ownership-Scoped)
// -------------------------------------------------------------

// POST /api/recordings & POST /recordings — Create workflow for authenticated user
const handleCreateRecording = async (request: any, reply: any) => {
  const reqUser = request.user!;
  const body = request.body as { name?: string; steps: any[] } | any[];
  const steps = Array.isArray(body) ? body : body?.steps || [];
  const name = (!Array.isArray(body) && body?.name) ? body.name : `Recorded Workflow ${new Date().toLocaleDateString()}`;

  const workflowId = uuidv4();
  const versionId = uuidv4();

  // SECURITY: Always link created workflow to authenticated request.user.id
  const userId = reqUser.id;

  try {
    await pool.query(
      `INSERT INTO workflows (id, name, user_id, created_at) VALUES ($1, $2, $3, NOW())`,
      [workflowId, name, userId]
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
      userId,
    });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to save recorded workflow', message: err?.message });
  }
};

fastify.post('/api/recordings', { preHandler: requireAuth }, handleCreateRecording);
fastify.post('/recordings', { preHandler: requireAuth }, handleCreateRecording);

// POST /api/workflows/from-template — Create workflow from template for authenticated user
fastify.post('/api/workflows/from-template', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
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
  const userId = reqUser.id;

  try {
    await pool.query(
      `INSERT INTO workflows (id, name, user_id, created_at) VALUES ($1, $2, $3, NOW())`,
      [workflowId, name, userId]
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
      userId,
    });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to create workflow from template', message: err?.message });
  }
});

// GET /api/workflows — List workflows (Admin sees all, Normal User sees ONLY own)
fastify.get('/api/workflows', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  try {
    const res = reqUser.role === 'admin'
      ? await pool.query(
          `SELECT w.id, w.name, w.user_id, w.created_at, w.current_version_id, wv.steps
           FROM workflows w
           LEFT JOIN workflow_versions wv ON w.current_version_id = wv.id
           ORDER BY w.created_at DESC`
        )
      : await pool.query(
          `SELECT w.id, w.name, w.user_id, w.created_at, w.current_version_id, wv.steps
           FROM workflows w
           LEFT JOIN workflow_versions wv ON w.current_version_id = wv.id
           WHERE w.user_id = $1
           ORDER BY w.created_at DESC`,
          [reqUser.id]
        );

    const list = res.rows.map((wf) => {
      let parsedSteps = wf.steps;
      if (typeof parsedSteps === 'string') {
        try {
          parsedSteps = JSON.parse(parsedSteps);
        } catch (e) {
          parsedSteps = [];
        }
      }
      return {
        ...wf,
        steps: Array.isArray(parsedSteps) ? parsedSteps : [],
        schedule: memorySchedules.get(wf.id) || null,
        lastStatus: wf.lastStatus || wf.last_status || 'never_run',
      };
    });
    return reply.send(list);
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch workflows', message: err?.message });
  }
});

// GET /api/workflows/:id — Get single workflow (Ownership Enforced)
fastify.get('/api/workflows/:id', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  const { id } = request.params as { id: string };

  try {
    const res = reqUser.role === 'admin'
      ? await pool.query(
          `SELECT w.id, w.name, w.user_id, w.created_at, w.current_version_id, wv.steps
           FROM workflows w
           LEFT JOIN workflow_versions wv ON w.current_version_id = wv.id
           WHERE w.id = $1`,
          [id]
        )
      : await pool.query(
          `SELECT w.id, w.name, w.user_id, w.created_at, w.current_version_id, wv.steps
           FROM workflows w
           LEFT JOIN workflow_versions wv ON w.current_version_id = wv.id
           WHERE w.id = $1 AND w.user_id = $2`,
          [id, reqUser.id]
        );

    if (res.rows.length === 0) {
      return reply.status(404).send({ error: 'Workflow not found or access forbidden' });
    }

    const item = res.rows[0];
    if (typeof item.steps === 'string') {
      try {
        item.steps = JSON.parse(item.steps);
      } catch (e) {
        item.steps = [];
      }
    }
    item.schedule = memorySchedules.get(id) || null;
    return reply.send(item);
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch workflow', message: err?.message });
  }
});

// PUT /api/workflows/:id/steps — Update workflow steps (Ownership Enforced)
fastify.put('/api/workflows/:id/steps', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  const { id } = request.params as { id: string };
  const { steps } = (request.body || {}) as { steps: any[] };

  if (!Array.isArray(steps)) {
    return reply.status(400).send({ error: 'steps must be an array' });
  }

  try {
    const ownership = await getWorkflowOwnership(id);
    if (!ownership.exists) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    if (reqUser.role !== 'admin' && ownership.userId !== reqUser.id) {
      return reply.status(403).send({ error: 'Forbidden: You do not own this workflow' });
    }

    const wfRes = await pool.query(`SELECT id, current_version_id FROM workflows WHERE id = $1`, [id]);
    const versionId = wfRes.rows[0]?.current_version_id;

    if (!versionId) {
      return reply.status(400).send({ error: 'Workflow has no active version' });
    }

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

// DELETE /api/workflows/:id — Delete workflow (Ownership Enforced + Cascade Delete)
fastify.delete('/api/workflows/:id', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  const { id } = request.params as { id: string };

  try {
    const ownership = await getWorkflowOwnership(id);
    if (!ownership.exists) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    if (reqUser.role !== 'admin' && ownership.userId !== reqUser.id) {
      return reply.status(403).send({ error: 'Forbidden: You do not own this workflow' });
    }

    // CASCADE delete workflow
    await pool.query('DELETE FROM workflows WHERE id = $1', [id]);
    memorySchedules.delete(id);

    return reply.send({ message: 'Workflow and associated history deleted successfully', workflowId: id });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to delete workflow', message: err?.message });
  }
});

// POST /api/workflows/:id/run — Enqueue workflow run (Ownership Enforced)
fastify.post('/api/workflows/:id/run', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  const { id } = request.params as { id: string };

  try {
    const ownership = await getWorkflowOwnership(id);
    if (!ownership.exists) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    if (reqUser.role !== 'admin' && ownership.userId !== reqUser.id) {
      return reply.status(403).send({ error: 'Forbidden: You do not own this workflow' });
    }

    const workflow = ownership.workflow!;
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

    // Allow Chrome extension 8 seconds to claim pending run for desktop tab execution; fallback to cloud server worker if unclaimed
    setTimeout(() => {
      pool.query(`SELECT status FROM runs WHERE id = $1`, [runId]).then((checkRes) => {
        if (checkRes.rows[0]?.status === 'pending') {
          console.log(`[Backend Run Engine] Run ${runId} unclaimed by extension after 8s. Executing cloud fallback worker...`);
          executeWorkflowRun(id, versionId, runId).catch((err: any) => {
            console.error('[Cloud Worker Fallback Error]', err);
          });
        }
      }).catch(() => {});
    }, 8000);

    return reply.status(202).send({
      message: 'Workflow run enqueued and started',
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

// POST /api/workflows/:id/schedule — Set recurring schedule (Ownership Enforced)
fastify.post('/api/workflows/:id/schedule', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  const { id } = request.params as { id: string };
  const { frequency, time, cron } = (request.body || {}) as { frequency: string; time?: string; cron?: string };

  try {
    const ownership = await getWorkflowOwnership(id);
    if (!ownership.exists) {
      return reply.status(404).send({ error: 'Workflow not found' });
    }

    if (reqUser.role !== 'admin' && ownership.userId !== reqUser.id) {
      return reply.status(403).send({ error: 'Forbidden: You do not own this workflow' });
    }

    const scheduleConfig = {
      workflowId: id,
      userId: ownership.userId,
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
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to schedule workflow', message: err?.message });
  }
});

// -------------------------------------------------------------
// RUN AUTHORIZATION & AUDIT ENDPOINTS
// -------------------------------------------------------------

// GET /api/runs — Audit log listing runs (Ownership Filtered)
fastify.get('/api/runs', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  try {
    const res = reqUser.role === 'admin'
      ? await pool.query(
          `SELECT r.id, r.workflow_id, r.version_id, r.status, r.started_at, r.finished_at, w.name as workflow_name, w.user_id
           FROM runs r
           LEFT JOIN workflows w ON r.workflow_id = w.id
           ORDER BY r.started_at DESC LIMIT 50`
        )
      : await pool.query(
          `SELECT r.id, r.workflow_id, r.version_id, r.status, r.started_at, r.finished_at, w.name as workflow_name, w.user_id
           FROM runs r
           LEFT JOIN workflows w ON r.workflow_id = w.id
           WHERE w.user_id = $1
           ORDER BY r.started_at DESC LIMIT 50`,
          [reqUser.id]
        );
    return reply.send(res.rows);
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch audit log runs', message: err?.message });
  }
});

// GET /api/runs/:id — Get run status (Ownership Enforced)
fastify.get('/api/runs/:id', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  const { id } = request.params as { id: string };

  try {
    const ownership = await getRunOwnership(id);
    if (!ownership.exists) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    if (reqUser.role !== 'admin' && ownership.userId !== reqUser.id) {
      return reply.status(403).send({ error: 'Forbidden: You do not own this run' });
    }

    const stepsRes = await pool.query(
      `SELECT * FROM run_steps WHERE run_id = $1 ORDER BY step_index ASC`,
      [id]
    );

    return reply.send({
      run: ownership.run,
      steps: stepsRes.rows,
    });
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to fetch run status', message: err?.message });
  }
});

// POST /api/runs/:id/credentials — Submit sensitive credentials (In-Memory, Ownership Enforced)
fastify.post('/api/runs/:id/credentials', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  const { id } = request.params as { id: string };
  const { stepIndex, value } = (request.body || {}) as { stepIndex: number; value: string };

  if (value === undefined || value === null) {
    return reply.status(400).send({ error: 'Credential value is required' });
  }

  try {
    const ownership = await getRunOwnership(id);
    if (!ownership.exists) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    if (reqUser.role !== 'admin' && ownership.userId !== reqUser.id) {
      return reply.status(403).send({ error: 'Forbidden: You do not own this run' });
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
  } catch (err: any) {
    fastify.log.error(err);
    return reply.status(500).send({ error: 'Failed to accept credentials', message: err?.message });
  }
});

// POST /api/runs/:id/approve — Resolve pending approval gate (Ownership Enforced)
fastify.post('/api/runs/:id/approve', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  const { id } = request.params as { id: string };

  try {
    const ownership = await getRunOwnership(id);
    if (!ownership.exists) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    if (reqUser.role !== 'admin' && ownership.userId !== reqUser.id) {
      return reply.status(403).send({ error: 'Forbidden: You do not own this run' });
    }

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

// POST /api/runs/:id/cancel — Cancel running or pending run (Ownership Enforced)
fastify.post('/api/runs/:id/cancel', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  const { id } = request.params as { id: string };

  try {
    const ownership = await getRunOwnership(id);
    if (!ownership.exists) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    if (reqUser.role !== 'admin' && ownership.userId !== reqUser.id) {
      return reply.status(403).send({ error: 'Forbidden: You do not own this run' });
    }

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

// GET /api/runs/:id/download — Download result file (Ownership Enforced)
fastify.get('/api/runs/:id/download', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  const { id } = request.params as { id: string };

  try {
    const ownership = await getRunOwnership(id);
    if (!ownership.exists) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    if (reqUser.role !== 'admin' && ownership.userId !== reqUser.id) {
      return reply.status(403).send({ error: 'Forbidden: You do not own this file' });
    }

    const run = ownership.run;
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

// GET /api/runs/:id/preview — Preview report file inline (Ownership Enforced)
fastify.get('/api/runs/:id/preview', { preHandler: requireAuth }, async (request, reply) => {
  const reqUser = request.user!;
  const { id } = request.params as { id: string };

  try {
    const ownership = await getRunOwnership(id);
    if (!ownership.exists) {
      return reply.status(404).send({ error: 'Run not found' });
    }

    if (reqUser.role !== 'admin' && ownership.userId !== reqUser.id) {
      return reply.status(403).send({ error: 'Forbidden: You do not own this file' });
    }

    const run = ownership.run;
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
// WORKER ENDPOINTS (Protected via verifyWorkerSecret)
// -------------------------------------------------------------

// GET /api/runs/pending — Returns pending runs ordered by started_at ASC
fastify.get('/api/runs/pending', { preHandler: verifyWorkerSecret }, async (request, reply) => {
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

// POST /api/runs/:id/claim — Atomically claim pending run job for worker execution
fastify.post('/api/runs/:id/claim', { preHandler: verifyWorkerSecret }, async (request, reply) => {
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

// GET /api/runs/:id/credentials — Worker retrieves and clears memory credential
fastify.get('/api/runs/:id/credentials', { preHandler: verifyWorkerSecret }, async (request, reply) => {
  const { id } = request.params as { id: string };
  const cred = pendingCredentialsMap.get(id);

  if (cred) {
    pendingCredentialsMap.delete(id);
    return reply.send({ found: true, credential: cred });
  }

  return reply.send({ found: false });
});

// PATCH /api/runs/:id/status — Internal endpoint to update status & broadcast WS
fastify.patch('/api/runs/:id/status', { preHandler: verifyWorkerSecret }, async (request, reply) => {
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

// POST /api/runs/:id/upload-result — Save uploaded binary file from worker
fastify.post('/api/runs/:id/upload-result', { preHandler: verifyWorkerSecret }, async (request, reply) => {
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
