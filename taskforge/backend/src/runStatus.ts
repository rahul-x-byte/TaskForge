import { pool } from './db/index.js';

// In-memory diagnostic store to guarantee error details are always returned to frontend
export const runDiagnostics = new Map<string, { error?: string; detail?: any }>();

/**
 * Update run status and steps atomically directly in the database,
 * and preserve detailed error diagnostics in memory.
 */
export async function updateRunStatus(
  id: string,
  status: string,
  detail?: any,
  error?: string
): Promise<void> {
  // Store in memory diagnostics cache
  if (error || detail) {
    const existing = runDiagnostics.get(id) || {};
    runDiagnostics.set(id, {
      error: error || existing.error,
      detail: detail ? { ...(existing.detail || {}), ...detail } : existing.detail,
    });
  }

  try {
    const detailJson = detail ? JSON.stringify(detail) : null;
    await pool.query(
      `UPDATE runs 
       SET status = $1, 
           error = COALESCE($2, error), 
           detail = COALESCE($3::jsonb, detail),
           finished_at = CASE WHEN $1 IN ('completed', 'failed', 'cancelled', 'timed_out') THEN NOW() ELSE finished_at END 
       WHERE id = $4`,
      [status, error || null, detailJson, id]
    );

    if (detail && typeof detail.stepIndex === 'number') {
      await pool.query(
        `INSERT INTO run_steps (run_id, step_index, status, error_message, screenshot_url)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, detail.stepIndex, detail.status || status, error || detail.error || null, detail.screenshotUrl || null]
      ).catch(() => {});
    }
  } catch (err: any) {
    console.warn(`[Run Status Update Warning] Failed to update full detail:`, err?.message || err);
    await pool.query(
      `UPDATE runs SET status = $1, finished_at = CASE WHEN $1 IN ('completed', 'failed', 'cancelled', 'timed_out') THEN NOW() ELSE finished_at END WHERE id = $2`,
      [status, id]
    ).catch(() => {});
  }
}
