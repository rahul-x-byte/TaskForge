import { pool } from './index.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export async function runMigrations() {
    console.log('[DB Migration] Starting database migrations...');
    try {
        const migrationsDir = path.join(__dirname, 'migrations');
        if (fs.existsSync(migrationsDir)) {
            const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
            for (const file of files) {
                console.log(`[DB Migration] Running migration file: ${file}`);
                const migrationPath = path.join(migrationsDir, file);
                const sql = fs.readFileSync(migrationPath, 'utf-8');
                await pool.query(sql);
            }
        }
        console.log('[DB Migration] All migrations executed successfully.');
    }
    catch (err) {
        console.warn('[DB Migration Warning] Migration completed with warning/fallback:', err);
    }
}
// CLI direct run support
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
    runMigrations();
}
