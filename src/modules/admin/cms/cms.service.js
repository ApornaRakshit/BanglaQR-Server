import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { cmsRepository } from "./cms.repository.js";
import { cmsHomepageSchema } from "./cms.validation.js";

const PUBLIC_CMS_DIR = path.join(process.cwd(), "storage", "public_cms");

// Helper to ensure public CMS directory exists
async function ensureCmsStorageDir() {
  try {
    await fs.mkdir(PUBLIC_CMS_DIR, { recursive: true });
  } catch (err) {
    // directory exists or cannot create
  }
}

// Helper to filter out inactive items for public response
function sanitizeForPublic(content) {
  if (!content || typeof content !== "object") return {};

  const clean = JSON.parse(JSON.stringify(content));

  // 1. Filter navbar menu items
  if (clean.navbar?.menuItems) {
    clean.navbar.menuItems = clean.navbar.menuItems.filter(l => l.isActive !== false);
  }

  // 2. Filter hero floating cards
  if (clean.hero?.floatingCards) {
    clean.hero.floatingCards = clean.hero.floatingCards.filter(c => c.isActive !== false);
  }

  // 3. Filter payment partners
  if (clean.partners?.partnersList) {
    clean.partners.partnersList = clean.partners.partnersList.filter(p => p.isActive !== false);
  }

  // 4. Filter why BanglaQR features
  if (clean.whyBanglaQr?.features) {
    clean.whyBanglaQr.features = clean.whyBanglaQr.features.filter(f => f.isActive !== false);
  }

  // 5. Filter business growth stats
  if (clean.businessGrowth?.stats) {
    clean.businessGrowth.stats = clean.businessGrowth.stats.filter(s => s.isActive !== false);
  }

  // 6. Filter how it works steps
  if (clean.howItWorks?.steps) {
    clean.howItWorks.steps = clean.howItWorks.steps.filter(s => s.isActive !== false);
  }

  // 7. Filter dashboard showcase features
  if (clean.dashboardShowcase?.features) {
    clean.dashboardShowcase.features = clean.dashboardShowcase.features.filter(h => h.isActive !== false);
  }

  // 8. Filter business solutions
  if (clean.businessSolutions?.solutionsList) {
    clean.businessSolutions.solutionsList = clean.businessSolutions.solutionsList.filter(s => s.isActive !== false);
  }

  // 9. Filter packages items
  if (clean.packages?.packagesList) {
    clean.packages.packagesList = clean.packages.packagesList.filter(p => p.isActive !== false);
  }

  // 10. Filter testimonials
  if (clean.testimonials?.testimonialsList) {
    clean.testimonials.testimonialsList = clean.testimonials.testimonialsList.filter(t => t.isActive !== false);
  }

  // 11. Filter footer links
  if (clean.footer?.quickLinks) {
    clean.footer.quickLinks = clean.footer.quickLinks.filter(l => l.isActive !== false);
  }
  if (clean.footer?.supportLinks) {
    clean.footer.supportLinks = clean.footer.supportLinks.filter(l => l.isActive !== false);
  }
  if (clean.footer?.socialLinks) {
    clean.footer.socialLinks = clean.footer.socialLinks.filter(l => l.isActive !== false);
  }
  if (clean.footer?.legalLinks) {
    clean.footer.legalLinks = clean.footer.legalLinks.filter(l => l.isActive !== false);
  }

  return clean;
}

export const cmsService = {
  async getHomepageForAdmin() {
    const data = await cmsRepository.getHomepage();
    if (!data) {
      return {
        id: null,
        pageSlug: "homepage",
        draftContent: {},
        publishedContent: {},
        isPublished: false,
        lastSavedAt: null,
        lastPublishedAt: null,
      };
    }
    return data;
  },

  async saveDraft(content, adminUserId) {
    const validated = cmsHomepageSchema.parse(content);
    const updated = await cmsRepository.saveDraft(validated, adminUserId);
    return updated;
  },

  async publishDraft(content, adminUserId) {
    // If content is provided in body, validate it; otherwise get current draft
    let toPublish = content;
    if (!toPublish || Object.keys(toPublish).length === 0) {
      const current = await cmsRepository.getHomepage();
      toPublish = current?.draftContent || {};
    }

    const validated = cmsHomepageSchema.parse(toPublish);
    const updated = await cmsRepository.publishDraft(validated, adminUserId);
    return updated;
  },

  async getPublicHomepage() {
    const data = await cmsRepository.getPublicHomepage();
    if (!data || !data.content) {
      return {
        content: {},
        isPublished: false,
        publishedAt: null,
      };
    }

    return {
      content: sanitizeForPublic(data.content),
      isPublished: data.isPublished,
      publishedAt: data.publishedAt,
    };
  },

  async uploadPublicMedia(file) {
    if (!file) {
      const err = new Error("No file uploaded");
      err.statusCode = 400;
      throw err;
    }

    await ensureCmsStorageDir();

    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    const randomHex = crypto.randomBytes(8).toString("hex");
    const safeFilename = `cms_${Date.now()}_${randomHex}${ext}`;
    const destinationPath = path.join(PUBLIC_CMS_DIR, safeFilename);

    await fs.writeFile(destinationPath, file.buffer);

    const publicUrl = `/uploads/cms/${safeFilename}`;

    return {
      filename: safeFilename,
      url: publicUrl,
      size: file.size,
      mimeType: file.mimetype,
      originalName: file.originalname,
    };
  },
};
