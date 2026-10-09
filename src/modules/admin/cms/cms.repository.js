import { db } from "../../../config/db.js";

export const cmsRepository = {
  async getHomepage() {
    const [rows] = await db.query(
      `SELECT 
        c.id,
        c.page_slug,
        c.draft_content,
        c.published_content,
        c.is_published,
        c.last_saved_at,
        c.last_published_at,
        c.last_saved_by,
        c.last_published_by,
        u_saved.email AS last_saved_by_email,
        u_saved.phone AS last_saved_by_phone,
        u_pub.email AS last_published_by_email,
        u_pub.phone AS last_published_by_phone
      FROM cms_homepage c
      LEFT JOIN users u_saved ON c.last_saved_by = u_saved.id
      LEFT JOIN users u_pub ON c.last_published_by = u_pub.id
      WHERE c.page_slug = 'homepage'
      LIMIT 1`
    );

    if (rows.length === 0) {
      return null;
    }

    const record = rows[0];
    return {
      id: record.id,
      pageSlug: record.page_slug,
      draftContent: typeof record.draft_content === "string" ? JSON.parse(record.draft_content) : record.draft_content,
      publishedContent: typeof record.published_content === "string" ? JSON.parse(record.published_content) : record.published_content,
      isPublished: Boolean(record.is_published),
      lastSavedAt: record.last_saved_at,
      lastPublishedAt: record.last_published_at,
      lastSavedBy: record.last_saved_by ? {
        id: record.last_saved_by,
        name: record.last_saved_by_email?.split("@")[0] || "Admin",
        email: record.last_saved_by_email,
      } : null,
      lastPublishedBy: record.last_published_by ? {
        id: record.last_published_by,
        name: record.last_published_by_email?.split("@")[0] || "Admin",
        email: record.last_published_by_email,
      } : null,
    };
  },

  async getPublicHomepage() {
    const [rows] = await db.query(
      `SELECT published_content, is_published, last_published_at
       FROM cms_homepage
       WHERE page_slug = 'homepage'
       LIMIT 1`
    );

    if (rows.length === 0) {
      return null;
    }

    const record = rows[0];
    const content = typeof record.published_content === "string" 
      ? JSON.parse(record.published_content) 
      : (record.published_content || {});

    return {
      content,
      isPublished: Boolean(record.is_published),
      publishedAt: record.last_published_at,
    };
  },

  async saveDraft(draftContent, adminUserId) {
    const jsonStr = JSON.stringify(draftContent);
    await db.query(
      `UPDATE cms_homepage
       SET draft_content = ?,
           last_saved_by = ?,
           last_saved_at = NOW()
       WHERE page_slug = 'homepage'`,
      [jsonStr, adminUserId]
    );

    return this.getHomepage();
  },

  async publishDraft(publishedContent, adminUserId) {
    const jsonStr = JSON.stringify(publishedContent);
    await db.query(
      `UPDATE cms_homepage
       SET published_content = ?,
           draft_content = ?,
           is_published = 1,
           last_published_by = ?,
           last_published_at = NOW(),
           last_saved_by = ?,
           last_saved_at = NOW()
       WHERE page_slug = 'homepage'`,
      [jsonStr, jsonStr, adminUserId, adminUserId]
    );

    return this.getHomepage();
  },
};
