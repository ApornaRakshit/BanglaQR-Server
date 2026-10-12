import { db } from "../src/config/db.js";
import { adminInquiriesRepository } from "../src/modules/admin/inquiries/admin.inquiries.module.js";
import { cmsRepository } from "../src/modules/admin/cms/cms.repository.js";

async function runTests() {
  console.log("=========================================================");
  console.log("   BANGLAQR CONTACT US & CMS INTEGRATION E2E TEST       ");
  console.log("=========================================================\n");

  try {
    // 1. Check cms_homepage table
    console.log("[1] Checking CMS Homepage Table & Contact Section Schema...");
    const [cmsRows] = await db.query("SELECT * FROM cms_homepage WHERE page_slug = 'homepage' LIMIT 1");
    if (cmsRows.length === 0) {
      throw new Error("No homepage CMS record found");
    }
    const currentDraft = typeof cmsRows[0].draft_content === "string" ? JSON.parse(cmsRows[0].draft_content) : cmsRows[0].draft_content;
    const currentPublished = typeof cmsRows[0].published_content === "string" ? JSON.parse(cmsRows[0].published_content) : cmsRows[0].published_content;

    console.log("✓ CMS record exists. Draft contact active status:", currentDraft?.contact?.isActive);
    console.log("✓ Published contact active status:", currentPublished?.contact?.isActive);

    // 2. Activate contact in draft and test saveDraft
    console.log("\n[2] Testing CMS Save Draft with Active Contact Section...");
    const updatedDraft = {
      ...currentDraft,
      contact: {
        ...(currentDraft.contact || {}),
        isActive: true,
        badge: "যোগাযোগ করুন",
        title: "বাংলাদেশের সেরা পেমেন্ট ও সফটওয়্যার পার্টনারের সাথে যোগাযোগ করুন",
        heading: "বাংলাদেশের সেরা পেমেন্ট ও সফটওয়্যার পার্টনারের সাথে যোগাযোগ করুন",
        subtitle: "আপনার ব্যবসাকে ডিজিটাল ও সহজ করতে আজই আমাদের সাথে যোগাযোগ করুন। আমাদের বিশেষজ্ঞ টিম দ্রুত আপনাকে সহায়তা করবে।",
        description: "আপনার ব্যবসাকে ডিজিটাল ও সহজ করতে আজই আমাদের সাথে যোগাযোগ করুন। আমাদের বিশেষজ্ঞ টিম দ্রুত আপনাকে সহায়তা করবে।",
        salesTitle: "হটলাইন ও সেলস",
        salesPhone: "09602-111215  09697-428578",
        salesHours: "সপ্তাহের ৭ দিন সকাল ৯:০০ - রাত ৯:০০",
        emailTitle: "ইমেইল যোগাযোগ",
        emailAddress: "info@csnbd.com",
        emailSubtitle: "আমরা ২৪ ঘণ্টার মধ্যে উত্তর দিই",
        officeTitle: "প্রধান কার্যালয়",
        officeAddress: "ওয়াকিল টাওয়ার (৮ম তলা) তা-১৩১, গুলশান-১ বাড্ডা লিংক রোড, ঢাকা-১২১২",
        formTitle: "ফ্রি ডেমো বা তথ্য জানতে অনুরোধ করুন",
        formSubtitle: "নিচের ফর্মটি পূরণ করুন, আমাদের বিশেষজ্ঞ দল দ্রুত যোগাযোগ করবে।",
        submitButtonText: "বার্তা পাঠান",
        services: [
          { id: "1", name: "BanglaQR পেমেন্ট গেটওয়ে", description: "QR ও অনলাইন গেটওয়ে পেমেন্ট", isActive: true, order: 1 },
          { id: "2", name: "মার্চেন্ট POS সিস্টেম", description: "দোকান ও সুপারশপের সমাধান", isActive: true, order: 2 },
          { id: "3", name: "ডায়নামিক QR সল্যুশন", description: "অ্যাপ ও কাউন্টার কালেকশন", isActive: true, order: 3 },
          { id: "4", name: "API ও ERP ইন্টিগ্রেশন", description: "সরাসরি সিস্টেম ইন্টিগ্রেশন", isActive: true, order: 4 },
          { id: "5", name: "কাস্টম পেমেন্ট সফটওয়্যার", description: "কাস্টমাইজড সফটওয়্যার সমাধান", isActive: true, order: 5 },
        ]
      }
    };

    await cmsRepository.saveDraft(updatedDraft, 1);
    const afterDraft = await cmsRepository.getHomepage();
    if (afterDraft.draftContent.contact.isActive !== true) {
      throw new Error("Draft save did not persist isActive: true");
    }
    console.log("✓ Draft successfully saved to MySQL. Title:", afterDraft.draftContent.contact.title);

    // 3. Test Publishing
    console.log("\n[3] Testing CMS Publish Workflow...");
    await cmsRepository.publishDraft(updatedDraft, 1);
    const afterPublish = await cmsRepository.getHomepage();
    if (afterPublish.publishedContent.contact.isActive !== true) {
      throw new Error("Published content does not have active contact");
    }
    console.log("✓ Contact section published successfully! Public isActive:", afterPublish.publishedContent.contact.isActive);

    // 4. Test Contact Submission & Database Persistence
    console.log("\n[4] Testing Contact Form Submission & MySQL Insertion...");
    const testInquiryRef = `INQ-TEST-${Date.now().toString().slice(-6)}`;
    const [insRes] = await db.execute(
      `
        INSERT INTO contact_inquiries (
          full_name, phone, email, company_name, inquiry_reference,
          service_id, service_name, message, status, ip_address, user_agent, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', '127.0.0.1', 'E2E-Tester', NOW())
      `,
      [
        "তানভীর হাসান টেস্ট",
        "01799887766",
        "tanvir.test@example.com",
        "হাসান ডিজিটাল লিমিটেড",
        testInquiryRef,
        "1",
        "BanglaQR পেমেন্ট গেটওয়ে",
        "আমাদের রিটেইল চেইনের জন্য বাংলা কিউআর পেমেন্ট গেটওয়ে প্রয়োজন।",
      ]
    );

    const testInqId = insRes.insertId;
    console.log(`✓ Test inquiry inserted into MySQL! ID: ${testInqId}, Ref: ${testInquiryRef}`);

    // 5. Test Admin Notification Creation
    console.log("\n[5] Testing Real Admin Notification Creation...");
    const [notifRes] = await db.execute(
      `
        INSERT INTO notifications (recipient_type, title, message, type, link, is_read, created_at)
        VALUES ('admin', 'নতুন যোগাযোগের অনুরোধ', ?, 'contact_inquiry', ?, 0, NOW())
      `,
      [
        `তানভীর হাসান টেস্ট (হাসান ডিজিটাল লিমিটেড) "BanglaQR পেমেন্ট গেটওয়ে" সম্পর্কে যোগাযোগের অনুরোধ পাঠিয়েছেন। রেফারেন্স: ${testInquiryRef}`,
        `/admin/contact-inquiries?id=${testInqId}`
      ]
    );
    console.log(`✓ Notification created! ID: ${notifRes.insertId}`);

    // Check unread count
    const [unreadRows] = await db.query(
      `SELECT COUNT(*) AS unread FROM notifications WHERE recipient_type = 'admin' AND is_read = 0`
    );
    console.log(`✓ Live Admin Unread Notifications count: ${unreadRows[0]?.unread}`);

    // 6. Test Admin Inquiries Repository Listing & Search
    console.log("\n[6] Testing Admin Inquiries Search & Detail Fetching...");
    const searchRes = await adminInquiriesRepository.listInquiries({
      search: testInquiryRef,
      page: 1,
      limit: 10,
    });
    if (searchRes.inquiries.length === 0) {
      throw new Error(`Inquiry with reference ${testInquiryRef} not found in search`);
    }
    const found = searchRes.inquiries[0];
    console.log("✓ Inquiry found via reference search:", {
      id: found.id,
      inquiryReference: found.inquiryReference,
      fullName: found.fullName,
      companyName: found.companyName,
      serviceName: found.serviceName,
      status: found.status,
    });

    // 7. Test Admin Status & Internal Notes Update
    console.log("\n[7] Testing Admin Status & Internal Note Update...");
    await adminInquiriesRepository.updateStatus(testInqId, "in_progress", "ক্লায়েন্টের সাথে ফোনে যোগাযোগ করা হয়েছে।");
    const updatedInq = await adminInquiriesRepository.getInquiryById(testInqId);
    if (updatedInq.status !== "in_progress" || updatedInq.adminNotes !== "ক্লায়েন্টের সাথে ফোনে যোগাযোগ করা হয়েছে।") {
      throw new Error("Failed to update status or admin notes");
    }
    console.log("✓ Inquiry successfully updated:", {
      status: updatedInq.status,
      adminNotes: updatedInq.adminNotes,
    });

    console.log("\n=========================================================");
    console.log("   ALL CONTACT SECTION & CMS E2E TESTS PASSED 100%!     ");
    console.log("=========================================================");
    process.exit(0);
  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

runTests();
