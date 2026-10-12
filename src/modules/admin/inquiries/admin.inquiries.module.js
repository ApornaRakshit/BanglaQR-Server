import { db } from "../../../config/db.js";

export const adminInquiriesRepository = {
  async listInquiries({ status, search, page = 1, limit = 20 } = {}) {
    const offset = (Math.max(1, page) - 1) * limit;
    const conditions = [];
    const params = [];

    if (status && status !== "all") {
      conditions.push("status = ?");
      params.push(status);
    }

    if (search && search.trim()) {
      conditions.push("(full_name LIKE ? OR email LIKE ? OR phone LIKE ? OR company_name LIKE ? OR inquiry_reference LIKE ? OR service_name LIKE ? OR message LIKE ?)");
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term, term, term);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Total count with filters
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM contact_inquiries ${whereClause}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    // Get paginated rows
    const numLimit = Math.max(1, parseInt(limit, 10) || 20);
    const numOffset = Math.max(0, (Math.max(1, parseInt(page, 10) || 1) - 1) * numLimit);

    const [rows] = await db.query(
      `
        SELECT *
        FROM contact_inquiries
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${numLimit} OFFSET ${numOffset}
      `,
      params
    );

    // Status counts summary for top tabs
    const [statusCounts] = await db.query(`
      SELECT 
        COUNT(*) AS total_all,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS total_new,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS total_in_progress,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS total_replied,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS total_closed
      FROM contact_inquiries
    `);

    const summary = {
      all: Number(statusCounts[0]?.total_all || 0),
      new: Number(statusCounts[0]?.total_new || 0),
      in_progress: Number(statusCounts[0]?.total_in_progress || 0),
      replied: Number(statusCounts[0]?.total_replied || 0),
      closed: Number(statusCounts[0]?.total_closed || 0),
    };

    return {
      inquiries: rows.map((r) => ({
        id: r.id,
        inquiryReference: r.inquiry_reference || `INQ-${String(r.id).padStart(5, '0')}`,
        inquiry_reference: r.inquiry_reference || `INQ-${String(r.id).padStart(5, '0')}`,
        fullName: r.full_name,
        full_name: r.full_name,
        phone: r.phone,
        email: r.email,
        companyName: r.company_name,
        company_name: r.company_name,
        serviceId: r.service_id,
        serviceName: r.service_name,
        service_name: r.service_name,
        message: r.message,
        adminNotes: r.admin_notes,
        admin_notes: r.admin_notes,
        status: r.status,
        ipAddress: r.ip_address,
        userAgent: r.user_agent,
        createdAt: r.created_at,
        created_at: r.created_at,
        updatedAt: r.updated_at,
      })),
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
      },
      summary,
    };
  },

  async getInquiryById(id) {
    const [rows] = await db.execute("SELECT * FROM contact_inquiries WHERE id = ?", [id]);
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      inquiryReference: r.inquiry_reference || `INQ-${String(r.id).padStart(5, '0')}`,
      inquiry_reference: r.inquiry_reference || `INQ-${String(r.id).padStart(5, '0')}`,
      fullName: r.full_name,
      full_name: r.full_name,
      phone: r.phone,
      email: r.email,
      companyName: r.company_name,
      company_name: r.company_name,
      serviceId: r.service_id,
      serviceName: r.service_name,
      service_name: r.service_name,
      message: r.message,
      adminNotes: r.admin_notes,
      admin_notes: r.admin_notes,
      status: r.status,
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      createdAt: r.created_at,
      created_at: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  async updateStatus(id, status, adminNotes = undefined) {
    if (adminNotes !== undefined) {
      const [res] = await db.execute(
        "UPDATE contact_inquiries SET status = ?, admin_notes = ? WHERE id = ?",
        [status, adminNotes, id]
      );
      return res.affectedRows > 0;
    }
    const [res] = await db.execute(
      "UPDATE contact_inquiries SET status = ? WHERE id = ?",
      [status, id]
    );
    return res.affectedRows > 0;
  },

  async deleteInquiry(id) {
    const [res] = await db.execute("DELETE FROM contact_inquiries WHERE id = ?", [id]);
    return res.affectedRows > 0;
  },
};

export const adminInquiriesController = {
  async list(req, res, next) {
    try {
      const { status, search, page, limit } = req.query;
      const data = await adminInquiriesRepository.listInquiries({
        status,
        search,
        page: Number(page) || 1,
        limit: Number(limit) || 20,
      });
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const id = Number(req.params.id);
      const inquiry = await adminInquiriesRepository.getInquiryById(id);
      if (!inquiry) {
        return res.status(404).json({ success: false, message: "Inquiry not found" });
      }
      res.json({ success: true, data: inquiry });
    } catch (err) {
      next(err);
    }
  },

  async updateStatus(req, res, next) {
    try {
      const id = Number(req.params.id);
      const { status, adminNotes } = req.body;
      const validStatuses = ["new", "in_progress", "replied", "closed"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status. Must be one of: new, in_progress, replied, closed",
        });
      }

      const updated = await adminInquiriesRepository.updateStatus(id, status, adminNotes);
      if (!updated) {
        return res.status(404).json({ success: false, message: "Inquiry not found" });
      }

      const inquiry = await adminInquiriesRepository.getInquiryById(id);
      res.json({ success: true, message: "Inquiry status updated", data: inquiry });
    } catch (err) {
      next(err);
    }
  },

  async delete(req, res, next) {
    try {
      const id = Number(req.params.id);
      const deleted = await adminInquiriesRepository.deleteInquiry(id);
      if (!deleted) {
        return res.status(404).json({ success: false, message: "Inquiry not found" });
      }
      res.json({ success: true, message: "Inquiry deleted successfully" });
    } catch (err) {
      next(err);
    }
  },
};
