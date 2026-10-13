import { db } from "../src/config/db.js";

async function run() {
  console.log("Starting Migration 005: Full Admin Tables & Seeds...");

  // 1. Audit Logs Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NULL,
      admin_email VARCHAR(255) NULL,
      action VARCHAR(100) NOT NULL,
      resource_type VARCHAR(100) NOT NULL,
      resource_id VARCHAR(100) NULL,
      merchant_id BIGINT UNSIGNED NULL,
      details JSON NULL,
      ip_address VARCHAR(45) NULL,
      user_agent TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_action (action),
      INDEX idx_audit_merchant_id (merchant_id),
      INDEX idx_audit_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✅ audit_logs table ready");

  // 2. Gateways Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS gateways (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      code VARCHAR(50) NOT NULL UNIQUE,
      logo_url VARCHAR(500) NULL,
      description TEXT NULL,
      supported_methods JSON NULL,
      service_type VARCHAR(100) NOT NULL DEFAULT 'Payment Gateway',
      qr_supported TINYINT(1) NOT NULL DEFAULT 1,
      card_supported TINYINT(1) NOT NULL DEFAULT 0,
      mobile_supported TINYINT(1) NOT NULL DEFAULT 1,
      api_supported TINYINT(1) NOT NULL DEFAULT 1,
      required_documents JSON NULL,
      service_fee DECIMAL(6,2) NOT NULL DEFAULT 1.50,
      setup_fee DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      status ENUM('active', 'inactive', 'draft') NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_gateways_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✅ gateways table ready");

  // 3. Merchant Gateway Applications Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS merchant_gateway_applications (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      merchant_id BIGINT UNSIGNED NOT NULL,
      gateway_id BIGINT UNSIGNED NOT NULL,
      status ENUM('applied', 'under_review', 'approved', 'rejected', 'additional_information_required') NOT NULL DEFAULT 'applied',
      review_note TEXT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_mga_merchant_id (merchant_id),
      INDEX idx_mga_gateway_id (gateway_id),
      INDEX idx_mga_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✅ merchant_gateway_applications table ready");

  // 4. Merchant Gateway Services Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS merchant_gateway_services (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      merchant_id BIGINT UNSIGNED NOT NULL,
      gateway_id BIGINT UNSIGNED NOT NULL,
      service_type VARCHAR(100) NOT NULL DEFAULT 'BanglaQR Interoperable',
      configuration JSON NULL,
      status ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
      activated_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_mgs_merchant_id (merchant_id),
      INDEX idx_mgs_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✅ merchant_gateway_services table ready");

  // 5. Addons Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS addons (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      code VARCHAR(50) NOT NULL UNIQUE,
      description TEXT NULL,
      category VARCHAR(100) NOT NULL DEFAULT 'Operations',
      pricing_type ENUM('free', 'one_time', 'monthly', 'per_transaction') NOT NULL DEFAULT 'monthly',
      price DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      billing_cycle VARCHAR(50) NOT NULL DEFAULT 'Monthly',
      requirements TEXT NULL,
      status ENUM('available', 'inactive', 'draft') NOT NULL DEFAULT 'available',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_addons_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✅ addons table ready");

  // 6. Merchant Addons Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS merchant_addons (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      merchant_id BIGINT UNSIGNED NOT NULL,
      addon_id BIGINT UNSIGNED NOT NULL,
      status ENUM('applied', 'under_review', 'approved', 'activated', 'suspended', 'closed') NOT NULL DEFAULT 'applied',
      configuration JSON NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      activated_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ma_merchant_id (merchant_id),
      INDEX idx_ma_addon_id (addon_id),
      INDEX idx_ma_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✅ merchant_addons table ready");

  // 7. Invoices Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS invoices (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      invoice_number VARCHAR(100) NOT NULL UNIQUE,
      merchant_id BIGINT UNSIGNED NOT NULL,
      customer_name VARCHAR(255) NOT NULL,
      customer_email VARCHAR(255) NOT NULL,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      currency VARCHAR(10) NOT NULL DEFAULT 'BDT',
      issue_date DATE NOT NULL,
      due_date DATE NOT NULL,
      status ENUM('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled') NOT NULL DEFAULT 'draft',
      payment_reference VARCHAR(150) NULL,
      items JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_invoices_merchant_id (merchant_id),
      INDEX idx_invoices_status (status),
      INDEX idx_invoices_number (invoice_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✅ invoices table ready");

  // 8. Support Tickets Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS support_tickets (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      ticket_number VARCHAR(50) NOT NULL UNIQUE,
      merchant_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NULL,
      assigned_agent_id BIGINT UNSIGNED NULL,
      subject VARCHAR(255) NOT NULL,
      priority ENUM('low', 'medium', 'high', 'urgent') NOT NULL DEFAULT 'medium',
      status ENUM('open', 'in_progress', 'waiting_for_merchant', 'resolved', 'closed') NOT NULL DEFAULT 'open',
      category VARCHAR(100) NOT NULL DEFAULT 'General Inquiries',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tickets_merchant_id (merchant_id),
      INDEX idx_tickets_status (status),
      INDEX idx_tickets_priority (priority)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✅ support_tickets table ready");

  // 9. Support Ticket Messages Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS support_ticket_messages (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      ticket_id BIGINT UNSIGNED NOT NULL,
      sender_id BIGINT UNSIGNED NULL,
      sender_type ENUM('admin', 'merchant', 'system') NOT NULL DEFAULT 'merchant',
      message TEXT NOT NULL,
      attachments JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_stm_ticket_id (ticket_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✅ support_ticket_messages table ready");

  // 10. Notifications Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      recipient_id BIGINT UNSIGNED NULL,
      recipient_type ENUM('admin', 'merchant', 'all') NOT NULL DEFAULT 'admin',
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type ENUM('system', 'merchant_update', 'kyc', 'document', 'gateway', 'security') NOT NULL DEFAULT 'system',
      link VARCHAR(500) NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notif_recipient (recipient_type, recipient_id),
      INDEX idx_notif_read (is_read),
      INDEX idx_notif_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✅ notifications table ready");

  // 11. Admin Settings Table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS admin_settings (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(100) NOT NULL UNIQUE,
      setting_value JSON NOT NULL,
      category VARCHAR(50) NOT NULL DEFAULT 'general',
      updated_by VARCHAR(255) NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_settings_key (setting_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✅ admin_settings table ready");

  // Seed Default Gateways if empty
  const [gatewayRows] = await db.execute("SELECT COUNT(*) AS count FROM gateways");
  if (gatewayRows[0].count === 0) {
    const seedGateways = [
      {
        name: "bKash BanglaQR & Direct Gateway",
        code: "BKASH_DIRECT",
        description: "Direct merchant payment collection and dynamic QR integration with bKash network.",
        supported_methods: JSON.stringify(["BanglaQR", "bKash App", "USSD", "Tokenized Checkout"]),
        service_type: "MFS Gateway",
        qr_supported: 1,
        card_supported: 0,
        mobile_supported: 1,
        api_supported: 1,
        required_documents: JSON.stringify(["NID_FRONT", "NID_BACK", "TRADE_LICENSE", "CANCELLED_BANK_CHEQUE"]),
        service_fee: 1.20,
        setup_fee: 0.00,
        status: "active",
      },
      {
        name: "Nagad BanglaQR Payment Gateway",
        code: "NAGAD_DIRECT",
        description: "Post-Office digital banking and BanglaQR collection service via Nagad.",
        supported_methods: JSON.stringify(["BanglaQR", "Nagad App", "USSD"]),
        service_type: "MFS Gateway",
        qr_supported: 1,
        card_supported: 0,
        mobile_supported: 1,
        api_supported: 1,
        required_documents: JSON.stringify(["NID_FRONT", "NID_BACK", "TIN_CERTIFICATE", "CANCELLED_BANK_CHEQUE"]),
        service_fee: 1.00,
        setup_fee: 0.00,
        status: "active",
      },
      {
        name: "Rocket (DBBL) Interoperable Gateway",
        code: "ROCKET_DBBL",
        description: "Dutch-Bangla Bank Rocket mobile banking and interoperable BanglaQR acquiring.",
        supported_methods: JSON.stringify(["BanglaQR", "Rocket App", "NexusPay"]),
        service_type: "Bank MFS",
        qr_supported: 1,
        card_supported: 1,
        mobile_supported: 1,
        api_supported: 1,
        required_documents: JSON.stringify(["NID_FRONT", "TRADE_LICENSE", "CANCELLED_BANK_CHEQUE"]),
        service_fee: 1.10,
        setup_fee: 500.00,
        status: "active",
      },
      {
        name: "Visa & Mastercard BanglaQR Acquiring",
        code: "CARD_ACQUIRER_UNION",
        description: "National Payment Switch Bangladesh (NPSB) card-based BanglaQR acquiring network.",
        supported_methods: JSON.stringify(["Visa QR", "Mastercard QR", "Debit/Credit Cards"]),
        service_type: "Card Network",
        qr_supported: 1,
        card_supported: 1,
        mobile_supported: 0,
        api_supported: 1,
        required_documents: JSON.stringify(["NID_FRONT", "NID_BACK", "TIN_CERTIFICATE", "TRADE_LICENSE", "CANCELLED_BANK_CHEQUE"]),
        service_fee: 1.80,
        setup_fee: 1000.00,
        status: "active",
      },
      {
        name: "Upay Digital QR Gateway",
        code: "UPAY_DIRECT",
        description: "UCB FinTech Upay interoperable BanglaQR acquiring service.",
        supported_methods: JSON.stringify(["BanglaQR", "Upay App"]),
        service_type: "MFS Gateway",
        qr_supported: 1,
        card_supported: 0,
        mobile_supported: 1,
        api_supported: 1,
        required_documents: JSON.stringify(["NID_FRONT", "TIN_CERTIFICATE", "CANCELLED_BANK_CHEQUE"]),
        service_fee: 1.25,
        setup_fee: 0.00,
        status: "active",
      }
    ];

    for (const g of seedGateways) {
      await db.execute(
        `INSERT INTO gateways (name, code, description, supported_methods, service_type, qr_supported, card_supported, mobile_supported, api_supported, required_documents, service_fee, setup_fee, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [g.name, g.code, g.description, g.supported_methods, g.service_type, g.qr_supported, g.card_supported, g.mobile_supported, g.api_supported, g.required_documents, g.service_fee, g.setup_fee, g.status]
      );
    }
    console.log("✅ Seeded 5 standard gateways");
  }

  // Seed Default Addons if empty
  const [addonRows] = await db.execute("SELECT COUNT(*) AS count FROM addons");
  if (addonRows[0].count === 0) {
    const seedAddons = [
      {
        name: "Multi-Outlet Dynamic QR",
        code: "MULTI_OUTLET_QR",
        description: "Generate and manage independent dynamic BanglaQR codes for multiple branch locations and cash counters.",
        category: "Operations",
        pricing_type: "monthly",
        price: 999.00,
        billing_cycle: "Monthly",
        requirements: "Requires active approved merchant profile and minimum 1 active gateway.",
        status: "available",
      },
      {
        name: "Real-time SMS & WhatsApp Transaction Alerts",
        code: "INSTANT_SMS_ALERTS",
        description: "Instant transaction alerts sent to designated phone numbers upon every successful customer payment scan.",
        category: "Communication",
        pricing_type: "per_transaction",
        price: 0.25,
        billing_cycle: "Pay-as-you-go",
        requirements: "Verified authorized mobile number.",
        status: "available",
      },
      {
        name: "Automated Daily Bank Settlement Reconciler",
        code: "AUTO_BANK_RECON",
        description: "Automatically match daily customer transactions against bank statements with downloadable discrepancy reports.",
        category: "Accounting",
        pricing_type: "monthly",
        price: 1499.00,
        billing_cycle: "Monthly",
        requirements: "Valid corporate settlement bank account details.",
        status: "available",
      },
      {
        name: "Developer Webhook & Raw Event Streaming",
        code: "WEBHOOK_EVENT_STREAM",
        description: "Enterprise webhooks with automated retries, signature verification and raw JSON payment events.",
        category: "Integration",
        pricing_type: "monthly",
        price: 499.00,
        billing_cycle: "Monthly",
        requirements: "Technical domain configuration & HTTPS callback URL.",
        status: "available",
      }
    ];

    for (const a of seedAddons) {
      await db.execute(
        `INSERT INTO addons (name, code, description, category, pricing_type, price, billing_cycle, requirements, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [a.name, a.code, a.description, a.category, a.pricing_type, a.price, a.billing_cycle, a.requirements, a.status]
      );
    }
    console.log("✅ Seeded 4 standard add-on products");
  }

  // Seed Default Settings if empty
  const [settingsRows] = await db.execute("SELECT COUNT(*) AS count FROM admin_settings");
  if (settingsRows[0].count === 0) {
    const defaultSettings = [
      {
        key: "platform_general",
        value: JSON.stringify({
          platformName: "BanglaQR Digital Payment Service Management",
          supportEmail: "compliance@banglaqr.com",
          supportPhone: "+880 9612 000 000",
          maintenanceMode: false,
          allowedOrigins: ["http://localhost:5173", "http://localhost:3000", "https://banglaqr.online", "https://www.banglaqr.online"],
        }),
        category: "general"
      },
      {
        key: "compliance_rules",
        value: JSON.stringify({
          mandatoryDocuments: ["NID_FRONT", "NID_BACK", "TIN_CERTIFICATE", "CANCELLED_BANK_CHEQUE"],
          binOptional: true,
          autoMaskingSensitiveData: true,
          requireReviewerConfirmation: true,
          maxFileSizeMb: 10,
        }),
        category: "compliance"
      },
      {
        key: "notification_triggers",
        value: JSON.stringify({
          notifyAdminOnNewRegistration: true,
          notifyAdminOnSubmission: true,
          notifyMerchantOnStatusChange: true,
          sendEmailCopies: true,
        }),
        category: "notifications"
      },
      {
        key: "security_policy",
        value: JSON.stringify({
          sessionTimeoutMinutes: 30,
          maxLoginAttempts: 5,
          lockoutMinutes: 15,
          requireTwoFactorForSuperAdmin: true,
          logDetailedAuditTrail: true,
        }),
        category: "security"
      }
    ];

    for (const s of defaultSettings) {
      await db.execute(
        `INSERT INTO admin_settings (setting_key, setting_value, category, updated_by)
         VALUES (?, ?, ?, 'System')`,
        [s.key, s.value, s.category]
      );
    }
    console.log("✅ Seeded default admin settings");
  }

  // Seed Sample Notifications if empty
  const [notifRows] = await db.execute("SELECT COUNT(*) AS count FROM notifications");
  if (notifRows[0].count === 0) {
    await db.execute(`
      INSERT INTO notifications (recipient_type, title, message, type, link, is_read, created_at)
      VALUES 
      ('admin', 'New Merchant Submissions Waiting', 'Multiple merchant onboarding packages are ready for compliance review.', 'merchant_update', '/admin/merchants/pending', 0, NOW()),
      ('admin', 'BanglaQR Interoperable Gateway Live', 'NPSB settlement routing configuration verified and online.', 'gateway', '/admin/gateways', 0, NOW()),
      ('admin', 'Security Audit Completed', 'Automated security scan completed with zero critical vulnerabilities.', 'security', '/admin/audit', 1, NOW())
    `);
    console.log("✅ Seeded initial admin notifications");
  }

  // Ensure all permissions exist and are mapped
  const permissionsList = [
    { name: "dashboard.view", desc: "View admin dashboard and statistics" },
    { name: "merchant.view", desc: "View merchants" },
    { name: "merchant.create", desc: "Create merchants" },
    { name: "merchant.edit", desc: "Edit merchants" },
    { name: "merchant.approve", desc: "Approve merchants" },
    { name: "merchant.reject", desc: "Reject merchants" },
    { name: "merchant.suspend", desc: "Suspend merchants" },
    { name: "merchant.activate", desc: "Activate merchants" },
    { name: "kyc.view", desc: "View KYC" },
    { name: "kyc.review", desc: "Review KYC" },
    { name: "kyc.approve", desc: "Approve KYC" },
    { name: "kyc.reject", desc: "Reject KYC" },
    { name: "document.view", desc: "View documents" },
    { name: "document.review", desc: "Review documents" },
    { name: "document.download", desc: "Download documents" },
    { name: "application.view", desc: "View gateway applications" },
    { name: "application.review", desc: "Review gateway applications" },
    { name: "application.approve", desc: "Approve gateway applications" },
    { name: "application.reject", desc: "Reject gateway applications" },
    { name: "gateway.view", desc: "View gateway services" },
    { name: "gateway.create", desc: "Create gateway services" },
    { name: "gateway.edit", desc: "Edit gateway services" },
    { name: "gateway.delete", desc: "Delete gateway services" },
    { name: "addon.view", desc: "View add-on products" },
    { name: "addon.create", desc: "Create add-on products" },
    { name: "addon.edit", desc: "Edit add-on products" },
    { name: "addon.delete", desc: "Delete add-on products" },
    { name: "invoice.view", desc: "View customer invoices" },
    { name: "invoice.manage", desc: "Manage invoices" },
    { name: "ticket.view", desc: "View support tickets" },
    { name: "ticket.reply", desc: "Reply to tickets" },
    { name: "ticket.manage", desc: "Manage ticket statuses" },
    { name: "notification.view", desc: "View notifications" },
    { name: "notification.manage", desc: "Manage notifications" },
    { name: "audit.view", desc: "View audit logs" },
    { name: "settings.manage", desc: "Manage platform settings" },
  ];

  for (const p of permissionsList) {
    const [exists] = await db.execute("SELECT id FROM permissions WHERE name = ?", [p.name]);
    let permId;
    if (exists.length === 0) {
      const [res] = await db.execute(
        "INSERT INTO permissions (name, description, created_at) VALUES (?, ?, NOW())",
        [p.name, p.desc]
      );
      permId = res.insertId;
    } else {
      permId = exists[0].id;
    }

    // Assign to super_admin and admin
    for (const roleName of ["super_admin", "admin"]) {
      const [rRows] = await db.execute("SELECT id FROM roles WHERE name = ?", [roleName]);
      if (rRows.length > 0) {
        const roleId = rRows[0].id;
        const [rp] = await db.execute("SELECT * FROM role_permissions WHERE role_id = ? AND permission_id = ?", [roleId, permId]);
        if (rp.length === 0) {
          await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permId]);
        }
      }
    }

    // Reviewer permissions
    if (p.name.startsWith("kyc.") || p.name.startsWith("document.") || p.name.startsWith("application.") || p.name === "dashboard.view" || p.name === "merchant.view" || p.name === "audit.view") {
      const [rRows] = await db.execute("SELECT id FROM roles WHERE name = 'reviewer'");
      if (rRows.length > 0) {
        const roleId = rRows[0].id;
        const [rp] = await db.execute("SELECT * FROM role_permissions WHERE role_id = ? AND permission_id = ?", [roleId, permId]);
        if (rp.length === 0) {
          await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permId]);
        }
      }
    }

    // Support agent permissions
    if (p.name.startsWith("ticket.") || p.name.startsWith("notification.") || p.name === "dashboard.view" || p.name === "merchant.view") {
      const [rRows] = await db.execute("SELECT id FROM roles WHERE name = 'support_agent'");
      if (rRows.length > 0) {
        const roleId = rRows[0].id;
        const [rp] = await db.execute("SELECT * FROM role_permissions WHERE role_id = ? AND permission_id = ?", [roleId, permId]);
        if (rp.length === 0) {
          await db.execute("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)", [roleId, permId]);
        }
      }
    }
  }

  console.log("✅ Migration 005 finished successfully.");
  process.exit(0);
}

run().catch((err) => {
  console.error("Migration 005 failed:", err);
  process.exit(1);
});

