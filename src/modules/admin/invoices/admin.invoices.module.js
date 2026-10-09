import { db } from "../../../config/db.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";

export const adminInvoicesRepository = {
  async listInvoices({ search = "", status = "", dateFrom = "", dateTo = "", page = 1, limit = 15 }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push("(i.invoice_number LIKE ? OR i.customer_name LIKE ? OR i.customer_email LIKE ? OR m.merchant_code LIKE ? OR p.company_name LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }
    if (status && status !== "all") {
      conditions.push("i.status = ?");
      params.push(status);
    }
    if (dateFrom) {
      conditions.push("i.issue_date >= ?");
      params.push(dateFrom);
    }
    if (dateTo) {
      conditions.push("i.issue_date <= ?");
      params.push(dateTo);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countRows] = await db.execute(
      `
        SELECT COUNT(i.id) AS total
        FROM invoices i
        JOIN merchants m ON i.merchant_id = m.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        ${whereClause}
      `,
      params
    );

    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.execute(
      `
        SELECT i.*, m.merchant_code, COALESCE(p.company_name, m.merchant_code) AS company_name, u.email AS merchant_email
        FROM invoices i
        JOIN merchants m ON i.merchant_id = m.id
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        ${whereClause}
        ORDER BY i.created_at DESC
        LIMIT ? OFFSET ?
      `,
      [...params, String(limit), String(offset)]
    );

    return {
      invoices: rows.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoice_number,
        merchantId: r.merchant_id,
        merchantCode: r.merchant_code,
        companyName: r.company_name,
        merchantEmail: r.merchant_email,
        customerName: r.customer_name,
        customerEmail: r.customer_email,
        amount: Number(r.amount),
        currency: r.currency,
        issueDate: r.issue_date,
        dueDate: r.due_date,
        status: r.status,
        paymentReference: r.payment_reference,
        items: typeof r.items === "string" ? JSON.parse(r.items) : r.items,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit) || 1,
    };
  },

  async getInvoiceById(id) {
    const [rows] = await db.execute(
      `
        SELECT i.*, m.merchant_code, COALESCE(p.company_name, m.merchant_code) AS company_name, u.email AS merchant_email
        FROM invoices i
        JOIN merchants m ON i.merchant_id = m.id
        JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        WHERE i.id = ?
        LIMIT 1
      `,
      [id]
    );

    if (!rows.length) return null;
    const r = rows[0];

    return {
      id: r.id,
      invoiceNumber: r.invoice_number,
      merchantId: r.merchant_id,
      merchantCode: r.merchant_code,
      companyName: r.company_name,
      merchantEmail: r.merchant_email,
      customerName: r.customer_name,
      customerEmail: r.customer_email,
      amount: Number(r.amount),
      currency: r.currency,
      issueDate: r.issue_date,
      dueDate: r.due_date,
      status: r.status,
      paymentReference: r.payment_reference,
      items: typeof r.items === "string" ? JSON.parse(r.items) : r.items,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  async updateInvoiceStatus(id, status, paymentReference) {
    await db.execute(
      `UPDATE invoices SET status = ?, payment_reference = COALESCE(?, payment_reference), updated_at = NOW() WHERE id = ?`,
      [status, paymentReference || null, id]
    );
  },
};

export const adminInvoicesService = {
  async listInvoices(filters) {
    return await adminInvoicesRepository.listInvoices(filters);
  },

  async getInvoice(id) {
    const inv = await adminInvoicesRepository.getInvoiceById(id);
    if (!inv) {
      const err = new Error("Invoice not found");
      err.statusCode = 404;
      throw err;
    }
    return inv;
  },

  async updateStatus(id, { status, paymentReference }, adminUser, ip, userAgent) {
    await adminInvoicesRepository.updateInvoiceStatus(id, status, paymentReference);
    await logAdminAudit({
      userId: adminUser?.id,
      adminEmail: adminUser?.email,
      action: "invoice_status_update",
      resourceType: "invoice",
      resourceId: id,
      details: { status, paymentReference },
      ip,
      userAgent,
    });
    return { success: true, message: `Invoice updated to '${status}'` };
  },
};

export const adminInvoicesController = {
  async list(req, res, next) {
    try {
      const data = await adminInvoicesService.listInvoices(req.query);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const id = Number(req.params.invoiceId);
      const data = await adminInvoicesService.getInvoice(id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async updateStatus(req, res, next) {
    try {
      const id = Number(req.params.invoiceId);
      const result = await adminInvoicesService.updateStatus(
        id,
        req.body,
        req.user,
        req.ip,
        req.get("user-agent")
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};

