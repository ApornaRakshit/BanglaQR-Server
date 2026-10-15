import argon2 from "argon2";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import { db } from "../../../config/db.js";
import { env } from "../../../config/env.js";
import { adminInstitutionsRepository } from "./admin.institutions.repository.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";
import { emailService } from "../../../services/email.service.js";

const PUBLIC_UPLOADS_DIR = path.resolve(process.cwd(), "public/uploads/institutions");

async function ensureUploadDir() {
  try {
    await fs.mkdir(PUBLIC_UPLOADS_DIR, { recursive: true });
  } catch (err) {
    console.error("Failed to ensure institutions upload directory:", err);
  }
}

export const adminInstitutionsService = {
  async getDashboard() {
    const stats = await adminInstitutionsRepository.getStats();
    const { institutions } = await adminInstitutionsRepository.list({ limit: 6 });
    return {
      stats,
      recentInstitutions: institutions,
    };
  },

  async list(query) {
    return adminInstitutionsRepository.list(query);
  },

  async getBankOptions(params) {
    return adminInstitutionsRepository.getBankOptions(params);
  },

  async registerBank(id, data, adminUser, reqMeta = {}) {
    const current = await adminInstitutionsRepository.getById(id);
    if (!current) {
      const err = new Error(`Institution with ID ${id} not found.`);
      err.statusCode = 404;
      throw err;
    }

    await adminInstitutionsRepository.registerBank(id, data);

    const updated = await adminInstitutionsRepository.getById(id);

    try {
      await logAdminAudit({
        userId: adminUser?.id,
        adminEmail: adminUser?.email,
        action: "institution.register",
        resourceType: "institution",
        resourceId: id,
        details: {
          name: updated.name,
          code: updated.code || updated.institution_code,
          oldStatus: current.status,
          newStatus: updated.status,
          oldPartnership: current.partnership_status,
          newPartnership: updated.partnership_status,
        },
        ip: reqMeta.ip,
        userAgent: reqMeta.userAgent,
      });
    } catch (auditErr) {
      console.warn("Audit log warning on bank register:", auditErr.message);
    }

    return updated;
  },

  async getById(id) {
    const institution = await adminInstitutionsRepository.getById(id);
    if (!institution) {
      const err = new Error("Institution not found");
      err.statusCode = 404;
      throw err;
    }
    return institution;
  },

  async create(data, adminUser, reqMeta = {}) {
    // Unique code check
    const existing = await adminInstitutionsRepository.getByCode(data.institutionCode);
    if (existing) {
      const err = new Error(`Institution code '${data.institutionCode}' is already registered.`);
      err.statusCode = 400;
      throw err;
    }

    const id = await adminInstitutionsRepository.create(data);

    // Also save bank profile if bank fields or bank type
    const bankFields = [
      "swiftCode", "swift_code",
      "officialBankCode", "official_bank_code",
      "bankCategory", "bank_category",
      "ownershipType", "ownership_type",
      "bankingModel", "banking_model",
      "regulatoryReference", "regulatory_reference",
      "officialContactPerson", "official_contact_person",
      "contactDesignation", "contact_designation",
    ];
    const hasBankFields = bankFields.some((f) => data[f] !== undefined);
    if (hasBankFields || ["bank", "commercial_bank", "specialized_bank", "digital_bank"].includes(data.institutionType)) {
      await adminInstitutionsRepository.saveBankProfile(id, {
        swiftCode: data.swiftCode ?? data.swift_code,
        officialBankCode: data.officialBankCode ?? data.official_bank_code,
        bankCategory: data.bankCategory ?? data.bank_category,
        ownershipType: data.ownershipType ?? data.ownership_type,
        bankingModel: data.bankingModel ?? data.banking_model,
        regulatoryReference: data.regulatoryReference ?? data.regulatory_reference,
        officialContactPerson: data.officialContactPerson ?? data.official_contact_person,
        contactDesignation: data.contactDesignation ?? data.contact_designation,
      });
    }

    // Also save MFS profile if MFS fields or mfs type
    const mfsFields = [
      "brandName", "brand_name",
      "legalOperatorName", "legal_operator_name",
      "providerCode", "provider_code",
      "parentBankId", "parent_bank_id",
      "authorizationReference", "authorization_reference",
      "merchantApplicationSupported", "merchant_application_supported",
      "officialContact", "official_contact",
    ];
    const hasMfsFields = mfsFields.some((f) => data[f] !== undefined);
    if (hasMfsFields || data.institutionType === "mfs") {
      await adminInstitutionsRepository.saveMfsProfile(id, {
        brandName: data.brandName ?? data.brand_name ?? data.name,
        legalOperatorName: data.legalOperatorName ?? data.legal_operator_name ?? data.legalName ?? data.name,
        providerCode: data.providerCode ?? data.provider_code ?? data.institutionCode,
        parentBankId: data.parentBankId ?? data.parent_bank_id,
        authorizationReference: data.authorizationReference ?? data.authorization_reference,
        merchantApplicationSupported: data.merchantApplicationSupported ?? data.merchant_application_supported,
        officialContact: data.officialContact ?? data.official_contact,
      });
    }

    const created = await adminInstitutionsRepository.getById(id);

    // Audit log
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.create",
      resourceType: "institution",
      resourceId: id,
      details: {
        name: created.name,
        code: created.institution_code,
        type: created.institution_type,
        status: created.status,
      },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return created;
  },

  async update(id, data, adminUser, reqMeta = {}) {
    const current = await adminInstitutionsRepository.getById(id);
    if (!current) {
      const err = new Error("Institution not found");
      err.statusCode = 404;
      throw err;
    }

    if (data.institutionCode && data.institutionCode !== current.institution_code) {
      const existing = await adminInstitutionsRepository.getByCode(data.institutionCode);
      if (existing && Number(existing.id) !== Number(id)) {
        const err = new Error(`Institution code '${data.institutionCode}' is already registered to another institution.`);
        err.statusCode = 400;
        throw err;
      }
    }

    // Map camelCase to snake_case if present
    const payload = {};
    if (data.institutionCode !== undefined || data.code !== undefined) {
      payload.institution_code = (data.institutionCode || data.code).trim().toUpperCase();
    }
    if (data.name !== undefined) payload.name = data.name.trim();
    if (data.nameBn !== undefined || data.name_bn !== undefined) {
      payload.name_bn = (data.nameBn ?? data.name_bn ?? "").trim() || null;
    }
    if (data.legalName !== undefined || data.legal_name !== undefined) {
      payload.legal_name = (data.legalName ?? data.legal_name ?? "").trim() || null;
    }
    if (data.institutionType !== undefined || data.type !== undefined) {
      payload.institution_type = data.institutionType || data.type;
    }
    if (data.logoUrl !== undefined || data.logo_url !== undefined) {
      payload.logo_url = (data.logoUrl ?? data.logo_url ?? "").trim() || null;
    }
    if (data.description !== undefined) {
      payload.description = (data.description || "").trim() || null;
    }
    if (data.websiteUrl !== undefined || data.website_url !== undefined) {
      payload.website_url = (data.websiteUrl ?? data.website_url ?? "").trim() || null;
    }
    if (data.supportEmail !== undefined || data.contactEmail !== undefined || data.support_email !== undefined) {
      payload.support_email = (data.supportEmail ?? data.contactEmail ?? data.support_email ?? "").trim() || null;
    }
    if (data.supportPhone !== undefined || data.contactPhone !== undefined || data.support_phone !== undefined) {
      payload.support_phone = (data.supportPhone ?? data.contactPhone ?? data.support_phone ?? "").trim() || null;
    }
    if (data.headOfficeAddress !== undefined || data.head_office_address !== undefined) {
      payload.head_office_address = (data.headOfficeAddress ?? data.head_office_address ?? "").trim() || null;
    }
    if (data.division !== undefined) payload.division = (data.division || "").trim() || null;
    if (data.district !== undefined) payload.district = (data.district || "").trim() || null;
    if (data.upazila !== undefined) payload.upazila = (data.upazila || "").trim() || null;
    if (data.postalCode !== undefined || data.postal_code !== undefined) {
      payload.postal_code = (data.postalCode ?? data.postal_code ?? "").trim() || null;
    }
    if (data.adminNotes !== undefined || data.admin_notes !== undefined) {
      payload.admin_notes = (data.adminNotes ?? data.admin_notes ?? "").trim() || null;
    }
    if (data.servicesOffered !== undefined || data.services_offered !== undefined) {
      payload.services_offered = (data.servicesOffered ?? data.services_offered ?? "").trim() || null;
    }
    if (data.status !== undefined) payload.status = data.status;
    if (data.directoryStatus !== undefined || data.directory_status !== undefined) {
      payload.directory_status = data.directoryStatus ?? data.directory_status;
    }
    if (data.partnershipStatus !== undefined || data.partnership_status !== undefined) {
      payload.partnership_status = data.partnershipStatus ?? data.partnership_status;
    }
    if (data.regulatoryStatus !== undefined || data.regulatory_status !== undefined) {
      payload.regulatory_status = data.regulatoryStatus ?? data.regulatory_status;
    }

    await adminInstitutionsRepository.update(id, payload);

    // Also update bank profile if bank fields were passed
    const bankFields = [
      "swiftCode", "swift_code",
      "officialBankCode", "official_bank_code",
      "bankCategory", "bank_category",
      "ownershipType", "ownership_type",
      "bankingModel", "banking_model",
      "regulatoryReference", "regulatory_reference",
      "officialContactPerson", "official_contact_person",
      "contactDesignation", "contact_designation",
    ];
    const hasBankFields = bankFields.some((f) => data[f] !== undefined);
    if (hasBankFields) {
      await adminInstitutionsRepository.saveBankProfile(id, {
        swiftCode: data.swiftCode ?? data.swift_code,
        officialBankCode: data.officialBankCode ?? data.official_bank_code,
        bankCategory: data.bankCategory ?? data.bank_category,
        ownershipType: data.ownershipType ?? data.ownership_type,
        bankingModel: data.bankingModel ?? data.banking_model,
        regulatoryReference: data.regulatoryReference ?? data.regulatory_reference,
        officialContactPerson: data.officialContactPerson ?? data.official_contact_person,
        contactDesignation: data.contactDesignation ?? data.contact_designation,
      });
    }

    // Also update MFS profile if MFS fields were passed
    const mfsFields = [
      "brandName", "brand_name",
      "legalOperatorName", "legal_operator_name",
      "providerCode", "provider_code",
      "parentBankId", "parent_bank_id",
      "authorizationReference", "authorization_reference",
      "merchantApplicationSupported", "merchant_application_supported",
      "officialContact", "official_contact",
    ];
    const hasMfsFields = mfsFields.some((f) => data[f] !== undefined);
    if (hasMfsFields) {
      await adminInstitutionsRepository.saveMfsProfile(id, {
        brandName: data.brandName ?? data.brand_name,
        legalOperatorName: data.legalOperatorName ?? data.legal_operator_name,
        providerCode: data.providerCode ?? data.provider_code,
        parentBankId: data.parentBankId ?? data.parent_bank_id,
        authorizationReference: data.authorizationReference ?? data.authorization_reference,
        merchantApplicationSupported: data.merchantApplicationSupported ?? data.merchant_application_supported,
        officialContact: data.officialContact ?? data.official_contact,
      });
    }

    const updated = await adminInstitutionsRepository.getById(id);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.update",
      resourceType: "institution",
      resourceId: id,
      details: {
        before: { name: current.name, status: current.status },
        after: { name: updated.name, status: updated.status },
      },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return updated;
  },

  async updateStatus(id, newStatus, adminUser, reqMeta = {}) {
    const validStatuses = ["draft", "active", "inactive", "suspended"];
    if (!validStatuses.includes(newStatus)) {
      const err = new Error(`Invalid institution status: ${newStatus}`);
      err.statusCode = 400;
      throw err;
    }

    return this.update(id, { status: newStatus }, adminUser, reqMeta);
  },

  async delete(id, adminUser, reqMeta = {}) {
    const institution = await adminInstitutionsRepository.getById(id);
    if (!institution) {
      const err = new Error("Institution not found");
      err.statusCode = 404;
      throw err;
    }

    const deps = await adminInstitutionsRepository.getDependencies(id);
    if (deps.usersCount > 0 || deps.servicesCount > 0 || deps.applicationsCount > 0 || deps.branchesCount > 0) {
      const reasons = [];
      if (deps.usersCount > 0) reasons.push(`${deps.usersCount} staff user(s)`);
      if (deps.servicesCount > 0) reasons.push(`${deps.servicesCount} service(s)`);
      if (deps.applicationsCount > 0) reasons.push(`${deps.applicationsCount} linked application(s)`);
      if (deps.branchesCount > 0) reasons.push(`${deps.branchesCount} branch(es)`);

      const err = new Error(
        `Cannot permanently delete institution with associated records (${reasons.join(", ")}). Please deactivate or suspend the institution instead to preserve audit history.`
      );
      err.statusCode = 409;
      throw err;
    }

    await adminInstitutionsRepository.delete(id);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.delete",
      resourceType: "institution",
      resourceId: id,
      details: { name: institution.name, code: institution.institution_code },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true, message: "Institution safely deleted." };
  },

  async uploadLogo(file) {
    if (!file) {
      const err = new Error("No image file uploaded");
      err.statusCode = 400;
      throw err;
    }

    await ensureUploadDir();

    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    const randomHex = crypto.randomBytes(8).toString("hex");
    const safeFilename = `inst_${Date.now()}_${randomHex}${ext}`;
    const destinationPath = path.join(PUBLIC_UPLOADS_DIR, safeFilename);

    await fs.writeFile(destinationPath, file.buffer);

    const publicUrl = `/uploads/institutions/${safeFilename}`;
    return {
      filename: safeFilename,
      url: publicUrl,
    };
  },

  /* ========================================================================
     SERVICES MODULE
     ======================================================================== */

  async listServices(query) {
    return adminInstitutionsRepository.listServices(query);
  },

  async getServiceById(gatewayId) {
    const service = await adminInstitutionsRepository.getServiceById(gatewayId);
    if (!service) {
      const err = new Error("Service not found");
      err.statusCode = 404;
      throw err;
    }
    return service;
  },

  async createService(data, adminUser, reqMeta = {}) {
    const service = await adminInstitutionsRepository.createService(data);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.service.create",
      resourceType: "institution_service",
      resourceId: service.id,
      details: { name: service.name, code: service.code, institutionId: service.institution_id },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return service;
  },

  async updateService(gatewayId, data, adminUser, reqMeta = {}) {
    const service = await adminInstitutionsRepository.updateService(gatewayId, data);
    if (!service) {
      const err = new Error("Service not found");
      err.statusCode = 404;
      throw err;
    }

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.service.update",
      resourceType: "institution_service",
      resourceId: gatewayId,
      details: { name: service.name, code: service.code },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return service;
  },

  async testServiceConnection(gatewayId, adminUser, reqMeta = {}) {
    const result = await adminInstitutionsRepository.testServiceConnection(gatewayId);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.service.test_connection",
      resourceType: "institution_service",
      resourceId: gatewayId,
      details: result,
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return result;
  },

  async associateService(gatewayId, institutionId, adminUser, reqMeta = {}) {
    const institution = await adminInstitutionsRepository.getById(institutionId);
    if (!institution) {
      const err = new Error("Institution not found");
      err.statusCode = 404;
      throw err;
    }

    await adminInstitutionsRepository.associateService(gatewayId, institutionId);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.service.associate",
      resourceType: "institution_service",
      resourceId: gatewayId,
      details: { institutionId, institutionName: institution.name },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true, message: `Service linked to ${institution.name}` };
  },

  async disassociateService(gatewayId, adminUser, reqMeta = {}) {
    await adminInstitutionsRepository.disassociateService(gatewayId);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.service.disassociate",
      resourceType: "institution_service",
      resourceId: gatewayId,
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true, message: "Service unlinked from institution" };
  },

  /* ========================================================================
     STAFF PROVISIONING & MEMBERSHIP
     ======================================================================== */

  async listStaff(query) {
    return adminInstitutionsRepository.listStaff(query);
  },

  async provisionStaff(
    { institutionId, name = null, fullName = null, email, phone = null, password, roleName = null, role = null, membershipStatus = "active" },
    adminUser,
    reqMeta = {}
  ) {
    const institution = await adminInstitutionsRepository.getById(institutionId);
    if (!institution) {
      const err = new Error("Institution not found");
      err.statusCode = 404;
      throw err;
    }

    const assignedRole = roleName || role;
    const staffName = name || fullName;

    const validRoles = ["bank_admin", "bank_reviewer", "bank_operations"];
    if (!validRoles.includes(assignedRole)) {
      const err = new Error(`Invalid institution role. Must be one of: ${validRoles.join(", ")}`);
      err.statusCode = 400;
      throw err;
    }

    const [roleRows] = await db.query(`SELECT id, name FROM roles WHERE name = ? LIMIT 1`, [assignedRole]);
    if (!roleRows.length) {
      const err = new Error(`Role ${roleName} does not exist in system roles`);
      err.statusCode = 404;
      throw err;
    }
    const roleId = roleRows[0].id;

    // Execute in a database transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 1. Check if user already exists by email or phone
      const checkConds = ["email = ?"];
      const checkParams = [email.trim().toLowerCase()];
      if (phone && phone.trim()) {
        checkConds.push("phone = ?");
        checkParams.push(phone.trim());
      }

      const [existingUsers] = await connection.query(
        `SELECT id, email, phone, status FROM users WHERE ${checkConds.join(" OR ")} LIMIT 1`,
        checkParams
      );

      let userId;

      if (existingUsers.length > 0) {
        const err = new Error(`An account with email '${email}' already exists in the system.`);
        err.statusCode = 409;
        throw err;
      } else {
        // Create new user for this staff member (no email/phone OTP required for direct bank accounts)
        const passwordHash = await argon2.hash(password);

        const [userInsert] = await connection.execute(
          `
          INSERT INTO users (email, phone, password_hash, email_verified_at, phone_verified_at, status, must_change_password, created_at, updated_at)
          VALUES (?, ?, ?, NOW(), NOW(), 'active', 1, NOW(), NOW())
          `,
          [email.trim().toLowerCase(), phone ? phone.trim() : null, passwordHash]
        );
        userId = userInsert.insertId;
      }

      // Check if active membership already exists
      const [existingMemberships] = await connection.query(
        `SELECT id FROM institution_users WHERE institution_id = ? AND user_id = ? AND membership_status = 'active' LIMIT 1`,
        [institutionId, userId]
      );
      if (existingMemberships.length > 0) {
        const err = new Error("User already has an active membership in this institution");
        err.statusCode = 409;
        throw err;
      }

      // 2. Assign institution membership (Bank roles belong solely in institution_users, NOT user_roles)
      const [iuInsert] = await connection.execute(
        `
        INSERT INTO institution_users
          (institution_id, user_id, staff_name, role_id, membership_status, created_by_user_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [institutionId, userId, staffName ? staffName.trim() : null, roleId, membershipStatus, adminUser?.id || null]
      );

      await connection.commit();

      await logAdminAudit({
        userId: adminUser?.id,
        adminEmail: adminUser?.email,
        action: "institution.user.provision",
        resourceType: "institution_user",
        resourceId: iuInsert.insertId,
        details: {
          institutionId,
          institutionName: institution.name,
          name: staffName ? staffName.trim() : null,
          email,
          role: assignedRole,
          status: membershipStatus,
        },
        ip: reqMeta.ip,
        userAgent: reqMeta.userAgent,
      });

      return {
        membershipId: iuInsert.insertId,
        userId,
        name: staffName ? staffName.trim() : null,
        email,
        roleName: assignedRole,
        role: assignedRole,
        membershipStatus,
        directCreation: true,
      };
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  },

  async updateStaffMembership(membershipId, { roleName, membershipStatus }, adminUser, reqMeta = {}) {
    const validMembershipId = Number(membershipId);
    if (!Number.isSafeInteger(validMembershipId) || validMembershipId <= 0) {
      const err = new Error("Invalid staff membership ID");
      err.statusCode = 400;
      throw err;
    }
    if (membershipStatus !== undefined && !["active", "inactive", "suspended", "invited"].includes(membershipStatus)) {
      const err = new Error("Invalid staff membership status");
      err.statusCode = 400;
      throw err;
    }

    const membership = await adminInstitutionsRepository.getStaffMembership(validMembershipId);
    if (!membership) {
      const err = new Error("Staff membership record not found");
      err.statusCode = 404;
      throw err;
    }

    let roleId = null;
    if (roleName) {
      const [roleRows] = await db.query(`SELECT id FROM roles WHERE name = ? LIMIT 1`, [roleName]);
      if (!roleRows.length) {
        const err = new Error(`Role ${roleName} does not exist`);
        err.statusCode = 400;
        throw err;
      }
      roleId = roleRows[0].id;
    }

    await adminInstitutionsRepository.updateStaffMembership(validMembershipId, {
      roleId,
      membershipStatus,
    });

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.user.update",
      resourceType: "institution_user",
      resourceId: validMembershipId,
      details: { roleName, membershipStatus },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true, message: "Staff membership updated successfully" };
  },

  /* ========================================================================
     KYC REQUIREMENTS MODULE
     ======================================================================== */

  async listKycRequirements(query) {
    return adminInstitutionsRepository.listKycRequirements(query);
  },

  async getKycRequirementById(id) {
    const requirement = await adminInstitutionsRepository.getKycRequirementById(id);
    if (!requirement) {
      const err = new Error("KYC requirement not found");
      err.statusCode = 404;
      throw err;
    }
    return requirement;
  },

  async getRelatedKycRequirements(query) {
    return adminInstitutionsRepository.getRelatedKycRequirements(query);
  },

  async uploadSampleDocument(file) {
    if (!file) {
      const err = new Error("No sample document or image uploaded");
      err.statusCode = 400;
      throw err;
    }

    const samplesDir = path.join(PUBLIC_UPLOADS_DIR, "samples");
    await fs.mkdir(samplesDir, { recursive: true });

    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    const randomHex = crypto.randomBytes(8).toString("hex");
    const safeFilename = `sample_${Date.now()}_${randomHex}${ext}`;
    const destinationPath = path.join(samplesDir, safeFilename);

    await fs.writeFile(destinationPath, file.buffer);

    const publicUrl = `/uploads/institutions/samples/${safeFilename}`;
    return {
      filename: safeFilename,
      url: publicUrl,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  },

  async createKycRequirement(data, adminUser, reqMeta = {}) {
    const id = await adminInstitutionsRepository.createKycRequirement(data);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.kyc_requirement.create",
      resourceType: "institution_kyc_requirement",
      resourceId: id,
      details: { name: data.name, institutionId: data.institutionId },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { id, ...data };
  },

  async updateKycRequirement(id, data, adminUser, reqMeta = {}) {
    await adminInstitutionsRepository.updateKycRequirement(id, data);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.kyc_requirement.update",
      resourceType: "institution_kyc_requirement",
      resourceId: id,
      details: data,
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true };
  },

  async deleteKycRequirement(id, adminUser, reqMeta = {}) {
    await adminInstitutionsRepository.deleteKycRequirement(id);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.kyc_requirement.delete",
      resourceType: "institution_kyc_requirement",
      resourceId: id,
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true };
  },

  /* ========================================================================
     SETTINGS MODULE
     ======================================================================== */

  async getSettings(institutionId) {
    const institution = await adminInstitutionsRepository.getById(institutionId);
    if (!institution) {
      const err = new Error("Institution not found");
      err.statusCode = 404;
      throw err;
    }

    const settings = await adminInstitutionsRepository.getSettings(institutionId);
    return {
      institution,
      settings,
    };
  },

  async saveSettings(institutionId, settingsPayload, adminUser, reqMeta = {}) {
    const institution = await adminInstitutionsRepository.getById(institutionId);
    if (!institution) {
      const err = new Error("Institution not found");
      err.statusCode = 404;
      throw err;
    }

    const sla = Number(
      settingsPayload.sla_hours !== undefined
        ? settingsPayload.sla_hours
        : settingsPayload.kyc_review_sla_hours !== undefined
        ? settingsPayload.kyc_review_sla_hours
        : 48
    );

    const branchPolicy =
      settingsPayload.branch_routing_policy ||
      settingsPayload.branch_policy ||
      "merchant_selects_branch";

    const escalationEmail =
      settingsPayload.escalation_email !== undefined && settingsPayload.escalation_email !== null
        ? String(settingsPayload.escalation_email).trim()
        : settingsPayload.escalationEmail !== undefined && settingsPayload.escalationEmail !== null
        ? String(settingsPayload.escalationEmail).trim()
        : "";

    const payloadToSave = {
      ...settingsPayload,
      sla_hours: sla,
      kyc_review_sla_hours: sla,
      branch_policy: branchPolicy,
      branch_routing_policy: branchPolicy,
      escalation_email: escalationEmail,
      operations_escalation_email: escalationEmail,
    };

    await adminInstitutionsRepository.saveSettings(
      institutionId,
      payloadToSave,
      adminUser?.email || "Admin"
    );

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.settings.update",
      resourceType: "institution",
      resourceId: institutionId,
      details: {
        sla_hours: sla,
        branch_routing_policy: branchPolicy,
        escalation_email: escalationEmail,
        updatedKeys: Object.keys(payloadToSave),
      },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    const updated = await adminInstitutionsRepository.getSettings(institutionId);

    return {
      success: true,
      message: "Institution operational settings saved successfully",
      data: {
        institution,
        settings: updated,
      },
    };
  },
  /* ========================================================================
     BRANCHES & LOCATIONS MODULE
     ======================================================================== */

  async getBranchStats(institutionId) {
    return adminInstitutionsRepository.getBranchStats(institutionId);
  },

  async listBranches(institutionId, query) {
    return adminInstitutionsRepository.listBranches(institutionId, query);
  },

  async getBranchById(branchId) {
    const branch = await adminInstitutionsRepository.getBranchById(branchId);
    if (!branch) {
      const err = new Error("Branch not found");
      err.statusCode = 404;
      throw err;
    }
    return branch;
  },

  async createBranch(data, adminUser, reqMeta = {}) {
    // Check if code is already taken for this institution
    const existing = await adminInstitutionsRepository.getBranchByCode(data.institutionId, data.branchCode);
    if (existing) {
      const err = new Error(`Branch code '${data.branchCode}' is already registered for this institution.`);
      err.statusCode = 400;
      throw err;
    }

    // Validate routing number if provided
    if (data.routingNumber && !/^\d{9}$/.test(String(data.routingNumber).trim())) {
      const err = new Error("Routing number must be exactly 9 numeric digits.");
      err.statusCode = 400;
      throw err;
    }

    // Validate Bangladesh geographic hierarchy
    const geoCheck = await adminInstitutionsRepository.validateGeoHierarchy(
      data.division,
      data.district,
      data.upazila
    );
    if (!geoCheck.valid) {
      const err = new Error(geoCheck.message);
      err.statusCode = 400;
      throw err;
    }

    const payload = {
      ...data,
      divisionId: geoCheck.geoIds?.division_id || null,
      districtId: geoCheck.geoIds?.district_id || null,
      upazilaId: geoCheck.geoIds?.upazila_id || null,
    };

    const id = await adminInstitutionsRepository.createBranch(payload);
    const branch = await adminInstitutionsRepository.getBranchById(id);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.branch.create",
      resourceType: "institution_branch",
      resourceId: id,
      details: {
        institutionId: data.institutionId,
        branchName: data.branchName,
        branchCode: data.branchCode,
        routingNumber: data.routingNumber,
        division: data.division,
        district: data.district,
      },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return branch;
  },

  async updateBranch(branchId, data, adminUser, reqMeta = {}) {
    const current = await adminInstitutionsRepository.getBranchById(branchId);
    if (!current) {
      const err = new Error("Branch not found");
      err.statusCode = 404;
      throw err;
    }

    if (data.branchCode && data.branchCode !== current.branch_code) {
      const existing = await adminInstitutionsRepository.getBranchByCode(current.institution_id, data.branchCode);
      if (existing && Number(existing.id) !== Number(branchId)) {
        const err = new Error(`Branch code '${data.branchCode}' is already used by another branch in this institution.`);
        err.statusCode = 400;
        throw err;
      }
    }

    // Validate routing number if provided
    if (data.routingNumber !== undefined && data.routingNumber !== null && data.routingNumber !== "") {
      if (!/^\d{9}$/.test(String(data.routingNumber).trim())) {
        const err = new Error("Routing number must be exactly 9 numeric digits.");
        err.statusCode = 400;
        throw err;
      }
    }

    // Validate geo hierarchy if location fields changed
    const targetDivision = data.division || current.division;
    const targetDistrict = data.district || current.district;
    const targetUpazila = data.upazila || current.upazila;

    if (data.division || data.district || data.upazila) {
      const geoCheck = await adminInstitutionsRepository.validateGeoHierarchy(
        targetDivision,
        targetDistrict,
        targetUpazila
      );
      if (!geoCheck.valid) {
        const err = new Error(geoCheck.message);
        err.statusCode = 400;
        throw err;
      }
      data.divisionId = geoCheck.geoIds?.division_id || null;
      data.districtId = geoCheck.geoIds?.district_id || null;
      data.upazilaId = geoCheck.geoIds?.upazila_id || null;
    }

    await adminInstitutionsRepository.updateBranch(branchId, data);
    const updated = await adminInstitutionsRepository.getBranchById(branchId);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.branch.update",
      resourceType: "institution_branch",
      resourceId: branchId,
      details: {
        branchName: updated.branch_name,
        branchCode: updated.branch_code,
      },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return updated;
  },

  async updateBranchStatus(branchId, status, adminUser, reqMeta = {}) {
    const current = await adminInstitutionsRepository.getBranchById(branchId);
    if (!current) {
      const err = new Error("Branch not found");
      err.statusCode = 404;
      throw err;
    }

    await adminInstitutionsRepository.updateBranchStatus(branchId, status);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.branch.status",
      resourceType: "institution_branch",
      resourceId: branchId,
      details: { previousStatus: current.status, newStatus: status },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true, message: `Branch status updated to ${status}` };
  },

  async archiveBranch(branchId, adminUser, reqMeta = {}) {
    const current = await adminInstitutionsRepository.getBranchById(branchId);
    if (!current) {
      const err = new Error("Branch not found");
      err.statusCode = 404;
      throw err;
    }

    await adminInstitutionsRepository.archiveBranch(branchId, adminUser?.email || "Admin");

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.branch.archive",
      resourceType: "institution_branch",
      resourceId: branchId,
      details: { branchName: current.branch_name, branchCode: current.branch_code },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true, message: `Branch "${current.branch_name}" archived successfully.` };
  },

  async toggleDemoBranch(branchId, isDemo, adminUser, reqMeta = {}) {
    const current = await adminInstitutionsRepository.getBranchById(branchId);
    if (!current) {
      const err = new Error("Branch not found");
      err.statusCode = 404;
      throw err;
    }

    await adminInstitutionsRepository.toggleDemoBranch(branchId, isDemo);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.branch.toggle_demo",
      resourceType: "institution_branch",
      resourceId: branchId,
      details: { isDemo },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true, message: `Branch "${current.branch_name}" demo flag set to ${isDemo}.` };
  },

  async deleteBranch(branchId, adminUser, reqMeta = {}) {
    const current = await adminInstitutionsRepository.getBranchById(branchId);
    if (!current) {
      const err = new Error("Branch not found");
      err.statusCode = 404;
      throw err;
    }

    await adminInstitutionsRepository.deleteBranch(branchId);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.branch.delete",
      resourceType: "institution_branch",
      resourceId: branchId,
      details: { branchName: current.branch_name, branchCode: current.branch_code },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true, message: "Branch deleted successfully" };
  },

  async exportBranchesCsv(institutionId) {
    const result = await adminInstitutionsRepository.listBranches(institutionId, {
      division: "all",
      district: "all",
      upazila: "all",
      status: "all",
      demoFilter: "all",
      includeArchived: false,
      search: "",
      page: 1,
      limit: 10000,
    });

    const rows = result.branches || [];
    const headers = [
      "Branch ID",
      "Branch Name",
      "Branch Code",
      "Routing Number",
      "Division",
      "District",
      "Upazila",
      "Post Office",
      "Postal Code",
      "Address",
      "Phone",
      "Email",
      "Manager Name",
      "Status",
      "Is Demo",
      "Created At",
    ];

    const csvLines = [headers.join(",")];
    for (const b of rows) {
      const escape = (val) => {
        if (val === null || val === undefined) return '""';
        const str = String(val).replace(/"/g, '""');
        return `"${str}"`;
      };

      csvLines.push([
        escape(b.id),
        escape(b.branch_name),
        escape(b.branch_code),
        escape(b.routing_number || ""),
        escape(b.division),
        escape(b.district),
        escape(b.upazila),
        escape(b.post_office || ""),
        escape(b.postal_code || ""),
        escape(b.address || ""),
        escape(b.phone || ""),
        escape(b.email || ""),
        escape(b.manager_name || ""),
        escape(b.status),
        escape(b.is_demo ? "Yes" : "No"),
        escape(b.created_at),
      ].join(","));
    }

    return csvLines.join("\r\n");
  },

  /* ========================================================================
     GEOGRAPHIC MASTER DATA
     ======================================================================== */

  async getGeoDivisions() {
    return adminInstitutionsRepository.getGeoDivisions();
  },

  async getGeoDistricts(divisionIdOrName) {
    return adminInstitutionsRepository.getGeoDistricts(divisionIdOrName);
  },

  async getGeoUpazilas(districtIdOrName) {
    return adminInstitutionsRepository.getGeoUpazilas(districtIdOrName);
  },

  /* ========================================================================
     APPLICATIONS MODULE
     ======================================================================== */

  async listInstitutionApplications(institutionId, query) {
    return adminInstitutionsRepository.listInstitutionApplications(institutionId, query);
  },

  async getInstitutionApplicationStats(institutionId) {
    return adminInstitutionsRepository.getInstitutionApplicationStats(institutionId);
  },

  /* ========================================================================
     ACTIVE PUBLIC / MERCHANT LOOKUPS
     ======================================================================== */

  async getActiveInstitutions() {
    return adminInstitutionsRepository.getActiveInstitutions();
  },

  async getActiveBranchesForInstitution(institutionId) {
    return adminInstitutionsRepository.getActiveBranchesForInstitution(institutionId);
  },

  /* ========================================================================
     PROFILES & DIRECTORY
     ======================================================================== */

  async getBankProfile(institutionId) {
    return adminInstitutionsRepository.getBankProfile(institutionId);
  },

  async saveBankProfile(institutionId, data, adminUser, reqMeta = {}) {
    const institution = await adminInstitutionsRepository.getById(institutionId);
    if (!institution) {
      const err = new Error("Institution not found");
      err.statusCode = 404;
      throw err;
    }

    const updated = await adminInstitutionsRepository.saveBankProfile(institutionId, data);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.bank_profile_update",
      resourceType: "institution",
      resourceId: institutionId,
      details: data,
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return updated;
  },

  async getMfsProfile(institutionId) {
    return adminInstitutionsRepository.getMfsProfile(institutionId);
  },

  async saveMfsProfile(institutionId, data, adminUser, reqMeta = {}) {
    const institution = await adminInstitutionsRepository.getById(institutionId);
    if (!institution) {
      const err = new Error("Institution not found");
      err.statusCode = 404;
      throw err;
    }

    const updated = await adminInstitutionsRepository.saveMfsProfile(institutionId, data);

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.mfs_profile_update",
      resourceType: "institution",
      resourceId: institutionId,
      details: data,
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return updated;
  },

  async updateDirectoryVerification(institutionId, data, adminUser, reqMeta = {}) {
    const institution = await adminInstitutionsRepository.getById(institutionId);
    if (!institution) {
      const err = new Error("Institution not found");
      err.statusCode = 404;
      throw err;
    }

    const payload = {
      directoryStatus: data.directoryStatus || data.directory_status,
      partnershipStatus: data.partnershipStatus || data.partnership_status,
      regulatoryStatus: data.regulatoryStatus || data.regulatory_status,
    };

    await adminInstitutionsRepository.update(institutionId, payload);
    return adminInstitutionsRepository.getById(institutionId);
  },

  /* ========================================================================
     STAFF INVITATIONS MODULE
     ======================================================================== */

  async inviteStaff({ institutionId, name = null, email, phone = null, roleName }, adminUser, reqMeta = {}) {
    const validInstId = Number(institutionId);
    const institution = await adminInstitutionsRepository.getById(validInstId);
    if (!institution) {
      const err = new Error("Institution not found");
      err.statusCode = 404;
      throw err;
    }

    const validRoles = ["bank_admin", "bank_reviewer", "bank_operations"];
    if (!validRoles.includes(roleName)) {
      const err = new Error(`Invalid institution role. Must be one of: ${validRoles.join(", ")}`);
      err.statusCode = 400;
      throw err;
    }

    const [roleRows] = await db.query(`SELECT id, name FROM roles WHERE name = ? LIMIT 1`, [roleName]);
    if (!roleRows.length) {
      const err = new Error(`Role '${roleName}' not found in database.`);
      err.statusCode = 500;
      throw err;
    }
    const roleId = roleRows[0].id;
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone ? phone.trim() : null;
    const cleanName = name ? name.trim() : null;

    // Check if user already exists
    const [existingUsers] = await db.query(
      `SELECT id, email, status FROM users WHERE email = ? LIMIT 1`,
      [cleanEmail]
    );

    if (existingUsers.length > 0) {
      const existingUser = existingUsers[0];
      // Check if already active member in this institution
      const [memberships] = await db.query(
        `SELECT id, membership_status FROM institution_users WHERE user_id = ? AND institution_id = ? LIMIT 1`,
        [existingUser.id, validInstId]
      );
      if (memberships.length > 0 && memberships[0].membership_status === "active") {
        const err = new Error(`User '${cleanEmail}' already has an active staff account in ${institution.name}.`);
        err.statusCode = 400;
        throw err;
      }
    }

    // Generate secure 32-byte (64 hex chars) token and sha256 hash
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Revoke previous pending invitations for this email + institution
    await adminInstitutionsRepository.revokePendingInvitationsForEmail(validInstId, cleanEmail);

    // Create new invitation
    const invitationId = await adminInstitutionsRepository.createInvitation({
      institutionId: validInstId,
      email: cleanEmail,
      name: cleanName,
      phone: cleanPhone,
      roleId,
      tokenHash,
      expiresAt,
      invitedByUserId: adminUser?.id || null,
    });

    const frontendBase = env?.frontendUrls?.[0] || "http://localhost:5173";
    const invitationUrl = `${frontendBase}/bank/activate?token=${rawToken}`;

    // Attempt email delivery via SMTP configuration
    let emailStatus = { success: false, delivered: false, message: "Email delivery not attempted" };
    try {
      emailStatus = await emailService.sendInstitutionInvitationEmail({
        to: cleanEmail,
        name: cleanName,
        institutionName: institution.name,
        roleName,
        invitationUrl,
        expiresDays: 7,
      });
    } catch (e) {
      console.warn("Could not dispatch invitation email:", e.message);
      emailStatus = { success: false, delivered: false, error: e.message, message: e.message };
    }

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.staff_invite",
      resourceType: "institution_invitation",
      resourceId: invitationId,
      details: {
        institutionId: validInstId,
        institutionName: institution.name,
        email: cleanEmail,
        roleName,
        expiresAt,
        emailDelivered: Boolean(emailStatus.delivered),
      },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return {
      invitationId,
      institutionId: validInstId,
      institutionName: institution.name,
      email: cleanEmail,
      name: cleanName,
      roleName,
      expiresAt,
      invitationToken: rawToken,
      invitationUrl,
      emailDelivered: Boolean(emailStatus.delivered),
      emailMessage: emailStatus.message,
      message: emailStatus.delivered
        ? `Invitation successfully sent via email to ${cleanEmail}`
        : `Invitation created for ${cleanEmail}. (SMTP delivery: ${emailStatus.message})`,
    };
  },

  async listInvitations(query = {}) {
    return adminInstitutionsRepository.listInvitations(query);
  },

  async resendInvitation(invitationId, adminUser, reqMeta = {}) {
    const invitation = await adminInstitutionsRepository.getInvitationById(invitationId);
    if (!invitation) {
      const err = new Error("Invitation not found");
      err.statusCode = 404;
      throw err;
    }
    if (invitation.status === "accepted") {
      const err = new Error("Invitation has already been accepted");
      err.statusCode = 400;
      throw err;
    }

    await adminInstitutionsRepository.updateInvitationStatus(invitationId, "revoked");

    return this.inviteStaff(
      {
        institutionId: invitation.institution_id,
        email: invitation.email,
        name: invitation.name,
        phone: invitation.phone,
        roleName: invitation.role_name,
      },
      adminUser,
      reqMeta
    );
  },

  async revokeInvitation(invitationId, adminUser, reqMeta = {}) {
    const invitation = await adminInstitutionsRepository.getInvitationById(invitationId);
    if (!invitation) {
      const err = new Error("Invitation not found");
      err.statusCode = 404;
      throw err;
    }
    if (invitation.status === "accepted") {
      const err = new Error("Cannot revoke an already accepted invitation");
      err.statusCode = 400;
      throw err;
    }

    await adminInstitutionsRepository.updateInvitationStatus(invitationId, "revoked");

    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "institution.staff_invite_revoke",
      resourceType: "institution_invitation",
      resourceId: invitationId,
      details: { email: invitation.email, institutionId: invitation.institution_id },
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
    });

    return { success: true, message: "Invitation revoked successfully" };
  },
};


