import { db } from "../src/config/db.js";
import { cmsService } from "../src/modules/admin/cms/cms.service.js";

async function runTest() {
  try {
    console.log("1. Testing cmsService.getHomepageForAdmin()...");
    const adminData = await cmsService.getHomepageForAdmin();
    console.log("   - Found slug:", adminData.pageSlug);
    console.log("   - isPublished:", adminData.isPublished);
    console.log("   - Hero headline in draft:", adminData.draftContent?.hero?.headline);

    console.log("2. Testing cmsService.getPublicHomepage()...");
    const publicData = await cmsService.getPublicHomepage();
    console.log("   - isPublished:", publicData.isPublished);
    console.log("   - Hero headline in public:", publicData.content?.hero?.headline);
    console.log("   - Navbar link count:", publicData.content?.navbar?.navLinks?.length);

    console.log("3. Testing cmsService.saveDraft() with a minor modification...");
    const draftClone = JSON.parse(JSON.stringify(adminData.draftContent));
    draftClone.hero.badgeSubtext = "বাংলাদেশ ব্যাংকের ন্যাশনাল পেমেন্ট সুইচ";
    const saved = await cmsService.saveDraft(draftClone, 1);
    console.log("   - Saved draft badgeSubtext:", saved.draftContent?.hero?.badgeSubtext);

    console.log("4. Verifying public homepage did NOT change before publish...");
    const publicDataAfterDraft = await cmsService.getPublicHomepage();
    console.log("   - Public badgeSubtext still:", publicDataAfterDraft.content?.hero?.badgeSubtext);

    console.log("5. Testing cmsService.publishDraft()...");
    const published = await cmsService.publishDraft(draftClone, 1);
    console.log("   - Published successfully. isPublished:", published.isPublished);

    const publicDataAfterPublish = await cmsService.getPublicHomepage();
    console.log("   - Public badgeSubtext now updated to:", publicDataAfterPublish.content?.hero?.badgeSubtext);

    console.log("✅ All CMS backend service tests PASSED!");
  } catch (err) {
    console.error("❌ CMS backend test failed:", err);
  } finally {
    await db.end();
  }
}

runTest();
