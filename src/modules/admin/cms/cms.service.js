import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { db } from "../../../config/db.js";
import { cmsRepository } from "./cms.repository.js";
import { cmsHomepageSchema } from "./cms.validation.js";

// Helper to keep payment partners in CMS synced to institutions table
async function syncPaymentPartnersToInstitutions(partnersList = []) {
  if (!Array.isArray(partnersList) || partnersList.length === 0) return;

  for (const partner of partnersList) {
    if (!partner?.name) continue;
    const name = partner.name.trim();
    const logoUrl = partner.logo || null;
    const isActive = partner.isActive !== false;
    const isBank = partner.isBank !== false;
    const instType = isBank ? "commercial_bank" : "mfs";

    try {
      // Find matching institution by name or code
      const [existing] = await db.query(
        "SELECT id, name, logo_url FROM institutions WHERE name LIKE ? OR legal_name LIKE ? LIMIT 1",
        [`%${name}%`, `%${name}%`]
      );

      if (existing.length > 0) {
        await db.execute(
          `UPDATE institutions 
           SET logo_url = COALESCE(?, logo_url),
               status = ?,
               partnership_status = ?,
               directory_status = 'listed',
               updated_at = NOW()
           WHERE id = ?`,
          [logoUrl, isActive ? "active" : "inactive", isActive ? "active_partner" : "none", existing[0].id]
        );
      } else {
        const instCode = name.toUpperCase().replace(/[^A-Z0-9]/g, "_").slice(0, 20);
        await db.execute(
          `INSERT INTO institutions (
             institution_code, name, legal_name, institution_type, logo_url,
             status, directory_status, partnership_status, regulatory_status,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'listed', ?, 'scheduled_bank', NOW(), NOW())`,
          [instCode, name, name, instType, logoUrl, isActive ? "active" : "inactive", isActive ? "active_partner" : "none"]
        );
      }
    } catch (syncErr) {
      console.warn(`[CMS Partner Sync] Failed to sync ${name}:`, syncErr.message);
    }
  }
}

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

  // 12. Filter contact services
  if (clean.contact?.services) {
    clean.contact.services = clean.contact.services.filter(s => typeof s === "string" || s.isActive !== false);
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
    if (data.draftContent && !data.draftContent.contact) {
      data.draftContent.contact = {
        isActive: true,
        badge: "GET IN TOUCH",
        title: "Contact the Best Payment Partner in Bangladesh",
        subtitle: "Ready to digitize your business? Call us today or fill out the form for a free consultation and software live demonstration.",
        salesTitle: "Sales & Hotline",
        salesPhone: "09602-111215  09697-428578",
        salesHours: "Available Every Day 9:00 AM - 9:00 PM",
        emailTitle: "Email Inquiry",
        emailAddress: "info@csnbd.com",
        emailSubtitle: "We reply within 24 business hours",
        officeTitle: "Headquarters Office",
        officeAddress: "Wakil Tower (8th Floor) Ta-131, Gulshan-1 Badda Link Road, Gulshan, Dhaka-1212",
        formTitle: "Request a Free Demo / Quote",
        formSubtitle: "Fill up the form below and our software experts will contact you promptly.",
        submitButtonText: "Contact Us",
        services: [
          { id: "s1", name: "BanglaQR Payment Gateway", isActive: true, order: 1 },
          { id: "s2", name: "Merchant POS System", isActive: true, order: 2 },
          { id: "s3", name: "Dynamic QR Solution", isActive: true, order: 3 },
          { id: "s4", name: "API & ERP Integration", isActive: true, order: 4 },
          { id: "s5", name: "Custom Payment Software", isActive: true, order: 5 },
        ],
      };
    }
    return data;
  },

  async saveDraft(content, adminUserId) {
    const validated = cmsHomepageSchema.parse(content);
    const updated = await cmsRepository.saveDraft(validated, adminUserId);

    if (validated.partners?.partnersList) {
      await syncPaymentPartnersToInstitutions(validated.partners.partnersList);
    }

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

    if (validated.partners?.partnersList) {
      await syncPaymentPartnersToInstitutions(validated.partners.partnersList);
    }

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

    if (file.path) {
      await fs.copyFile(file.path, destinationPath);
      await fs.unlink(file.path).catch(() => {});
    } else if (file.buffer) {
      await fs.writeFile(destinationPath, file.buffer);
    } else {
      const err = new Error("No file data or path found on uploaded file");
      err.statusCode = 400;
      throw err;
    }

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
