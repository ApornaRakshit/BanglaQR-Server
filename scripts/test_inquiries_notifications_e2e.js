import { db } from "../src/config/db.js";
import { adminInquiriesRepository } from "../src/modules/admin/inquiries/admin.inquiries.module.js";
import { adminNotificationsRepository } from "../src/modules/admin/notifications/admin.notifications.module.js";
import { cmsService } from "../src/modules/admin/cms/cms.service.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runInquiryAndNotificationTests() {
  console.log("==================================================");
  console.log("RUNNING CONTACT INQUIRIES & NOTIFICATIONS E2E TESTS");
  console.log("==================================================");

  let createdInquiryId = null;
  let createdNotificationId = null;

  try {
    // 1. Initial State Check
    console.log("\n[Test 1] Check Initial Notification and Inquiry Count");
    const initialUnread = await adminNotificationsRepository.getUnreadCount();
    console.log(`  Initial unread notifications: ${initialUnread}`);
    assert(typeof initialUnread === "number", "Unread count returns a valid number");

    // 2. Submit a real Contact Inquiry (Simulate Public Form Submission)
    console.log("\n[Test 2] Submit Contact Inquiry to Database");
    const testInquiry = {
      fullName: "ফারহান কবির টেস্ট",
      phone: "01812345678",
      email: "farhan.test@banglaqr.com",
      serviceName: "Dynamic QR Solution",
      message: "আমি আমাদের শপের জন্য ডায়নামিক কিউআর সল্যুশন ইন্টিগ্রেট করতে চাই।",
      ipAddress: "127.0.0.1",
      userAgent: "TestAgent/1.0",
    };

    // Insert into contact_inquiries
    const insertInquirySql = `
      INSERT INTO contact_inquiries (
        full_name, phone, email, service_name, message, ip_address, user_agent, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'new')
    `;
    const [inquiryResult] = await db.execute(insertInquirySql, [
      testInquiry.fullName,
      testInquiry.phone,
      testInquiry.email,
      testInquiry.serviceName,
      testInquiry.message,
      testInquiry.ipAddress,
      testInquiry.userAgent,
    ]);

    createdInquiryId = inquiryResult.insertId;
    assert(createdInquiryId > 0, `Contact inquiry created with ID #${createdInquiryId}`);

    // Create corresponding admin notification
    createdNotificationId = await adminNotificationsRepository.createNotification({
      recipientType: "admin",
      title: "নতুন কন্টাক্ট মেসেজ",
      message: `${testInquiry.fullName} (${testInquiry.serviceName}) থেকে একটি নতুন মেসেজ এসেছে।`,
      type: "contact_inquiry",
      link: `/admin/contact-inquiries?id=${createdInquiryId}`,
    });

    assert(createdNotificationId > 0, `Admin notification created with ID #${createdNotificationId}`);

    // 3. Verify Unread Count Incremented
    console.log("\n[Test 3] Verify Live Unread Notification Count");
    const newUnread = await adminNotificationsRepository.getUnreadCount();
    assert(newUnread === initialUnread + 1, `Unread count incremented correctly to ${newUnread}`);

    // 4. Verify Admin Notification List
    console.log("\n[Test 4] Query Admin Notifications List");
    const notificationsList = await adminNotificationsRepository.listNotifications(100);
    assert(notificationsList.notifications.length > 0, "Notifications list returned items");
    const foundNotif = notificationsList.notifications.find((n) => n.id === createdNotificationId);
    assert(Boolean(foundNotif), "Newly created inquiry notification is present in list");
    assert(foundNotif.type === "contact_inquiry", "Notification type is 'contact_inquiry'");
    assert(foundNotif.isRead === false, "Notification is unread");

    // 5. Verify Admin Contact Inquiries List & Filters
    console.log("\n[Test 5] Query Admin Contact Inquiries with Status Filter & Search");
    const inquiriesList = await adminInquiriesRepository.listInquiries({
      status: "new",
      search: "ফারহান কবির",
      page: 1,
      limit: 10,
    });
    assert(inquiriesList.pagination.total >= 1, "Inquiries total count is >= 1");
    assert(inquiriesList.inquiries.length >= 1, "Inquiries array has >= 1 items");
    const foundInquiry = inquiriesList.inquiries.find((i) => i.id === createdInquiryId);
    assert(Boolean(foundInquiry), "Created inquiry found via search query");
    assert(foundInquiry.status === "new", "Inquiry status is 'new'");
    assert(foundInquiry.serviceName === "Dynamic QR Solution", "Service interested is preserved");

    // 6. Verify Inquiry Detail View
    console.log("\n[Test 6] Fetch Single Inquiry Details");
    const inquiryDetail = await adminInquiriesRepository.getInquiryById(createdInquiryId);
    assert(Boolean(inquiryDetail), "Inquiry details found by ID");
    assert(inquiryDetail.email === "farhan.test@banglaqr.com", "Email matches test submission");
    assert(inquiryDetail.phone === "01812345678", "Phone matches test submission");

    // 7. Verify Status Transitions (new -> in_progress -> replied -> closed)
    console.log("\n[Test 7] Verify Admin Status Transitions");
    await adminInquiriesRepository.updateStatus(createdInquiryId, "in_progress");
    let updatedInquiry = await adminInquiriesRepository.getInquiryById(createdInquiryId);
    assert(updatedInquiry.status === "in_progress", "Status successfully updated to 'in_progress'");

    await adminInquiriesRepository.updateStatus(createdInquiryId, "replied");
    updatedInquiry = await adminInquiriesRepository.getInquiryById(createdInquiryId);
    assert(updatedInquiry.status === "replied", "Status successfully updated to 'replied'");

    await adminInquiriesRepository.updateStatus(createdInquiryId, "closed");
    updatedInquiry = await adminInquiriesRepository.getInquiryById(createdInquiryId);
    assert(updatedInquiry.status === "closed", "Status successfully updated to 'closed'");

    // 8. Verify Mark Notification As Read
    console.log("\n[Test 8] Mark Single Notification As Read");
    await adminNotificationsRepository.markAsRead(createdNotificationId);
    const unreadAfterSingleMark = await adminNotificationsRepository.getUnreadCount();
    assert(unreadAfterSingleMark === initialUnread, "Unread count decremented after marking single notification as read");

    // 9. Test Mark All As Read
    console.log("\n[Test 9] Mark All Notifications As Read");
    await adminNotificationsRepository.markAllAsRead();
    const unreadAfterAllMark = await adminNotificationsRepository.getUnreadCount();
    assert(unreadAfterAllMark === 0, "Unread count is 0 after markAllAsRead");

    // 10. Test CMS Active/Inactive Section & Service Items Toggling
    console.log("\n[Test 10] Test CMS Active/Inactive Toggles for Contact Us and All Sections");
    const adminCms = await cmsService.getHomepageForAdmin();
    const modifiedDraft = JSON.parse(JSON.stringify(adminCms.draftContent));

    // Toggle contact section active status
    modifiedDraft.contact.isActive = false;
    modifiedDraft.contact.services = [
      { id: "s1", name: "BanglaQR Dynamic QR", isActive: true, order: 1 },
      { id: "s2", name: "Inactive Feature", isActive: false, order: 2 },
    ];

    const draftWithInactive = await cmsService.saveDraft(modifiedDraft, 1);
    assert(draftWithInactive.draftContent.contact.isActive === false, "Draft contact section marked isActive: false");
    assert(draftWithInactive.draftContent.contact.services[1].isActive === false, "Draft service item #2 marked isActive: false");

    // Publish and verify public response
    await cmsService.publishDraft(modifiedDraft, 1);
    const publicContent = await cmsService.getPublicHomepage();
    assert(publicContent.content.contact.isActive === false, "Public contact section preserves isActive: false");
    assert(
      publicContent.content.contact.services.length === 1 && publicContent.content.contact.services[0].name === "BanglaQR Dynamic QR",
      "Public content automatically filters out inactive service items"
    );

    // Reset CMS back to active
    console.log("\n[Test 11] Resetting CMS back to Active state");
    modifiedDraft.contact.isActive = true;
    modifiedDraft.contact.services = [
      { id: "s1", name: "BanglaQR Payment Gateway", isActive: true, order: 1 },
      { id: "s2", name: "Merchant POS System", isActive: true, order: 2 },
      { id: "s3", name: "Dynamic QR Solution", isActive: true, order: 3 },
      { id: "s4", name: "API & ERP Integration", isActive: true, order: 4 },
      { id: "s5", name: "Custom Payment Software", isActive: true, order: 5 },
    ];
    await cmsService.publishDraft(modifiedDraft, 1);
    assert(true, "CMS reset to active published state");

    // 11. Cleanup test records
    console.log("\n[Test 12] Cleaning up test records from database");
    if (createdInquiryId) {
      await db.execute("DELETE FROM contact_inquiries WHERE id = ?", [createdInquiryId]);
      assert(true, `Test inquiry #${createdInquiryId} deleted`);
    }
    if (createdNotificationId) {
      await db.execute("DELETE FROM notifications WHERE id = ?", [createdNotificationId]);
      assert(true, `Test notification #${createdNotificationId} deleted`);
    }

    console.log("\n==================================================");
    console.log("🎉 ALL INQUIRY & NOTIFICATION TESTS PASSED!");
    console.log("==================================================");
  } catch (err) {
    console.error("\n❌ Test Error:", err);
    throw err;
  } finally {
    await db.end();
  }
}

runInquiryAndNotificationTests();
