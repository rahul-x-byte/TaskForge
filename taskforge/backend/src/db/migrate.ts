import { pool } from './index.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  console.log('[DB Migration] Starting database migrations...');
  const isProduction = process.env.NODE_ENV === 'production';
  const migrationsDir = path.join(__dirname, 'migrations');

  if (!fs.existsSync(migrationsDir)) {
    const msg = `[DB Migration] Migrations directory not found at: ${migrationsDir}`;
    console.error(msg);
    if (isProduction) {
      throw new Error(msg);
    }
    return;
  }

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    console.warn(`[DB Migration] No SQL migration files found in: ${migrationsDir}`);
    return;
  }

  try {
    for (const file of files) {
      console.log(`[DB Migration] Applying migration: ${file}`);
      const migrationPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      await pool.query(sql);
    }
    console.log(`[DB Migration] Successfully applied ${files.length} migration(s).`);
  } catch (err: any) {
    console.error('[DB Migration Error] Failed to execute migrations:', err?.message || err);
    if (isProduction) {
      throw err;
    }
  }
}


// CLI direct run support
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  runMigrations();
}
