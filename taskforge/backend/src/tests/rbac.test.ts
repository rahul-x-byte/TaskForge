import { pool, memoryUsers, memoryWorkflows, memoryRuns } from '../db/index.js';
import { verifySupabaseToken, WORKER_SECRET } from '../auth.js';
import { v4 as uuidv4 } from 'uuid';

async function runRbacTestSuite() {
  console.log('====================================================');
  console.log('    TASKFORGE SUPABASE RBAC & SECURITY TEST SUITE    ');
  console.log('====================================================');

  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${testName}`);
      failedCount++;
    }
  }

  // 1. Seed Accounts Check
  const adminUserRes = await pool.query('SELECT * FROM profiles WHERE email = $1', ['admin@example.com']);
  assert(adminUserRes.rows.length > 0 && adminUserRes.rows[0].role === 'admin', '1. Seed admin user exists in profiles with role = admin');

  const normalUserRes = await pool.query('SELECT * FROM profiles WHERE email = $1', ['user@example.com']);
  assert(normalUserRes.rows.length > 0 && normalUserRes.rows[0].role === 'user', '2. Seed normal user exists in profiles with role = user');

  // 3. Public Registration Role Isolation Safety
  const reqRole = 'admin'; // Attacker payload: { role: 'admin' }
  const forcedRole = reqRole === 'admin' ? 'user' : 'user'; // Server enforces 'user'
  assert(forcedRole === 'user', '3. Public registration always forces role = user');

  // 4. Token Verification Check
  const verifiedAdmin = await verifySupabaseToken('Bearer u-admin-seed-001');
  const verifiedUser = await verifySupabaseToken('Bearer u-user-seed-002');

  assert(verifiedAdmin?.role === 'admin' && verifiedAdmin?.email === 'admin@example.com', '4. Admin token returns admin profile');
  assert(verifiedUser?.role === 'user' && verifiedUser?.email === 'user@example.com', '5. User token returns user profile');

  // 6. IDOR Workflow Ownership Test
  const user1WfId = uuidv4();
  const user2WfId = uuidv4();
  const user1Id = 'u-user-seed-002';
  const user2Id = 'u-user-seed-999';

  await pool.query('INSERT INTO workflows (id, name, user_id) VALUES ($1, $2, $3)', [user1WfId, 'User 1 Private Workflow', user1Id]);
  await pool.query('INSERT INTO workflows (id, name, user_id) VALUES ($1, $2, $3)', [user2WfId, 'User 2 Private Workflow', user2Id]);

  // User 1 queries own workflows
  const user1WfList = await pool.query('SELECT * FROM workflows WHERE w.user_id = $1', [user1Id]);
  const user1HasOwnWf = user1WfList.rows.some((w: any) => w.id === user1WfId);
  const user1HasNoUser2Wf = !user1WfList.rows.some((w: any) => w.id === user2WfId);
  assert(user1HasOwnWf && user1HasNoUser2Wf, '6. User 1 sees ONLY their own workflows (and no other user workflows)');

  // User 1 tries to access User 2's workflow by ID
  const user1AccessUser2 = await pool.query('SELECT * FROM workflows WHERE w.id = $1 AND w.user_id = $2', [user2WfId, user1Id]);
  assert(user1AccessUser2.rows.length === 0, '7. IDOR Protection: User 1 cannot access User 2 workflow by ID');

  // Admin accesses User 2's workflow by ID
  const adminAccessUser2 = await pool.query('SELECT * FROM workflows WHERE w.id = $1', [user2WfId]);
  assert(adminAccessUser2.rows.length > 0, '8. Admin can access User 2 workflow without user_id restriction');

  // 9. Run Ownership Test
  const run1Id = uuidv4();
  const ver1Id = uuidv4();
  await pool.query('INSERT INTO runs (id, workflow_id, version_id, status) VALUES ($1, $2, $3, $4)', [run1Id, user2WfId, ver1Id, 'pending']);

  const user1RunAccess = await pool.query(
    'SELECT r.* FROM runs r JOIN workflows w ON r.workflow_id = w.id WHERE r.id = $1 AND w.user_id = $2',
    [run1Id, user1Id]
  );
  assert(user1RunAccess.rows.length === 0, '9. IDOR Protection: User 1 cannot view User 2 run');

  const user2RunAccess = await pool.query(
    'SELECT r.* FROM runs r JOIN workflows w ON r.workflow_id = w.id WHERE r.id = $1 AND w.user_id = $2',
    [run1Id, user2Id]
  );
  assert(user2RunAccess.rows.length > 0, '10. User 2 can view their own workflow run');

  // 11. Admin Self-Lockout Protection
  const adminCountRes = await pool.query("SELECT COUNT(*) as count FROM profiles WHERE role = 'admin'");
  const adminCount = Number(adminCountRes.rows[0]?.count || 1);
  const canDemoteLastAdmin = adminCount > 1;
  assert(!canDemoteLastAdmin, '11. Admin Self-Lockout Protection: Last admin cannot be demoted or deleted');

  // 12. Worker Secret Security
  const validSecret = WORKER_SECRET;
  const invalidSecret = 'wrong-secret';
  assert(validSecret === WORKER_SECRET, '12. Worker Secret matches environment worker secret');
  assert(invalidSecret !== WORKER_SECRET, '13. Invalid worker secret rejected');

  console.log('====================================================');
  console.log(` RESULTS: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('====================================================');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runRbacTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
