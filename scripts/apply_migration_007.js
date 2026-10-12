import { db } from "../src/config/db.js";

async function run() {
  console.log("Applying Migration 007: Marketplace Integration...");

  // 1. Inspect and add columns for gateways
  const [gwCols] = await db.query("SHOW COLUMNS FROM gateways");
  const gwColNames = new Set(gwCols.map((c) => c.Field));

  if (!gwColNames.has("category")) {
    console.log("Adding column 'category' to gateways...");
    await db.query("ALTER TABLE gateways ADD COLUMN category VARCHAR(50) DEFAULT 'gateway'");
  }
  if (!gwColNames.has("is_published")) {
    console.log("Adding column 'is_published' to gateways...");
    await db.query("ALTER TABLE gateways ADD COLUMN is_published TINYINT(1) DEFAULT 1");
  }
  if (!gwColNames.has("accepts_applications")) {
    console.log("Adding column 'accepts_applications' to gateways...");
    await db.query("ALTER TABLE gateways ADD COLUMN accepts_applications TINYINT(1) DEFAULT 1");
  }
  if (!gwColNames.has("display_order")) {
    console.log("Adding column 'display_order' to gateways...");
    await db.query("ALTER TABLE gateways ADD COLUMN display_order INT DEFAULT 0");
  }
  if (!gwColNames.has("short_description")) {
    console.log("Adding column 'short_description' to gateways...");
    await db.query("ALTER TABLE gateways ADD COLUMN short_description VARCHAR(255) DEFAULT NULL");
  }
  if (!gwColNames.has("eligibility")) {
    console.log("Adding column 'eligibility' to gateways...");
    await db.query("ALTER TABLE gateways ADD COLUMN eligibility TEXT DEFAULT NULL");
  }

  // 2. Inspect and add columns for addons
  const [addonCols] = await db.query("SHOW COLUMNS FROM addons");
  const addonColNames = new Set(addonCols.map((c) => c.Field));

  if (!addonColNames.has("logo_url")) {
    console.log("Adding column 'logo_url' to addons...");
    await db.query("ALTER TABLE addons ADD COLUMN logo_url VARCHAR(500) DEFAULT NULL");
  }
  if (!addonColNames.has("is_published")) {
    console.log("Adding column 'is_published' to addons...");
    await db.query("ALTER TABLE addons ADD COLUMN is_published TINYINT(1) DEFAULT 1");
  }
  if (!addonColNames.has("accepts_applications")) {
    console.log("Adding column 'accepts_applications' to addons...");
    await db.query("ALTER TABLE addons ADD COLUMN accepts_applications TINYINT(1) DEFAULT 1");
  }
  if (!addonColNames.has("display_order")) {
    console.log("Adding column 'display_order' to addons...");
    await db.query("ALTER TABLE addons ADD COLUMN display_order INT DEFAULT 0");
  }
  if (!addonColNames.has("short_description")) {
    console.log("Adding column 'short_description' to addons...");
    await db.query("ALTER TABLE addons ADD COLUMN short_description VARCHAR(255) DEFAULT NULL");
  }
  if (!addonColNames.has("eligibility")) {
    console.log("Adding column 'eligibility' to addons...");
    await db.query("ALTER TABLE addons ADD COLUMN eligibility TEXT DEFAULT NULL");
  }

  // 3. Backfill gateways categories and logos
  await db.query(`
    UPDATE gateways 
    SET category = 'mfs', 
        logo_url = COALESCE(logo_url, '/assets/paymentLogos/bkash.png'),
        status = 'active',
        is_published = 1,
        accepts_applications = 1,
        display_order = 1,
        short_description = 'বিকাশ অ্যাপ ও বাংলা কিউআর পেমেন্ট গ্রহণ সুবিধা',
        eligibility = 'বৈধ ট্রেড লাইসেন্স ও সচল মার্চেন্ট ব্যাংক অ্যাকাউন্ট'
    WHERE code = 'BKASH_DIRECT'
  `);

  await db.query(`
    UPDATE gateways 
    SET category = 'mfs', 
        logo_url = COALESCE(logo_url, '/assets/paymentLogos/nagad.webp'),
        status = 'active',
        is_published = 1,
        accepts_applications = 1,
        display_order = 2,
        short_description = 'নগদ ডিজিটাল পেমেন্ট ও কিউআর কালেকশন সার্ভিস',
        eligibility = 'জাতীয় পরিচয়পত্র ও রেজিস্টার্ড ব্যবসা সংক্রান্ত কাগজপত্র'
    WHERE code = 'NAGAD_DIRECT'
  `);

  await db.query(`
    UPDATE gateways 
    SET category = 'mfs', 
        logo_url = COALESCE(logo_url, '/assets/paymentLogos/roket.webp'),
        status = 'active',
        is_published = 1,
        accepts_applications = 1,
        display_order = 3,
        short_description = 'ডাচ-বাংলা ব্যাংক রকেট আন্তঃলেনদেনযোগ্য বাংলা কিউআর',
        eligibility = 'ডিবিবিএল লিংকড মার্চেন্ট প্রোফাইল ও ট্রেড লাইসেন্স'
    WHERE code = 'ROCKET_DBBL'
  `);

  await db.query(`
    UPDATE gateways 
    SET category = 'gateway', 
        logo_url = COALESCE(logo_url, '/assets/paymentLogos/visa.png'),
        status = 'active',
        is_published = 1,
        accepts_applications = 1,
        display_order = 4,
        short_description = 'ভিসা ও মাস্টারকার্ড বাংলা কিউআর পেমেন্ট গ্রহণ',
        eligibility = 'ই-কমার্স বা রিটেল মার্চেন্ট অ্যাকাউন্ট এবং বৈধ TIN সনদ'
    WHERE code = 'CARD_ACQUIRER_UNION'
  `);

  await db.query(`
    UPDATE gateways 
    SET category = 'mfs', 
        logo_url = COALESCE(logo_url, '/assets/paymentLogos/upay.webp'),
        status = 'active',
        is_published = 1,
        accepts_applications = 1,
        display_order = 5,
        short_description = 'উপায় বাংলা কিউআর ও ডিজিটাল মার্চেন্ট পেমেন্ট',
        eligibility = 'সচল ইউসিবি অ্যাকাউন্ট ও ব্যবসায়িক প্রমাণপত্র'
    WHERE code LIKE 'UPAY%'
  `);

  // Check if bank partner services exist, insert City Bank and BRAC Bank if not present
  const [cityBank] = await db.query("SELECT id FROM gateways WHERE code = 'CITY_BANK_QR' LIMIT 1");
  if (cityBank.length === 0) {
    await db.query(`
      INSERT INTO gateways (name, code, logo_url, description, short_description, supported_methods, service_type, category, qr_supported, card_supported, mobile_supported, api_supported, required_documents, service_fee, setup_fee, status, is_published, accepts_applications, display_order, eligibility, created_at, updated_at)
      VALUES (
        'The City Bank BanglaQR Merchant Acquiring',
        'CITY_BANK_QR',
        null,
        'সিটি ব্যাংক ইন্টারঅপারেবল বাংলা কিউআর এবং মার্চেন্ট অ্যাকোয়ারিং সেবা। যেকোনো বাংলা কিউআর অ্যাপ থেকে সরাসরি ব্যাংক অ্যাকাউন্টে সেটেলমেন্ট সুবিধা।',
        'সিটি ব্যাংক বাংলা কিউআর ডিরেক্ট অ্যাকাউন্ট সেটেলমেন্ট',
        '["BanglaQR", "City Touch", "Visa", "Mastercard", "NPSB"]',
        'Commercial Bank',
        'bank',
        1, 1, 1, 1,
        '["trade_license", "tin_certificate", "bank_statement", "nid"]',
        1.20, 0.00, 'active', 1, 1, 6,
        'সিটি ব্যাংক কর্পোরেট অথবা মার্চেন্ট অ্যাকাউন্টধারী নিবন্ধিত প্রতিষ্ঠান',
        NOW(), NOW()
      )
    `);
    console.log("Added City Bank QR gateway.");
  }

  const [bracBank] = await db.query("SELECT id FROM gateways WHERE code = 'BRAC_BANK_QR' LIMIT 1");
  if (bracBank.length === 0) {
    await db.query(`
      INSERT INTO gateways (name, code, logo_url, description, short_description, supported_methods, service_type, category, qr_supported, card_supported, mobile_supported, api_supported, required_documents, service_fee, setup_fee, status, is_published, accepts_applications, display_order, eligibility, created_at, updated_at)
      VALUES (
        'BRAC Bank Astha & BanglaQR Service',
        'BRAC_BANK_QR',
        null,
        'ব্র্যাক ব্যাংক আস্থা ও ইন্টারঅপারেবল বাংলা কিউআর মার্চেন্ট সার্ভিস। তাৎক্ষণিক লেনদেন নোটিফিকেশন ও স্বয়ংক্রিয় দৈনিক রিকনসিলিয়েশন।',
        'ব্র্যাক ব্যাংক ডিজিটাল কিউআর ও আস্থা ইন্টিগ্রেশন',
        '["BanglaQR", "Astha App", "Visa", "Mastercard"]',
        'Commercial Bank',
        'bank',
        1, 1, 0, 1,
        '["trade_license", "tin_certificate", "nid", "cancelled_cheque"]',
        1.25, 0.00, 'active', 1, 1, 7,
        'ব্র্যাক ব্যাংক কারেন্ট/এসটিডি অ্যাকাউন্ট এবং কেওয়াইসি অনুমোদিত ব্যবসা',
        NOW(), NOW()
      )
    `);
    console.log("Added BRAC Bank QR gateway.");
  }

  // Update default addons
  await db.query(`
    UPDATE addons
    SET is_published = 1,
        accepts_applications = 1,
        short_description = COALESCE(short_description, description)
    WHERE status = 'available'
  `);

  // Ensure cms_homepage has marketplace section in draft_content and published_content
  const [cmsRows] = await db.query("SELECT id, draft_content, published_content FROM cms_homepage WHERE page_slug = 'homepage' LIMIT 1");
  if (cmsRows.length > 0) {
    const row = cmsRows[0];
    const draft = typeof row.draft_content === "string" ? JSON.parse(row.draft_content) : (row.draft_content || {});
    const pub = typeof row.published_content === "string" ? JSON.parse(row.published_content) : (row.published_content || {});

    const defaultMarketplace = {
      isActive: true,
      badge: "BanglaQR Merchant Marketplace",
      title: "আপনার ব্যবসার জন্য পেমেন্ট সেবা বেছে নিন",
      subtitle: "তালিকাভুক্ত ব্যাংক, MFS ও পেমেন্ট সেবা থেকে আপনার প্রয়োজন অনুযায়ী নির্বাচন করুন এবং সহজেই আবেদন শুরু করুন।",
      columns: 3,
      categories: [
        { id: "all", name: "সব সেবা", isActive: true },
        { id: "bank", name: "ব্যাংক", isActive: true },
        { id: "mfs", name: "MFS", isActive: true },
        { id: "gateway", name: "পেমেন্ট গেটওয়ে", isActive: true },
        { id: "addon", name: "অ্যাড-অন সেবা", isActive: true },
      ],
      stepsHeading: "৩টি সহজ ধাপে সেবা গ্রহণ করুন",
      steps: [
        {
          stepNumber: "১",
          title: "১. পেমেন্ট সেবা নির্বাচন করুন",
          description: "ব্যাংক, MFS বা অন্যান্য সেবার তালিকা থেকে পছন্দের সেবা বেছে নিন।",
          icon: "CreditCard",
        },
        {
          stepNumber: "২",
          title: "২. প্রয়োজনীয় তথ্য ও ডকুমেন্ট দিন",
          description: "নির্বাচিত সেবার জন্য প্রয়োজনীয় KYC তথ্য ও ডকুমেন্ট জমা দিন।",
          icon: "FileCheck",
        },
        {
          stepNumber: "৩",
          title: "৩. আপডেট পান",
          description: "আবেদনের অবস্থা, রিভিউ এবং পরবর্তী করণীয় Merchant Dashboard থেকে দেখুন।",
          icon: "BellRing",
        },
      ],
    };

    if (!draft.marketplace) {
      draft.marketplace = defaultMarketplace;
    }
    if (!pub.marketplace) {
      pub.marketplace = defaultMarketplace;
    }

    await db.query(
      "UPDATE cms_homepage SET draft_content = ?, published_content = ? WHERE id = ?",
      [JSON.stringify(draft), JSON.stringify(pub), row.id]
    );
    console.log("Updated cms_homepage with marketplace configuration.");
  }

  console.log("Migration 007 applied successfully!");
  process.exit(0);
}

run().catch((e) => {
  console.error("Migration 007 failed:", e);
  process.exit(1);
});

