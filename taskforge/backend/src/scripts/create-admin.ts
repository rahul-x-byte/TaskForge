import { supabaseAdmin } from '../lib/supabaseAdmin.js';
import { pool, memoryUsers } from '../db/index.js';

async function createAdminAccount() {
  console.log('====================================================');
  console.log('      TASKFORGE FIRST ADMIN BOOTSTRAPPER            ');
  console.log('====================================================');

  const name = process.env.ADMIN_NAME || 'Platform Administrator';
  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'admin123';

  console.log(`[Create Admin] Attempting to create admin account for: ${email}`);

  try {
    // 1. Create or retrieve Supabase Auth User
    let userId: string | null = null;

    const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (!createError && createData?.user) {
      userId = createData.user.id;
      console.log(`[Create Admin] Created Supabase Auth user with ID: ${userId}`);
    } else {
      console.warn(`[Create Admin] User creation note (${createError?.message}). Checking existing users...`);
      const { data: listData } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = listData?.users?.find((u) => u.email === email);
      if (existingUser) {
        userId = existingUser.id;
        console.log(`[Create Admin] Found existing Supabase Auth user ID: ${userId}`);
      }
    }

    // 2. Elevate Profile Role to 'admin'
    if (userId) {
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ role: 'admin', name, email, updated_at: new Date().toISOString() })
        .eq('id', userId);

      if (updateError) {
        // Fallback insert/upsert via Postgres pool
        await pool.query(
          `INSERT INTO profiles (id, name, email, role, created_at, updated_at)
           VALUES ($1, $2, $3, 'admin', NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET role = 'admin', name = EXCLUDED.name, updated_at = NOW()`,
          [userId, name, email]
        );
      }
      console.log(`[Create Admin] Successfully elevated user ${email} (${userId}) to role = 'admin'!`);
    }

    // 3. Update memory fallback
    const memAdmin = Array.from(memoryUsers.values()).find((u) => u.email === email);
    if (memAdmin) {
      memAdmin.role = 'admin';
    }

    console.log('====================================================');
    console.log(` SUCCESS: Admin user created/elevated successfully!`);
    console.log(` Email: ${email}`);
    console.log('====================================================');
    process.exit(0);
  } catch (err: any) {
    console.error('[Create Admin Error] Failed to create admin user:', err?.message || err);
    process.exit(1);
  }
}

createAdminAccount();
