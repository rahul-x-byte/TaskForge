import { FastifyRequest, FastifyReply } from 'fastify';
import { supabaseAdmin } from './lib/supabaseAdmin.js';
import { pool, memoryUsers } from './db/index.js';

export const WORKER_SECRET = process.env.WORKER_SECRET || 'taskforge-worker-secret-key-2026';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * Verify Supabase access token from Authorization: Bearer <token>
 */
export async function verifySupabaseToken(authHeader?: string): Promise<AuthUser | null> {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;

  const token = parts[1];
  if (!token) return null;

  try {
    // 1. Verify token with Supabase Auth
    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (!authError && authData?.user) {
      const u = authData.user;
      
      // Fetch user profile from DB or fallback
      let name = (u.user_metadata?.name as string) || u.email || 'User';
      let role: 'admin' | 'user' = 'user';

      try {
        const profileRes = await pool.query('SELECT * FROM profiles WHERE id = $1', [u.id]);
        if (profileRes.rows.length > 0) {
          name = profileRes.rows[0].name || name;
          role = profileRes.rows[0].role || 'user';
        } else {
          // Query directly via Supabase client
          const { data: prof } = await supabaseAdmin.from('profiles').select('*').eq('id', u.id).single();
          if (prof) {
            name = prof.name || name;
            role = prof.role || 'user';
          }
        }
      } catch (e) {}

      return {
        id: u.id,
        email: u.email || '',
        name,
        role,
      };
    }

    // 2. Local memory user fallback for offline development / test suite
    const memUser = Array.from(memoryUsers.values()).find((u) => u.id === token || u.email === token);
    if (memUser) {
      return {
        id: memUser.id,
        email: memUser.email,
        name: memUser.name,
        role: memUser.role,
      };
    }
  } catch (err) {
    console.error('[Auth Error] Token verification failed:', err);
  }

  return null;
}

/**
 * Fastify preHandler: Require valid authenticated user session
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  const user = await verifySupabaseToken(authHeader);

  if (!user) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Valid Supabase authentication token required.' });
  }

  request.user = user;
}

/**
 * Fastify preHandler: Require authenticated user with admin role
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (request.user?.role !== 'admin') {
    return reply.status(403).send({ error: 'Forbidden', message: 'Administrative permissions required.' });
  }
}

/**
 * Fastify preHandler: Verify X-Worker-Secret header for internal Playwright worker calls
 */
export async function verifyWorkerSecret(request: FastifyRequest, reply: FastifyReply) {
  const headerSecret = request.headers['x-worker-secret'];
  if (headerSecret !== WORKER_SECRET) {
    return reply.status(401).send({ error: 'Unauthorized worker secret', message: 'Invalid or missing X-Worker-Secret header.' });
  }
}
