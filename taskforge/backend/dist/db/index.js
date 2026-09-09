// Database Manager with Postgres & Memory Fallback Engine
import pg from 'pg';
import bcrypt from 'bcryptjs';
export const isProduction = process.env.NODE_ENV === 'production';
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0);
export const memoryUsers = new Map();
export const memoryWorkflows = new Map();
export const memoryVersions = new Map();
export const memoryRuns = new Map();
export const memoryRunSteps = new Map();
const defaultAdminId = 'u-admin-seed-001';
const defaultUserId = 'u-user-seed-002';
// Only seed memory users in development/offline test mode
if (!isProduction && !hasDatabaseUrl) {
    const adminPasswordHash = bcrypt.hashSync('admin123', 10);
    const userPasswordHash = bcrypt.hashSync('user123', 10);
    const defaultAdminUser = {
        id: defaultAdminId,
        name: 'TaskForge Admin',
        email: 'admin@example.com',
        password_hash: adminPasswordHash,
        role: 'admin',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    const defaultNormalUser = {
        id: defaultUserId,
        name: 'Default User',
        email: 'user@example.com',
        password_hash: userPasswordHash,
        role: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    memoryUsers.set(defaultAdminId, defaultAdminUser);
    memoryUsers.set('admin@example.com', defaultAdminUser);
    memoryUsers.set(defaultUserId, defaultNormalUser);
    memoryUsers.set('user@example.com', defaultNormalUser);
    // Pre-populate initial sample workflow ONLY in development offline mode
    const initialWfId = 'sample-automated-download-workflow';
    const initialVerId = 'sample-automated-download-version';
    const initialSteps = [
        {
            action: 'navigate',
            timestamp: Date.now(),
            selectors: { css: 'window' },
            value: 'http://localhost:3001/login',
            pageUrl: 'http://localhost:3001/login',
        },
        {
            action: 'input',
            timestamp: Date.now() + 1000,
            selectors: { css: 'input[name="username"]' },
            value: 'admin',
            pageUrl: 'http://localhost:3001/login',
        },
        {
            action: 'click',
            timestamp: Date.now() + 2000,
            selectors: { css: 'button[type="submit"]' },
            pageUrl: 'http://localhost:3001/login',
            isSensitive: true,
        },
    ];
    memoryWorkflows.set(initialWfId, {
        id: initialWfId,
        name: 'Automated Sample Report Download',
        user_id: defaultUserId,
        created_at: new Date().toISOString(),
        current_version_id: initialVerId,
    });
    memoryVersions.set(initialVerId, {
        id: initialVerId,
        workflow_id: initialWfId,
        steps: initialSteps,
        created_at: new Date().toISOString(),
    });
}
// PostgreSQL Pool Connection (Single source of truth in production)
let pgPool = null;
if (hasDatabaseUrl) {
    const connStr = process.env.DATABASE_URL.trim();
    const isLocal = connStr.includes('localhost') || connStr.includes('127.0.0.1');
    pgPool = new pg.Pool({
        connectionString: connStr,
        ssl: isLocal ? false : { rejectUnauthorized: false },
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
    });
    pgPool.on('error', (err) => {
        console.error('[PostgreSQL Pool Unexpected Error]', err);
    });
    console.log('[Database] PostgreSQL/Supabase mode configured');
}
else {
    if (isProduction) {
        console.error('[FATAL CONFIGURATION ERROR] DATABASE_URL is missing in production mode (NODE_ENV=production). In-memory engine fallback is strictly disabled in production.');
    }
    else {
        console.log('[Database] Development memory mode (PostgreSQL unconfigured)');
    }
}
export function isDatabaseConfigured() {
    return Boolean(pgPool);
}
export async function testDatabaseConnection() {
    if (!pgPool) {
        return {
            connected: false,
            error: isProduction ? 'DATABASE_URL is missing in production' : 'PostgreSQL not configured (running in development memory mode)',
            mode: isProduction ? 'production-unconfigured' : 'memory-mode',
        };
    }
    try {
        const client = await pgPool.connect();
        try {
            await client.query('SELECT 1');
            return { connected: true, mode: 'postgresql' };
        }
        finally {
            client.release();
        }
    }
    catch (err) {
        console.error('[PostgreSQL Health Check Failed]', err?.message || err);
        return {
            connected: false,
            error: err?.message || String(err),
            mode: 'postgresql-error',
        };
    }
}
export async function query(text, params = []) {
    if (isProduction && !pgPool) {
        throw new Error('[Database Unavailable] DATABASE_URL is required in production mode. In-memory engine fallback is strictly disabled.');
    }
    if (pgPool) {
        // In production or when PostgreSQL is configured, throw query errors directly.
        // NEVER silently fall back to the in-memory engine!
        try {
            const res = await pgPool.query(text, params);
            return res;
        }
        catch (pgErr) {
            console.error('[PostgreSQL Query Error]', pgErr);
            throw pgErr;
        }
    }
    const normalizedSql = text.trim().toLowerCase();
    // --- PROFILES / USERS TABLE QUERIES ---
    // 1. INSERT INTO profiles / users
    if (normalizedSql.startsWith('insert into profiles') || normalizedSql.startsWith('insert into users')) {
        const id = params[0];
        const name = params[1];
        const email = params[2];
        const role = params[3] || 'user';
        const item = {
            id,
            name,
            email: (email || '').toLowerCase(),
            role,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        };
        memoryUsers.set(id, item);
        if (email)
            memoryUsers.set(email.toLowerCase(), item);
        return { rows: [item] };
    }
    // 2. SELECT FROM profiles / users WHERE email = $1
    if ((normalizedSql.includes('from profiles') || normalizedSql.includes('from users')) && normalizedSql.includes('where email =')) {
        const emailVal = (params[0] || '').toLowerCase();
        const user = memoryUsers.get(emailVal) || Array.from(memoryUsers.values()).find((u) => u.email === emailVal);
        return { rows: user ? [user] : [] };
    }
    // 3. SELECT FROM profiles / users WHERE id = $1
    if ((normalizedSql.includes('from profiles') || normalizedSql.includes('from users')) && (normalizedSql.includes('where id =') || normalizedSql.includes('where p.id ='))) {
        const idVal = params[0];
        const user = memoryUsers.get(idVal) || Array.from(memoryUsers.values()).find((u) => u.id === idVal);
        return { rows: user ? [user] : [] };
    }
    // 4. SELECT FROM profiles / users (list all profiles with workflow count & run count)
    if (normalizedSql.includes('from profiles') || normalizedSql.includes('from users')) {
        const uniqueUsers = Array.from(new Set(Array.from(memoryUsers.values())));
        const list = uniqueUsers.map((u) => {
            const userWorkflows = Array.from(memoryWorkflows.values()).filter((w) => w.user_id === u.id);
            const userWfIds = new Set(userWorkflows.map((w) => w.id));
            const userRuns = Array.from(memoryRuns.values()).filter((r) => userWfIds.has(r.workflow_id));
            return {
                ...u,
                workflow_count: userWorkflows.length,
                run_count: userRuns.length,
            };
        });
        return { rows: list };
    }
    // 5. UPDATE profiles / users SET role
    if (normalizedSql.startsWith('update profiles set role') || normalizedSql.startsWith('update users set role')) {
        const [roleVal, idVal] = params;
        const user = memoryUsers.get(idVal) || Array.from(memoryUsers.values()).find((u) => u.id === idVal);
        if (user) {
            user.role = roleVal;
            user.updated_at = new Date().toISOString();
            memoryUsers.set(idVal, user);
            if (user.email)
                memoryUsers.set(user.email.toLowerCase(), user);
            return { rows: [user] };
        }
        return { rows: [] };
    }
    // 6. UPDATE profiles / users
    if (normalizedSql.startsWith('update profiles set') || normalizedSql.startsWith('update users set')) {
        const [nameVal, emailVal, roleVal, idVal] = params;
        const targetId = idVal || params[params.length - 1];
        const user = memoryUsers.get(targetId) || Array.from(memoryUsers.values()).find((u) => u.id === targetId);
        if (user) {
            user.name = nameVal || user.name;
            if (emailVal)
                user.email = emailVal.toLowerCase();
            if (roleVal)
                user.role = roleVal;
            user.updated_at = new Date().toISOString();
            memoryUsers.set(targetId, user);
            return { rows: [user] };
        }
        return { rows: [] };
    }
    // 7. DELETE FROM profiles / users WHERE id = $1
    if (normalizedSql.startsWith('delete from profiles') || normalizedSql.startsWith('delete from users')) {
        const idVal = params[0];
        const user = memoryUsers.get(idVal) || Array.from(memoryUsers.values()).find((u) => u.id === idVal);
        if (user) {
            memoryUsers.delete(idVal);
            if (user.email)
                memoryUsers.delete(user.email.toLowerCase());
            // Cascade delete user workflows and runs
            const userWfs = Array.from(memoryWorkflows.values()).filter((w) => w.user_id === idVal);
            userWfs.forEach((w) => {
                memoryWorkflows.delete(w.id);
                const wRuns = Array.from(memoryRuns.values()).filter((r) => r.workflow_id === w.id);
                wRuns.forEach((r) => memoryRuns.delete(r.id));
            });
            return { rows: [user] };
        }
        return { rows: [] };
    }
    // --- WORKFLOWS TABLE QUERIES ---
    // 8. INSERT INTO workflows
    if (normalizedSql.startsWith('insert into workflows')) {
        const id = params[0];
        const name = params[1];
        const userId = params[2] || defaultUserId;
        const item = { id, name, user_id: userId, created_at: new Date().toISOString(), current_version_id: null };
        memoryWorkflows.set(id, item);
        return { rows: [item] };
    }
    // 9. INSERT INTO workflow_versions
    if (normalizedSql.startsWith('insert into workflow_versions')) {
        const [id, workflow_id, steps] = params;
        const stepsArr = typeof steps === 'string' ? JSON.parse(steps) : steps;
        const item = { id, workflow_id, steps: stepsArr, created_at: new Date().toISOString() };
        memoryVersions.set(id, item);
        return { rows: [item] };
    }
    // 9b. UPDATE workflows SET name
    if (normalizedSql.startsWith('update workflows set name')) {
        const [nameVal, workflowId] = params;
        const wf = memoryWorkflows.get(workflowId);
        if (wf) {
            wf.name = nameVal;
            memoryWorkflows.set(workflowId, wf);
        }
        return { rows: wf ? [wf] : [] };
    }
    // 10. UPDATE workflows SET current_version_id
    if (normalizedSql.startsWith('update workflows set current_version_id')) {
        const [versionId, workflowId] = params;
        const wf = memoryWorkflows.get(workflowId);
        if (wf) {
            wf.current_version_id = versionId;
            memoryWorkflows.set(workflowId, wf);
        }
        return { rows: wf ? [wf] : [] };
    }
    // 11. UPDATE workflow_versions SET steps
    if (normalizedSql.startsWith('update workflow_versions set steps')) {
        const [steps, versionId] = params;
        const stepsArr = typeof steps === 'string' ? JSON.parse(steps) : steps;
        const ver = memoryVersions.get(versionId);
        if (ver) {
            ver.steps = stepsArr;
            memoryVersions.set(versionId, ver);
        }
        return { rows: ver ? [ver] : [] };
    }
    // 12. DELETE FROM workflows
    if (normalizedSql.startsWith('delete from workflows')) {
        const idVal = params[0];
        const userIdFilter = params[1];
        const wf = memoryWorkflows.get(idVal);
        if (wf) {
            if (userIdFilter && wf.user_id !== userIdFilter) {
                return { rows: [] };
            }
            memoryWorkflows.delete(idVal);
            // Cascade delete versions & runs
            const versions = Array.from(memoryVersions.values()).filter((v) => v.workflow_id === idVal);
            versions.forEach((v) => memoryVersions.delete(v.id));
            const runs = Array.from(memoryRuns.values()).filter((r) => r.workflow_id === idVal);
            runs.forEach((r) => memoryRuns.delete(r.id));
            return { rows: [wf] };
        }
        return { rows: [] };
    }
    // 13. SELECT FROM workflows
    if (normalizedSql.includes('from workflows')) {
        let list = Array.from(memoryWorkflows.values());
        if (normalizedSql.includes('where w.id =') || normalizedSql.includes('where id =')) {
            const idParam = params[0];
            const userIdParam = params[1];
            list = list.filter((w) => w.id === idParam);
            if (userIdParam) {
                list = list.filter((w) => w.user_id === userIdParam);
            }
        }
        else if (normalizedSql.includes('where w.user_id =') || normalizedSql.includes('where user_id =')) {
            const userIdParam = params[0];
            list = list.filter((w) => w.user_id === userIdParam);
        }
        const mappedList = list.map((wf) => {
            const ver = memoryVersions.get(wf.current_version_id);
            const wfRuns = Array.from(memoryRuns.values()).filter((r) => r.workflow_id === wf.id);
            let lastStatus = 'never_run';
            let latestRunId = null;
            if (wfRuns.length > 0) {
                wfRuns.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
                latestRunId = wfRuns[0].id;
                const latestStatus = wfRuns[0].status;
                if (latestStatus === 'completed' || latestStatus === 'success')
                    lastStatus = 'success';
                else if (latestStatus === 'failed' || latestStatus === 'timed_out')
                    lastStatus = 'failed';
                else if (latestStatus === 'awaiting_approval' || latestStatus === 'awaiting_credentials' || latestStatus === 'pending' || latestStatus === 'running')
                    lastStatus = 'awaiting_approval';
                else
                    lastStatus = 'never_run';
            }
            const ownerUser = Array.from(memoryUsers.values()).find((u) => u.id === wf.user_id);
            return {
                ...wf,
                user_name: ownerUser ? ownerUser.name : 'Unknown User',
                user_email: ownerUser ? ownerUser.email : '',
                steps: ver ? ver.steps : [],
                last_status: lastStatus,
                lastStatus,
                latest_run_id: latestRunId,
                latestRunId,
            };
        });
        return { rows: mappedList };
    }
    // --- WORKFLOW_VERSIONS TABLE QUERIES ---
    if (normalizedSql.includes('from workflow_versions')) {
        if (normalizedSql.includes('where id =')) {
            const verId = params[0];
            const ver = memoryVersions.get(verId);
            return { rows: ver ? [ver] : [] };
        }
        if (normalizedSql.includes('where workflow_id =')) {
            const wfId = params[0];
            const vers = Array.from(memoryVersions.values()).filter((v) => v.workflow_id === wfId);
            return { rows: vers };
        }
        return { rows: Array.from(memoryVersions.values()) };
    }
    // --- RUNS TABLE QUERIES ---
    // 14. INSERT INTO runs
    if (normalizedSql.startsWith('insert into runs')) {
        const [id, workflow_id, version_id, status] = params;
        const item = { id, workflow_id, version_id, status: status || 'pending', started_at: new Date().toISOString(), finished_at: null };
        memoryRuns.set(id, item);
        return { rows: [item] };
    }
    // 15. SELECT FROM run_steps WHERE run_id = $1
    if (normalizedSql.includes('from run_steps where run_id =')) {
        const steps = memoryRunSteps.get(params[0]) || [];
        return { rows: steps };
    }
    // 16. UPDATE runs SET status
    if (normalizedSql.startsWith('update runs set status')) {
        if (normalizedSql.includes("status = 'pending'") && normalizedSql.includes('where id =')) {
            const runIdVal = params[0];
            const run = memoryRuns.get(runIdVal);
            if (run && run.status === 'pending') {
                run.status = 'claimed';
                memoryRuns.set(run.id, run);
                return { rows: [run] };
            }
            return { rows: [] };
        }
        const runIdVal = params[params.length - 1];
        const statusVal = params[0];
        const errorVal = params.length > 2 ? params[1] : null;
        const run = memoryRuns.get(runIdVal);
        if (run) {
            run.status = statusVal;
            if (errorVal !== undefined) {
                run.error = errorVal;
            }
            if (statusVal === 'completed' || statusVal === 'failed' || statusVal === 'cancelled' || statusVal === 'timed_out') {
                run.finished_at = new Date().toISOString();
            }
            memoryRuns.set(run.id, run);
            return { rows: [run] };
        }
        return { rows: [] };
    }
    // 17. SELECT FROM runs
    if (normalizedSql.includes('from runs')) {
        if (normalizedSql.includes("status = 'pending'")) {
            const pendingList = Array.from(memoryRuns.values())
                .filter((r) => r.status === 'pending')
                .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
            const limitMatch = normalizedSql.match(/limit\s+(\d+)/);
            const limit = limitMatch ? parseInt(limitMatch[1], 10) : 5;
            return { rows: pendingList.slice(0, limit) };
        }
        let runsList = Array.from(memoryRuns.values()).map((r) => {
            const wf = memoryWorkflows.get(r.workflow_id);
            const owner = wf ? Array.from(memoryUsers.values()).find((u) => u.id === wf.user_id) : null;
            return {
                ...r,
                workflow_name: wf ? wf.name : r.workflow_id,
                user_id: wf ? wf.user_id : null,
                user_name: owner ? owner.name : 'Unknown',
                user_email: owner ? owner.email : '',
            };
        });
        if (normalizedSql.includes('where r.id =') || normalizedSql.includes('where id =')) {
            const runIdParam = params[0];
            const userIdParam = params[1];
            runsList = runsList.filter((r) => r.id === runIdParam);
            if (userIdParam) {
                runsList = runsList.filter((r) => r.user_id === userIdParam);
            }
        }
        else if (normalizedSql.includes('where w.user_id =') || normalizedSql.includes('where user_id =')) {
            const userIdParam = params[0];
            runsList = runsList.filter((r) => r.user_id === userIdParam);
        }
        runsList.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
        return { rows: runsList };
    }
    return { rows: [] };
}
export async function getClient() {
    if (!pgPool) {
        throw new Error('[Database Unavailable] PostgreSQL pool is not configured.');
    }
    return await pgPool.connect();
}
export async function withTransaction(callback) {
    if (isProduction && !pgPool) {
        throw new Error('[Database Unavailable] DATABASE_URL is required in production mode. Cannot execute transaction.');
    }
    if (pgPool) {
        const client = await pgPool.connect();
        try {
            await client.query('BEGIN');
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        }
        catch (err) {
            try {
                await client.query('ROLLBACK');
            }
            catch (rbErr) {
                console.warn('[Transaction Rollback Warning]', rbErr);
            }
            throw err;
        }
        finally {
            client.release();
        }
    }
    // Development Memory Fallback
    return await callback({ query });
}
export const pool = {
    query,
    getClient,
    withTransaction,
    isConfigured: isDatabaseConfigured,
    testConnection: testDatabaseConnection,
    end: async () => {
        if (pgPool)
            await pgPool.end();
    },
};
