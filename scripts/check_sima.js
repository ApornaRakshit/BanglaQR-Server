import { db } from "../src/config/db.js";

async function run() {
  const [users] = await db.query(`
    SELECT 
      u.id as user_id, 
      u.email, 
      m.id as merchant_id, 
      mp.institution_id as p_inst, 
      mp.bank_name as p_bank, 
      mp.branch_name as p_branch, 
      mk.institution_id as k_inst, 
      mk.bank_name as k_bank, 
      mk.branch_name as k_branch 
    FROM users u 
    LEFT JOIN merchants m ON m.user_id = u.id 
    LEFT JOIN merchant_profiles mp ON mp.merchant_id = m.id 
    LEFT JOIN merchant_kyc mk ON mk.merchant_id = m.id 
    WHERE u.email = 'sima@gmail.com'
  `);
  console.table(users);
  await db.end();
}

run();

