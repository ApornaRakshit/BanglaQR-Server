import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function fixMappings() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'banglaqr_db'
  });

  console.log('=== FIXING INSTITUTION USER & DATA MAPPINGS ===');

  // 1. Fix BRAC Admin membership mapping
  const [bracInst] = await conn.query("SELECT id, name FROM institutions WHERE institution_code = 'BRAC' LIMIT 1");
  if (bracInst.length > 0) {
    const bracId = bracInst[0].id;
    console.log(`Found BRAC Bank PLC: ID ${bracId}`);

    const [user56] = await conn.query("SELECT id, email FROM users WHERE email = 'brac.admin@banglaqr.com'");
    if (user56.length > 0) {
      await conn.execute(
        "UPDATE institution_users SET institution_id = ? WHERE user_id = ?",
        [bracId, user56[0].id]
      );
      console.log(`[FIXED] Updated institution_users for user ${user56[0].email} -> institution_id: ${bracId} (${bracInst[0].name})`);
    }

    // Fix BRAC Bank QR Gateway institution_id
    await conn.execute(
      "UPDATE gateways SET institution_id = ? WHERE code = 'BRAC_BANK_QR'",
      [bracId]
    );
    console.log(`[FIXED] Updated gateways for BRAC_BANK_QR -> institution_id: ${bracId}`);
  }

  // 2. Ensure official MFS providers exist as distinct institutions in institutions table
  // Check bKash Limited
  const [bkashInst] = await conn.query("SELECT id FROM institutions WHERE institution_code = 'BKASH' LIMIT 1");
  let bkashId;
  const bracBankId = bracInst.length > 0 ? bracInst[0].id : null;

  if (bkashInst.length === 0) {
    const [ins] = await conn.execute(`
      INSERT INTO institutions (
        institution_code, name, name_bn, legal_name, institution_type,
        description, website_url, support_email, support_phone,
        head_office_address, status, directory_status, partnership_status,
        regulatory_status, created_at, updated_at
      ) VALUES (
        'BKASH', 'bKash Limited', 'বিকাশ লিমিটেড', 'bKash Limited (A Subsidiary of BRAC Bank PLC)', 'mfs',
        'Largest Mobile Financial Services provider in Bangladesh, operating under Bangladesh Bank regulations.',
        'https://www.bkash.com', 'support@bkash.com', '16247',
        'Shadhinata Tower, 1, Bir Sreshtha Shaheed Jahangir Gate, Dhaka Cantonment, Dhaka-1206',
        'active', 'verified', 'active_partner', 'licensed_mfs', NOW(), NOW()
      )
    `);
    bkashId = ins.insertId;
    console.log(`[CREATED] bKash Limited MFS institution created with ID ${bkashId}`);
  } else {
    bkashId = bkashInst[0].id;
    console.log(`Found existing bKash Limited MFS institution: ID ${bkashId}`);
  }

  // Ensure bKash profile in institution_mfs_profiles
  const [bkashProf] = await conn.query("SELECT institution_id FROM institution_mfs_profiles WHERE institution_id = ?", [bkashId]);
  if (bkashProf.length === 0) {
    await conn.execute(`
      INSERT INTO institution_mfs_profiles (
        institution_id, brand_name, legal_operator_name, provider_code,
        parent_bank_id, authorization_reference, merchant_application_supported,
        official_contact, created_at, updated_at
      ) VALUES (
        ?, 'bKash', 'bKash Limited', 'BKASH',
        ?, 'BB/PSD/MFS/BKASH/2011', 1,
        'support@bkash.com', NOW(), NOW()
      )
    `, [bkashId, bracBankId]);
    console.log(`[CREATED] bKash MFS profile created linked to parent bank ID ${bracBankId}`);
  }

  // Link bKash gateway to bKash institution
  await conn.execute(
    "UPDATE gateways SET institution_id = ? WHERE code = 'BKASH_DIRECT'",
    [bkashId]
  );
  console.log(`[FIXED] Linked BKASH_DIRECT gateway to bKash institution ${bkashId}`);

  // Check Upay (UCB Fintech Company Limited)
  const [ucbBank] = await conn.query("SELECT id FROM institutions WHERE institution_code = 'UCBL' OR name LIKE '%United Commercial Bank%' LIMIT 1");
  const ucbId = ucbBank.length > 0 ? ucbBank[0].id : null;

  const [upayInst] = await conn.query("SELECT id FROM institutions WHERE institution_code = 'UPAY' LIMIT 1");
  let upayId;
  if (upayInst.length === 0) {
    const [insUpay] = await conn.execute(`
      INSERT INTO institutions (
        institution_code, name, name_bn, legal_name, institution_type,
        description, website_url, support_email, support_phone,
        head_office_address, status, directory_status, partnership_status,
        regulatory_status, created_at, updated_at
      ) VALUES (
        'UPAY', 'Upay (UCB Fintech Company Ltd)', 'উপায় (ইউসিবি ফিনটেক)', 'UCB Fintech Company Limited', 'mfs',
        'Mobile Financial Services subsidiary of United Commercial Bank PLC.',
        'https://www.upaybd.com', 'info@upaybd.com', '16268',
        'Plot-CWS(A)-1, Road-34, Gulshan Avenue, Dhaka-1212',
        'active', 'verified', 'active_partner', 'licensed_mfs', NOW(), NOW()
      )
    `);
    upayId = insUpay.insertId;
    console.log(`[CREATED] Upay MFS institution created with ID ${upayId}`);
  } else {
    upayId = upayInst[0].id;
  }

  // Ensure Upay profile in institution_mfs_profiles
  const [upayProf] = await conn.query("SELECT institution_id FROM institution_mfs_profiles WHERE institution_id = ?", [upayId]);
  if (upayProf.length === 0) {
    await conn.execute(`
      INSERT INTO institution_mfs_profiles (
        institution_id, brand_name, legal_operator_name, provider_code,
        parent_bank_id, authorization_reference, merchant_application_supported,
        official_contact, created_at, updated_at
      ) VALUES (
        ?, 'Upay', 'UCB Fintech Company Limited', 'UPAY',
        ?, 'BB/PSD/MFS/UPAY/2021', 1,
        'info@upaybd.com', NOW(), NOW()
      )
    `, [upayId, ucbId]);
    console.log(`[CREATED] Upay MFS profile created linked to parent bank ID ${ucbId}`);
  }

  // Link Upay gateway
  await conn.execute(
    "UPDATE gateways SET institution_id = ? WHERE code = 'UPAY_DIRECT'",
    [upayId]
  );
  console.log(`[FIXED] Linked UPAY_DIRECT gateway to Upay institution ${upayId}`);

  // Check Rocket (Dutch-Bangla Bank PLC MFS)
  const [dbblBank] = await conn.query("SELECT id FROM institutions WHERE institution_code = 'DBBL' OR name LIKE '%Dutch-Bangla%' LIMIT 1");
  const dbblId = dbblBank.length > 0 ? dbblBank[0].id : null;

  const [rocketInst] = await conn.query("SELECT id FROM institutions WHERE institution_code = 'ROCKET_DBBL' OR institution_code = 'ROCKET' LIMIT 1");
  let rocketId;
  if (rocketInst.length === 0) {
    const [insRocket] = await conn.execute(`
      INSERT INTO institutions (
        institution_code, name, name_bn, legal_name, institution_type,
        description, website_url, support_email, support_phone,
        head_office_address, status, directory_status, partnership_status,
        regulatory_status, created_at, updated_at
      ) VALUES (
        'ROCKET', 'Rocket (Dutch-Bangla Bank MFS)', 'রকেট (ডাচ-বাংলা ব্যাংক)', 'Dutch-Bangla Bank PLC Mobile Financial Services', 'mfs',
        'Pioneer Mobile Financial Services wing of Dutch-Bangla Bank PLC.',
        'https://www.dutchbanglabank.com/rocket', 'rocket@dbbl.com.bd', '16216',
        'Sena Kalyan Bhaban, 195 Motijheel C/A, Dhaka-1000',
        'active', 'verified', 'active_partner', 'licensed_mfs', NOW(), NOW()
      )
    `);
    rocketId = insRocket.insertId;
    console.log(`[CREATED] Rocket MFS institution created with ID ${rocketId}`);
  } else {
    rocketId = rocketInst[0].id;
  }

  const [rocketProf] = await conn.query("SELECT institution_id FROM institution_mfs_profiles WHERE institution_id = ?", [rocketId]);
  if (rocketProf.length === 0) {
    await conn.execute(`
      INSERT INTO institution_mfs_profiles (
        institution_id, brand_name, legal_operator_name, provider_code,
        parent_bank_id, authorization_reference, merchant_application_supported,
        official_contact, created_at, updated_at
      ) VALUES (
        ?, 'Rocket', 'Dutch-Bangla Bank PLC', 'ROCKET',
        ?, 'BB/PSD/MFS/DBBL/2011', 1,
        'rocket@dbbl.com.bd', NOW(), NOW()
      )
    `, [rocketId, dbblId]);
    console.log(`[CREATED] Rocket MFS profile created linked to parent bank ID ${dbblId}`);
  }

  // Link Rocket gateway
  await conn.execute(
    "UPDATE gateways SET institution_id = ? WHERE code = 'ROCKET_DBBL'",
    [rocketId]
  );
  console.log(`[FIXED] Linked ROCKET_DBBL gateway to Rocket institution ${rocketId}`);

  // Check Nagad Limited (ID 4)
  const [nagadProf] = await conn.query("SELECT institution_id FROM institution_mfs_profiles WHERE institution_id = 4");
  if (nagadProf.length === 0) {
    await conn.execute(`
      INSERT INTO institution_mfs_profiles (
        institution_id, brand_name, legal_operator_name, provider_code,
        parent_bank_id, authorization_reference, merchant_application_supported,
        official_contact, created_at, updated_at
      ) VALUES (
        4, 'Nagad', 'Nagad Limited', 'NAGAD_MFS',
        null, 'BPO/MFS/NAGAD/2019', 1,
        'info@nagad.com.bd', NOW(), NOW()
      )
    `);
    console.log('[CREATED] Nagad MFS profile for institution ID 4');
  }

  // Link Nagad gateway
  await conn.execute(
    "UPDATE gateways SET institution_id = 4 WHERE code = 'NAGAD_DIRECT'"
  );
  console.log('[FIXED] Linked NAGAD_DIRECT gateway to Nagad institution 4');

  console.log('\n=== VERIFYING FINAL MAPPINGS ===');
  const [finalUsers] = await conn.query(`
    SELECT iu.id, iu.user_id, u.email, iu.staff_name, i.id as institution_id, i.name as institution_name, i.institution_code
    FROM institution_users iu
    JOIN users u ON u.id = iu.user_id
    JOIN institutions i ON i.id = iu.institution_id
  `);
  console.table(finalUsers);

  const [finalGateways] = await conn.query(`
    SELECT g.id, g.name, g.code, g.institution_id, i.name as institution_name, i.institution_type
    FROM gateways g
    LEFT JOIN institutions i ON i.id = g.institution_id
  `);
  console.table(finalGateways);

  await conn.end();
  console.log('=== DATA MAPPINGS COMPLETE ===');
}

fixMappings().catch(console.error);

