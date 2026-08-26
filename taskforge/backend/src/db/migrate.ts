import { pool } from './index.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  console.log('[DB Migration] Starting database migrations...');
  try {
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      console.log(`[DB Migration] Running migration file: ${file}`);
      const migrationPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      await pool.query(sql);
    }
    console.log('[DB Migration] All migrations executed successfully.');
  } catch (err) {
    console.error('[DB Migration Error]', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
