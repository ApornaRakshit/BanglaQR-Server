import argon2 from "argon2";
import { db } from "../src/config/db.js";

async function addIndexIfNotExists(table, indexName, columns) {
  const [indexes] = await db.execute(`SHOW INDEX FROM ${table} WHERE Key_name = ?`, [indexName]);
  if (indexes.length === 0) {
    await db.execute(`ALTER TABLE ${table} ADD INDEX ${indexName} (${columns})`);
    console.log(`✅ Added index ${indexName} on ${table}(${columns})`);
  } else {
    console.log(`Index ${indexName} already exists on ${table}`);
  }
}

async function run() {
  try {
    console.log("Starting admin dashboard migration...");

    // 1. Ensure 'dashboard.view' permission exists
    const [existingPerms] = await db.execute(
      "SELECT id FROM permissions WHERE name = ?",
      ["dashboard.view"]
    );

    let dashboardPermId;
    if (existingPerms.length === 0) {
      const [result] = await db.execute(
        "INSERT INTO permissions (name, description, created_at) VALUES (?, ?, NOW())",
        ["dashboard.view", "View admin dashboard and statistics"]
      );
      dashboardPermId = result.insertId;
      console.log("✅ Created 'dashboard.view' permission with ID:", dashboardPermId);
    } else {
      dashboardPermId = existingPerms[0].id;
      console.log("'dashboard.view' permission already exists with ID:", dashboardPermId);
    }

    // 2. Assign dashboard.view to super_admin, admin, reviewer, support_agent
    const adminRoles = ["super_admin", "admin", "reviewer", "support_agent"];
    for (const roleName of adminRoles) {
      const [roleRows] = await db.execute("SELECT id FROM roles WHERE name = ?", [roleName]);
      if (roleRows.length > 0) {
        const roleId = roleRows[0].id;
        const [existingRolePerm] = await db.execute(
          "SELECT * FROM role_permissions WHERE role_id = ? AND permission_id = ?",
          [roleId, dashboardPermId]
        );
        if (existingRolePerm.length === 0) {
          await db.execute(
            "INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
            [roleId, dashboardPermId]
          );
          console.log(`✅ Assigned 'dashboard.view' to role '${roleName}'`);
        }
      }
    }

    // Assign general permissions to admin role if missing
    const [adminRoleRows] = await db.execute("SELECT id FROM roles WHERE name = 'admin'");
    if (adminRoleRows.length > 0) {
      const adminRoleId = adminRoleRows[0].id;
      const [allPerms] = await db.execute("SELECT id FROM permissions");
      for (const p of allPerms) {
        const [has] = await db.execute(
          "SELECT * FROM role_permissions WHERE role_id = ? AND permission_id = ?",
          [adminRoleId, p.id]
        );
        if (has.length === 0) {
          await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [adminRoleId, p.id]);
        }
      }
    }

    // 3. Add Indexes to merchants table
    await addIndexIfNotExists("merchants", "idx_merchants_account_status", "account_status");
    await addIndexIfNotExists("merchants", "idx_merchants_kyc_status", "kyc_status");
    await addIndexIfNotExists("merchants", "idx_merchants_created_at", "created_at");
    await addIndexIfNotExists("merchants", "idx_merchants_submitted_at", "submitted_at");

    // 4. Create default admin test users if not existing
    const defaultUsers = [
      { email: "superadmin@banglaqr.com", phone: "+8801700000001", role: "super_admin", pass: "Admin@123456" },
      { email: "admin@banglaqr.com", phone: "+8801700000002", role: "admin", pass: "Admin@123456" },
      { email: "reviewer@banglaqr.com", phone: "+8801700000003", role: "reviewer", pass: "Reviewer@123456" },
      { email: "support@banglaqr.com", phone: "+8801700000004", role: "support_agent", pass: "Support@123456" },
    ];

    for (const u of defaultUsers) {
      const [userRows] = await db.execute("SELECT id FROM users WHERE email = ?", [u.email]);
      let userId;
      if (userRows.length === 0) {
        const passHash = await argon2.hash(u.pass);
        const [res] = await db.execute(
          `INSERT INTO users (email, phone, password_hash, status, email_verified_at, phone_verified_at, created_at, updated_at)
           VALUES (?, ?, ?, 'active', NOW(), NOW(), NOW(), NOW())`,
          [u.email, u.phone, passHash]
        );
        userId = res.insertId;
        console.log(`✅ Created test user: ${u.email} (ID: ${userId})`);
      } else {
        userId = userRows[0].id;
        // Make sure status is active and verified
        await db.execute(
          `UPDATE users SET status = 'active', email_verified_at = COALESCE(email_verified_at, NOW()), phone_verified_at = COALESCE(phone_verified_at, NOW()) WHERE id = ?`,
          [userId]
        );
      }

      // Assign role
      const [rRows] = await db.execute("SELECT id FROM roles WHERE name = ?", [u.role]);
      if (rRows.length > 0) {
        const roleId = rRows[0].id;
        const [urRows] = await db.execute(
          "SELECT * FROM user_roles WHERE user_id = ? AND role_id = ?",
          [userId, roleId]
        );
        if (urRows.length === 0) {
          // Remove any other roles for this user first
          await db.execute("DELETE FROM user_roles WHERE user_id = ?", [userId]);
          await db.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", [userId, roleId]);
          console.log(`✅ Assigned role '${u.role}' to user ${u.email}`);
        }
      }
    }

    console.log("✅ Migration 004 completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration error:", error);
    process.exit(1);
  }
}

run();

