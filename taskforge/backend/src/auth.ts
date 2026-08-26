import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { FastifyRequest, FastifyReply } from 'fastify';
import { UserRole } from '@taskforge/shared';

const JWT_SECRET = process.env.JWT_SECRET || 'taskforge-super-secret-jwt-key-2026';
export const WORKER_SECRET = process.env.WORKER_SECRET || 'taskforge-worker-secret-key-2026';

export interface UserPayload {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserPayload;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

export function generateToken(user: UserPayload): string {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export function verifyToken(token: string): UserPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as UserPayload;
    if (payload && payload.id && payload.role) {
      return payload;
    }
    return null;
  } catch (err) {
    return null;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.status(401).send({ error: 'Unauthorized: Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.substring(7).trim();
  const payload = verifyToken(token);
  if (!payload) {
    reply.status(401).send({ error: 'Unauthorized: Invalid or expired token' });
    return;
  }

  request.user = payload;
}

export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;

  if (request.user?.role !== 'admin') {
    reply.status(403).send({ error: 'Forbidden: Admin access required' });
    return;
  }
}

export async function requireUser(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
}

export function requireRole(role: UserRole) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireAuth(request, reply);
    if (reply.sent) return;

    if (request.user?.role !== role) {
      reply.status(403).send({ error: `Forbidden: ${role} access required` });
      return;
    }
  };
}

export async function verifyWorkerSecret(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const workerSecretHeader = request.headers['x-worker-secret'] || (request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.substring(7) : null);
  
  if (workerSecretHeader === WORKER_SECRET) {
    return;
  }

  // Fallback check: Allow authenticated Admin user to execute worker commands
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const payload = verifyToken(authHeader.substring(7).trim());
    if (payload) {
      request.user = payload;
      return;
    }
  }

  reply.status(401).send({ error: 'Unauthorized: Invalid worker secret token' });
}
