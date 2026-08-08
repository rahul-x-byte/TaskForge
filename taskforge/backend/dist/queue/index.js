/**
 * TaskForge Job Queue Architecture Note:
 *
 * Active workflow execution uses HTTP polling bridge endpoints:
 * - GET  /api/runs/pending
 * - POST /api/runs/:id/claim
 *
 * In production/scaling scenarios, this file can be replaced with a real BullMQ + Redis queue implementation:
 *
 * import { Queue } from 'bullmq';
 * import Redis from 'ioredis';
 * const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
 * export const workflowQueue = new Queue('workflow-executions', { connection });
 */
export {};
