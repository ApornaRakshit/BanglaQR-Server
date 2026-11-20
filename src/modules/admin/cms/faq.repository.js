import { db } from "../../../config/db.js";

export const faqRepository = {
  // Public: Get all published FAQs ordered by display_order ASC, id ASC
  async getPublishedFaqs() {
    const [rows] = await db.query(
      `SELECT id, question, answer, display_order, status, created_at, updated_at
       FROM faqs
       WHERE status = 'published'
       ORDER BY display_order ASC, id ASC`
    );
    return rows.map((r) => ({
      id: r.id,
      question: r.question,
      answer: r.answer,
      displayOrder: r.display_order,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  // Admin: Get all FAQs with optional search and status filter
  async getAllFaqs({ search, status } = {}) {
    let sql = `SELECT id, question, answer, display_order, status, created_at, updated_at FROM faqs WHERE 1=1`;
    const params = [];

    if (status && (status === "published" || status === "draft")) {
      sql += ` AND status = ?`;
      params.push(status);
    }

    if (search && search.trim()) {
      sql += ` AND (question LIKE ? OR answer LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term);
    }

    sql += ` ORDER BY display_order ASC, id ASC`;
    const [rows] = await db.query(sql, params);

    return rows.map((r) => ({
      id: r.id,
      question: r.question,
      answer: r.answer,
      displayOrder: r.display_order,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  // Get single FAQ by ID
  async getById(id) {
    const [rows] = await db.query(
      `SELECT id, question, answer, display_order, status, created_at, updated_at
       FROM faqs
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      question: r.question,
      answer: r.answer,
      displayOrder: r.display_order,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  // Create FAQ
  async create({ question, answer, displayOrder, status = "published" }) {
    let finalOrder = Number(displayOrder);
    if (!finalOrder || isNaN(finalOrder)) {
      const [maxRow] = await db.query(`SELECT MAX(display_order) AS maxOrder FROM faqs`);
      finalOrder = (maxRow[0]?.maxOrder || 0) + 1;
    }

    const [result] = await db.query(
      `INSERT INTO faqs (question, answer, display_order, status)
       VALUES (?, ?, ?, ?)`,
      [question.trim(), answer.trim(), finalOrder, status === "draft" ? "draft" : "published"]
    );

    return this.getById(result.insertId);
  },

  // Update FAQ
  async update(id, { question, answer, displayOrder, status }) {
    const existing = await this.getById(id);
    if (!existing) return null;

    const updatedQuestion = question !== undefined ? question.trim() : existing.question;
    const updatedAnswer = answer !== undefined ? answer.trim() : existing.answer;
    const updatedOrder = displayOrder !== undefined && !isNaN(Number(displayOrder)) ? Number(displayOrder) : existing.displayOrder;
    const updatedStatus = status !== undefined && (status === "draft" || status === "published") ? status : existing.status;

    await db.query(
      `UPDATE faqs
       SET question = ?,
           answer = ?,
           display_order = ?,
           status = ?
       WHERE id = ?`,
      [updatedQuestion, updatedAnswer, updatedOrder, updatedStatus, id]
    );

    return this.getById(id);
  },

  // Delete FAQ
  async delete(id) {
    const [result] = await db.query(`DELETE FROM faqs WHERE id = ?`, [id]);
    return result.affectedRows > 0;
  },

  // Update status (published / draft)
  async updateStatus(id, status) {
    const safeStatus = status === "draft" ? "draft" : "published";
    const [result] = await db.query(`UPDATE faqs SET status = ? WHERE id = ?`, [safeStatus, id]);
    if (result.affectedRows === 0) return null;
    return this.getById(id);
  },

  // Reorder items
  // items: [{ id: 1, displayOrder: 1 }, { id: 2, displayOrder: 2 }, ...]
  async reorder(items) {
    if (!Array.isArray(items) || items.length === 0) return false;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      for (const item of items) {
        if (item.id && !isNaN(Number(item.displayOrder))) {
          await connection.query(
            `UPDATE faqs SET display_order = ? WHERE id = ?`,
            [Number(item.displayOrder), item.id]
          );
        }
      }

      await connection.commit();
      return true;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  },
};

