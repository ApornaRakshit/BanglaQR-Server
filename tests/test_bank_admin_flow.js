import assert from "node:assert";
import { db } from "../src/config/db.js";
import { adminInstitutionsService } from "../src/modules/admin/institutions/admin.institutions.service.js";
import {
  verifyInstitutionInvitation,
  acceptInstitutionInvitation,
  loginUser,
} from "../src/modules/auth/auth.service.js";

async function run() {
  console.log("=== Testing Bank Administrator Invitation & Activation Flow ===");

  const [instRows] = await db.execute("SELECT id, name, institution_code FROM institutions WHERE status = 'active' LIMIT 1");
  const inst = instRows[0];
  console.log("Selected institution:", inst);

  const timestamp = Date.now();
  const testEmail = `bank_officer_${timestamp}@example.com`;

  // 1. Admin creates invitation
  const invite = await adminInstitutionsService.inviteStaff(
    {
      institutionId: inst.id,
      name: "Officer Test",
      email: testEmail,
      phone: "01788776655",
      roleName: "bank_admin",
    },
    { id: 5, email: "admin@banglaqr.com" },
    { origin: "http://localhost:5173" }
  );

  console.log("Created invitation:", {
    id: invite.invitationId,
    token: invite.invitationToken,
    url: invite.invitationUrl,
  });

  // 2. Verify invitation
  const verify = await verifyInstitutionInvitation(invite.invitationToken);
  console.log("Verified invitation:", {
    valid: verify.valid,
    email: verify.email,
    institutionId: verify.institutionId,
    institutionName: verify.institutionName,
    roleName: verify.roleName,
  });

  // 3. Accept invitation & set password
  const accept = await acceptInstitutionInvitation({
    token: invite.invitationToken,
    password: "StrongPassword123!",
  });
  console.log("Accept result:", accept);

  // 4. Log in as Bank Admin
  const login = await loginUser({
    email: testEmail,
    password: "StrongPassword123!",
  });

  console.log("Login user object:", {
    id: login.user.id,
    email: login.user.email,
    role: login.user.role,
    roles: login.user.roles,
    institutionId: login.user.institutionId,
    institutionRole: login.user.institutionRole,
    institution: login.user.institution?.name,
    institutionMemberships: login.user.institutionMemberships,
  });

  // Cleanup
  await db.execute("DELETE FROM institution_users WHERE user_id = ?", [login.user.id]);
  await db.execute("DELETE FROM institution_invitations WHERE id = ?", [invite.invitationId]);
  await db.execute("DELETE FROM users WHERE id = ?", [login.user.id]);
  console.log("Cleanup complete!");
  process.exit(0);
}

run().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});

