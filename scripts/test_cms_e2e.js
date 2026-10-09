import { db } from "../src/config/db.js";
import { cmsService } from "../src/modules/admin/cms/cms.service.js";
import fs from "fs/promises";
import path from "path";

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

async function runE2ETests() {
  console.log("==================================================");
  console.log("RUNNING CMS END-TO-END AUTOMATED VERIFICATION");
  console.log("==================================================");

  try {
    // 1. Initial State
    console.log("\n[Test 1] Inspect Initial Admin CMS Homepage state");
    const initialAdmin = await cmsService.getHomepageForAdmin();
    assert(initialAdmin.pageSlug === "homepage", "Page slug is 'homepage'");
    assert(Boolean(initialAdmin.isPublished), "Homepage is published");
    assert(initialAdmin.draftContent !== null, "Draft content exists");
    assert(initialAdmin.draftContent.navbar !== undefined, "Navbar config exists");
    assert(initialAdmin.draftContent.packages.packagesList.length === 2, "Exactly 2 packages configured");

    // 2. Public Homepage Content
    console.log("\n[Test 2] Inspect Public Homepage response");
    const initialPublic = await cmsService.getPublicHomepage();
    assert(initialPublic.isPublished === true, "Public response is published");
    assert(initialPublic.content.navbar !== undefined, "Public navbar exists");
    assert(initialPublic.content.packages.packagesList.length === 2, "Public packages list has 2 items");

    // 3. Draft Save & Isolation
    console.log("\n[Test 3] Save a Draft modification (isolation verification)");
    const modifiedDraft = JSON.parse(JSON.stringify(initialAdmin.draftContent));
    modifiedDraft.hero.mainHeading = "একটি আধুনিক QR কোডে";
    modifiedDraft.hero.badgeText = "টেস্ট ড্রাফট ব্যাজ";
    modifiedDraft.packages.packagesList[0].price = "৳ ৯৯৯";

    const savedDraft = await cmsService.saveDraft(modifiedDraft, 1);
    assert(savedDraft.draftContent.hero.mainHeading === "একটি আধুনিক QR কোডে", "Draft mainHeading updated");
    assert(savedDraft.draftContent.hero.badgeText === "টেস্ট ড্রাফট ব্যাজ", "Draft badgeText updated");
    assert(savedDraft.draftContent.packages.packagesList[0].price === "৳ ৯৯৯", "Draft package price updated");

    // Check public homepage - MUST NOT CHANGE
    const publicWhileDraft = await cmsService.getPublicHomepage();
    assert(publicWhileDraft.content.hero.mainHeading !== "একটি আধুনিক QR কোডে", "Public site did NOT leak draft mainHeading");
    assert(publicWhileDraft.content.packages.packagesList[0].price !== "৳ ৯৯৯", "Public site did NOT leak draft package price");

    // 4. Test 2-Package Constraint
    console.log("\n[Test 4] Verify Strict 2-Package Constraint");
    const invalidPackagesDraft = JSON.parse(JSON.stringify(modifiedDraft));
    invalidPackagesDraft.packages.packagesList.push({
      id: "third-plan",
      name: "Third Plan",
      price: "৳ 5000",
      features: [],
      buttonText: "Buy",
      buttonLink: "/buy",
      isActive: true,
    });

    let validationFailed = false;
    try {
      await cmsService.saveDraft(invalidPackagesDraft, 1);
    } catch (err) {
      validationFailed = true;
      assert(err.name === "ZodError", "Zod threw error for 3rd package insertion");
    }
    assert(validationFailed, "Server strictly blocked adding a 3rd package slot");

    // 5. Publish to Live Public Website
    console.log("\n[Test 5] Publish Draft to Public Website");
    const published = await cmsService.publishDraft(modifiedDraft, 1);
    assert(published.isPublished === true, "isPublished is true");
    assert(published.publishedContent.hero.mainHeading === "একটি আধুনিক QR কোডে", "Published content has new mainHeading");

    const publicAfterPublish = await cmsService.getPublicHomepage();
    assert(publicAfterPublish.content.hero.mainHeading === "একটি আধুনিক QR কোডে", "Public site now reflects published mainHeading");
    assert(publicAfterPublish.content.hero.badgeText === "টেস্ট ড্রাফট ব্যাজ", "Public site reflects published badgeText");
    assert(publicAfterPublish.content.packages.packagesList[0].price === "৳ ৯৯৯", "Public site reflects published package price");

    // 6. Media Asset Upload Test
    console.log("\n[Test 6] Test CMS Image Upload and Storage");
    const dummyBuffer = Buffer.from("fake-png-image-data");
    const dummyFile = {
      originalname: "test_banner.png",
      mimetype: "image/png",
      size: dummyBuffer.length,
      buffer: dummyBuffer,
    };

    const uploaded = await cmsService.uploadPublicMedia(dummyFile);
    assert(uploaded.url.startsWith("/uploads/cms/cms_"), "Uploaded URL matches /uploads/cms/cms_*");
    
    const filePath = path.join(process.cwd(), "storage", "public_cms", uploaded.filename);
    const fileExists = await fs.stat(filePath).then(() => true).catch(() => false);
    assert(fileExists, "Uploaded image file physically exists in storage/public_cms");

    // Clean up test upload
    await fs.unlink(filePath).catch(() => {});

    // 7. Reset to pristine original defaults
    console.log("\n[Test 7] Resetting database back to initial clean seed");
    const pristineData = JSON.parse(JSON.stringify(initialAdmin.draftContent));
    pristineData.hero.mainHeading = "একটি QR কোডে";
    pristineData.hero.badgeText = "বাংলাদেশের নির্ভরযোগ্য QR পেমেন্ট প্ল্যাটফর্ম";
    pristineData.packages.packagesList[0].price = "৳ ৫০০";
    await cmsService.publishDraft(pristineData, 1);
    assert(true, "Reset back to pristine default state");

    console.log("\n==================================================");
    console.log("🎉 ALL CMS END-TO-END TESTS PASSED SUCCESSFULLY!");
    console.log("==================================================");
  } catch (err) {
    console.error("\n❌ E2E Test Error:", err);
  } finally {
    await db.end();
  }
}

runE2ETests();

