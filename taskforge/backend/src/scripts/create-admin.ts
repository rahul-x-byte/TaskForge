import { v4 as uuidv4 } from 'uuid';
import readline from 'readline';
import { pool } from '../db/index.js';
import { hashPassword } from '../auth.js';

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

async function createAdmin() {
  console.log('[TaskForge Admin Bootstrap] Creating initial admin account...');

  let name = process.env.ADMIN_NAME;
  let email = process.env.ADMIN_EMAIL;
  let password = process.env.ADMIN_PASSWORD;

  if (!name) {
    name = await prompt('Enter Admin Full Name (default: TaskForge Admin): ') || 'TaskForge Admin';
  }
  if (!email) {
    email = await prompt('Enter Admin Email (default: admin@example.com): ') || 'admin@example.com';
  }
  if (!password) {
    password = await prompt('Enter Admin Password (min 6 chars): ');
  }

  if (!password || password.length < 4) {
    console.error('[Error] Admin password must be at least 4 characters long.');
    process.exit(1);
  }

  const normalizedEmail = email.toLowerCase().trim();
  const passwordHash = await hashPassword(password);

  try {
    // Check if user already exists
    const existing = await pool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);

    if (existing.rows && existing.rows.length > 0) {
      const user = existing.rows[0];
      if (user.role === 'admin') {
        console.log(`[Success] Account for ${normalizedEmail} already exists as admin. Updating password...`);
        await pool.query('UPDATE users SET name = $1, password_hash = $2, role = $3, updated_at = NOW() WHERE id = $4', [
          name,
          passwordHash,
          'admin',
          user.id,
        ]);
      } else {
        console.log(`[Success] Promoting existing user ${normalizedEmail} to admin...`);
        await pool.query('UPDATE users SET role = $1, password_hash = $2, updated_at = NOW() WHERE id = $3', [
          'admin',
          passwordHash,
          user.id,
        ]);
      }
    } else {
      const adminId = uuidv4();
      await pool.query(
        'INSERT INTO users (id, name, email, password_hash, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
        [adminId, name, normalizedEmail, passwordHash, 'admin']
      );
      console.log(`[Success] Created new admin account for ${normalizedEmail} (ID: ${adminId}).`);
    }

    console.log('[TaskForge Admin Bootstrap] Completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('[Error] Failed to create admin account:', err);
    process.exit(1);
  }
}

createAdmin();
