import { pool } from './index.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  console.log('[DB Migration] Starting database migrations...');
  try {
    const migrationFile = path.join(__dirname, 'migrations', '001_initial_schema.sql');
    const sql = fs.readFileSync(migrationFile, 'utf-8');
    await pool.query(sql);
    console.log('[DB Migration] Migrations executed successfully.');
  } catch (err) {
    console.error('[DB Migration Error]', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
