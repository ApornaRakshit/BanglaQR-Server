import { db } from "../src/config/db.js";

async function run() {
  console.log("Synchronizing canonical services with Reference Image 1...");

  // 1. Clean up test records
  await db.query("DELETE FROM gateways WHERE code LIKE 'TEST_%'");

  // 2. Check / upsert Dhaka Bank PLC
  const [dhaka] = await db.query("SELECT id FROM gateways WHERE code = 'DHAKA_BANK_QR'");
  if (dhaka.length === 0) {
    await db.query(
      `INSERT INTO gateways (name, code, category, logo_url, short_description, description, supported_methods, status, is_published, accepts_applications, display_order, service_fee, setup_fee)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 1, 1, 1, 1.25, 0)`,
      [
        "ঢাকা ব্যাংক পিএলসি",
        "DHAKA_BANK_QR",
        "bank",
        "/images/logos/dhakabank.svg",
        "QR পেমেন্ট, মার্চেন্ট অ্যাকাউন্ট, API ইন্টিগ্রেশন",
        "ঢাকা ব্যাংক পিএলসি বাংলা কিউআর ও মার্চেন্ট পেমেন্ট গেটওয়ে সেবা।",
        JSON.stringify(["QR পেমেন্ট", "মার্চেন্ট অ্যাকাউন্ট", "API ইন্টিগ্রেশন"])
      ]
    );
    console.log("✓ Inserted Dhaka Bank PLC");
  } else {
    await db.query(
      `UPDATE gateways SET name = ?, logo_url = ?, short_description = ?, supported_methods = ?, display_order = 1, is_published = 1, status = 'active' WHERE code = 'DHAKA_BANK_QR'`,
      [
        "ঢাকা ব্যাংক পিএলসি",
        "/images/logos/dhakabank.svg",
        "QR পেমেন্ট, মার্চেন্ট অ্যাকাউন্ট, API ইন্টিগ্রেশন",
        JSON.stringify(["QR পেমেন্ট", "মার্চেন্ট অ্যাকাউন্ট", "API ইন্টিগ্রেশন"])
      ]
    );
    console.log("✓ Updated Dhaka Bank PLC");
  }

  // 3. Update bKash
  await db.query(
    `UPDATE gateways SET name = ?, logo_url = ?, short_description = ?, supported_methods = ?, display_order = 2, is_published = 1, status = 'active' WHERE code = 'BKASH_DIRECT'`,
    [
      "বিকাশ মার্চেন্ট পেমেন্ট",
      "/assets/paymentLogos/bkash.png",
      "QR পেমেন্ট, মার্চেন্ট অ্যাকাউন্ট, ইনস্ট্যান্ট সেটেলমেন্ট",
      JSON.stringify(["QR পেমেন্ট", "মার্চেন্ট অ্যাকাউন্ট", "ইনস্ট্যান্ট সেটেলমেন্ট"])
    ]
  );
  console.log("✓ Updated bKash Merchant Payment");

  // 4. Update Nagad
  await db.query(
    `UPDATE gateways SET name = ?, logo_url = ?, short_description = ?, supported_methods = ?, display_order = 3, is_published = 1, status = 'active' WHERE code = 'NAGAD_DIRECT'`,
    [
      "নগদ মার্চেন্ট সলিউশন",
      "/assets/paymentLogos/nagad.webp",
      "QR পেমেন্ট, মার্চেন্ট অ্যাকাউন্ট, ব্যাংক পেমেন্ট",
      JSON.stringify(["QR পেমেন্ট", "মার্চেন্ট অ্যাকাউন্ট", "ব্যাংক পেমেন্ট"])
    ]
  );
  console.log("✓ Updated Nagad Merchant Solution");

  // 5. Update BRAC Bank
  await db.query(
    `UPDATE gateways SET name = ?, logo_url = ?, short_description = ?, supported_methods = ?, display_order = 4, is_published = 1, status = 'active' WHERE code = 'BRAC_BANK_QR'`,
    [
      "ব্র্যাক ব্যাংক",
      "/images/logos/bracbank.svg",
      "মার্চেন্ট সলিউশন, QR, পেমেন্ট গেটওয়ে",
      JSON.stringify(["QR পেমেন্ট", "মার্চেন্ট অ্যাকাউন্ট", "পেমেন্ট গেটওয়ে"])
    ]
  );
  console.log("✓ Updated BRAC Bank");

  // Also make sure Addons have display orders 5, 6, 7... and clean Bengali capabilities
  await db.query(
    `UPDATE addons SET display_order = 5 WHERE code = 'AUTO_BANK_RECON'`
  );
  await db.query(
    `UPDATE addons SET display_order = 6 WHERE code = 'SOUNDBOX_TERMINAL'`
  );

  console.log("✓ Completed synchronization with Reference Image 1");
  process.exit(0);
}

run().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});

