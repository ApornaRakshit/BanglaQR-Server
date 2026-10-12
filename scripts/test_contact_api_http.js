import { db } from "../src/config/db.js";

async function runHttpTests() {
  console.log("=== TESTING PUBLIC CONTACT HTTP APIS ===");

  // Import express app directly
  const appModule = await import("../src/app.js");
  const app = appModule.default;
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}/api/v1`;

  try {
    // 1. Test public CMS endpoint
    console.log("[1] Testing GET /public/cms/homepage...");
    const cmsResp = await fetch(`${baseUrl}/public/cms/homepage`);
    const cmsData = await cmsResp.json();
    if (!cmsData.success || !cmsData.data?.contact) {
      throw new Error("Public CMS endpoint failed or contact missing");
    }
    console.log("✓ Public CMS returned successfully. Contact section active:", cmsData.data.contact.isActive);

    // 2. Test Contact form submission with valid data
    console.log("\n[2] Testing POST /public/contact with valid submission...");
    const validPayload = {
      fullName: "সাইফুল ইসলাম",
      phone: "01811223344",
      email: "saiful.e2e@example.com",
      companyName: "বিডি স্মার্ট মার্চেন্ট",
      service: "BanglaQR পেমেন্ট গেটওয়ে",
      message: "আমরা আমাদের ১০০টি আউটলেটে বাংলা কিউআর পেমেন্ট গ্রহণ করতে চাই।",
    };

    const submitResp = await fetch(`${baseUrl}/public/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validPayload),
    });
    const submitData = await submitResp.json();
    if (!submitData.success || !submitData.data?.inquiryReference) {
      throw new Error("Contact submission failed: " + JSON.stringify(submitData));
    }
    const createdRef = submitData.data.inquiryReference;
    const createdId = submitData.data.inquiryId;
    console.log("✓ Contact form submitted successfully! Response:", {
      status: submitResp.status,
      success: submitData.success,
      inquiryId: createdId,
      inquiryReference: createdRef,
      message: submitData.message,
    });

    // 3. Test verification in database
    const [dbRows] = await db.query("SELECT * FROM contact_inquiries WHERE id = ?", [createdId]);
    if (dbRows.length === 0 || dbRows[0].company_name !== "বিডি স্মার্ট মার্চেন্ট") {
      throw new Error("Inquiry not persisted properly in DB");
    }
    console.log("✓ Verified in MySQL: full_name =", dbRows[0].full_name, ", company_name =", dbRows[0].company_name, ", ref =", dbRows[0].inquiry_reference);

    // 4. Test validation rejection (missing full name)
    console.log("\n[3] Testing POST /public/contact validation (missing name)...");
    const badResp1 = await fetch(`${baseUrl}/public/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "",
        phone: "01811223344",
        email: "valid@example.com",
        service: "BanglaQR পেমেন্ট গেটওয়ে",
        message: "টেস্ট বার্তা",
      }),
    });
    const badData1 = await badResp1.json();
    if (badResp1.status === 400 && badData1.success === false) {
      console.log("✓ Successfully rejected with HTTP 400:", badData1.message);
    } else {
      throw new Error("Expected validation error for missing name, got: " + badResp1.status);
    }

    // 5. Test validation rejection (invalid email)
    console.log("\n[4] Testing POST /public/contact validation (invalid email)...");
    const badResp2 = await fetch(`${baseUrl}/public/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "সঠিক নাম",
        phone: "01811223344",
        email: "not-an-email",
        service: "BanglaQR পেমেন্ট গেটওয়ে",
        message: "টেস্ট বার্তা",
      }),
    });
    const badData2 = await badResp2.json();
    if (badResp2.status === 400 && badData2.success === false) {
      console.log("✓ Successfully rejected with HTTP 400:", badData2.message);
    } else {
      throw new Error("Expected validation error for invalid email, got: " + badResp2.status);
    }

    // 6. Test validation rejection (missing message)
    console.log("\n[5] Testing POST /public/contact validation (missing message)...");
    const badResp3 = await fetch(`${baseUrl}/public/contact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "সঠিক নাম",
        phone: "01811223344",
        email: "valid@example.com",
        service: "BanglaQR পেমেন্ট গেটওয়ে",
        message: "",
      }),
    });
    const badData3 = await badResp3.json();
    if (badResp3.status === 400 && badData3.success === false) {
      console.log("✓ Successfully rejected with HTTP 400:", badData3.message);
    } else {
      throw new Error("Expected validation error for missing message, got: " + badResp3.status);
    }

    // 7. Test notification created
    console.log("\n[6] Checking Admin Notifications for created inquiry...");
    const [notifRows] = await db.query(
      "SELECT * FROM notifications WHERE link = ? LIMIT 1",
      [`/admin/contact-inquiries?id=${createdId}`]
    );
    if (notifRows.length === 0) {
      throw new Error("Admin notification was not created for contact submission");
    }
    console.log("✓ Admin notification confirmed in database:", {
      id: notifRows[0].id,
      title: notifRows[0].title,
      type: notifRows[0].type,
      link: notifRows[0].link,
    });

    console.log("\n=========================================================");
    console.log("   ALL HTTP ENDPOINT TESTS PASSED SUCCESSFULLY!          ");
    console.log("=========================================================");
    server.close();
    process.exit(0);
  } catch (e) {
    server.close();
    console.error("Test failed:", e);
    process.exit(1);
  }
}

runHttpTests();
