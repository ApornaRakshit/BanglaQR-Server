import { db } from "../../../config/db.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";
import { generateInvoicePdf } from "../../merchants/invoices/merchant.invoices.pdf.js";
import { generateInvoiceExcelWorkbook } from "../../invoices/invoice.excel.js";

export const adminInvoicesRepository = {
  // ==========================================
  // 1. STATS / AGGREGATE SUMMARY
  // ==========================================
  async getInvoiceStats() {
    const today = new Date().toISOString().split("T")[0];

    const [rows] = await db.execute(`
      SELECT
        COUNT(*) AS total_invoices,
        COUNT(CASE WHEN status = 'draft' THEN 1 END) AS draft_count,
        COUNT(CASE WHEN status = 'sent' AND (due_date >= ? OR due_date IS NULL) THEN 1 END) AS sent_count,
        COUNT(CASE WHEN status = 'paid' THEN 1 END) AS paid_count,
        COUNT(CASE WHEN status = 'partially_paid' AND (due_date >= ? OR due_date IS NULL) THEN 1 END) AS partially_paid_count,
        COUNT(CASE WHEN (status = 'overdue' OR ((status = 'sent' OR status = 'partially_paid') AND due_date < ?)) THEN 1 END) AS overdue_count,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled_count,
        COALESCE(SUM(CASE WHEN status NOT IN ('cancelled', 'paid') THEN balance_due ELSE 0 END), 0) AS total_outstanding,
        COALESCE(SUM(amount_paid), 0) AS total_collected,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN amount ELSE 0 END), 0) AS total_revenue
      FROM invoices
    `, [today, today, today]);

    const s = rows[0] || {};
    return {
      totalInvoices: Number(s.total_invoices || 0),
      draftInvoices: Number(s.draft_count || 0),
      sentInvoices: Number(s.sent_count || 0),
      paidInvoices: Number(s.paid_count || 0),
      partiallyPaidInvoices: Number(s.partially_paid_count || 0),
      overdueInvoices: Number(s.overdue_count || 0),
      cancelledInvoices: Number(s.cancelled_count || 0),
      totalOutstanding: Number(s.total_outstanding || 0),
      totalCollected: Number(s.total_collected || 0),
      totalRevenue: Number(s.total_revenue || 0),
    };
  },

  // ==========================================
  // 2. LIST INVOICES (WITH DUAL ALIASES)
  // ==========================================
  async listInvoices({ search = "", status = "", dateFrom = "", dateTo = "", merchantId = "", page = 1, limit = 15, exportAll = false } = {}) {
    const conditions = [];
    const params = [];
    const today = new Date().toISOString().split("T")[0];

    if (search) {
      conditions.push("(i.invoice_number LIKE ? OR i.customer_name LIKE ? OR i.customer_email LIKE ? OR m.merchant_code LIKE ? OR p.company_name LIKE ?)");
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
    }
    if (merchantId) {
      conditions.push("i.merchant_id = ?");
      params.push(merchantId);
    }
    if (status && status !== "all") {
      if (status === "overdue") {
        conditions.push("(i.status = 'overdue' OR (i.status IN ('sent', 'partially_paid') AND i.due_date < ?))");
        params.push(today);
      } else {
        conditions.push("i.status = ?");
        params.push(status);
      }
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
        LEFT JOIN merchants m ON i.merchant_id = m.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        ${whereClause}
      `,
      params
    );

    const total = Number(countRows[0]?.total || 0);

    let query = `
      SELECT i.*, 
             m.merchant_code, 
             COALESCE(p.company_name, m.merchant_code, 'Merchant information unavailable') AS company_name, 
             COALESCE(mc.email, u.email) AS merchant_email,
             COALESCE(mc.phone, u.phone) AS merchant_phone
      FROM invoices i
      LEFT JOIN merchants m ON i.merchant_id = m.id
      LEFT JOIN users u ON m.user_id = u.id
      LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
      LEFT JOIN merchant_contacts mc ON mc.merchant_id = m.id
      ${whereClause}
      ORDER BY i.created_at DESC
    `;

    const queryParams = [...params];
    const isUnpaginated = exportAll || String(limit).toLowerCase() === "all";

    if (!isUnpaginated) {
      const pageNum = Math.max(1, Number(page || 1));
      const limitNum = Math.max(1, Math.min(500, Number(limit || 15)));
      const offset = (pageNum - 1) * limitNum;
      query += ` LIMIT ? OFFSET ?`;
      queryParams.push(String(limitNum), String(offset));
    }

    const [rows] = await db.execute(query, queryParams);

    const invoices = rows.map((r) => {
      let derivedStatus = r.status;
      if (r.status !== "cancelled" && r.status !== "paid" && r.due_date && r.due_date < today && Number(r.balance_due) > 0) {
        derivedStatus = "overdue";
      }

      let parsedItems = r.items;
      if (typeof parsedItems === "string") {
        try { parsedItems = JSON.parse(parsedItems); } catch { parsedItems = []; }
      }
      if (!Array.isArray(parsedItems)) parsedItems = [];

      return {
        id: r.id,
        invoice_id: r.id,
        invoiceNumber: r.invoice_number,
        invoice_number: r.invoice_number,
        merchantId: r.merchant_id,
        merchant_id: r.merchant_id,
        merchantCode: r.merchant_code,
        merchant_code: r.merchant_code,
        companyName: r.company_name,
        company_name: r.company_name,
        merchantEmail: r.merchant_email,
        merchant_email: r.merchant_email,
        merchantPhone: r.merchant_phone,
        merchant_phone: r.merchant_phone,
        customerId: r.customer_id,
        customer_id: r.customer_id,
        customerName: r.customer_name,
        customer_name: r.customer_name,
        customerEmail: r.customer_email,
        customer_email: r.customer_email,
        customerPhone: r.customer_phone,
        customer_phone: r.customer_phone,
        customerBusinessName: r.customer_business_name,
        customer_business_name: r.customer_business_name,
        customerAddress: r.customer_address,
        customer_address: r.customer_address,
        amount: Number(r.amount),
        totalAmount: Number(r.amount),
        grandTotal: Number(r.amount),
        subtotal: Number(r.subtotal || r.amount),
        discountAmount: Number(r.discount_amount || 0),
        discount_amount: Number(r.discount_amount || 0),
        taxAmount: Number(r.tax_amount || 0),
        tax_amount: Number(r.tax_amount || 0),
        amountPaid: Number(r.amount_paid || 0),
        amount_paid: Number(r.amount_paid || 0),
        balanceDue: Number(r.balance_due || 0),
        balance_due: Number(r.balance_due || 0),
        currency: r.currency || "BDT",
        issueDate: r.issue_date,
        issue_date: r.issue_date,
        dueDate: r.due_date,
        due_date: r.due_date,
        status: derivedStatus,
        rawStatus: r.status,
        poNumber: r.po_number,
        po_number: r.po_number,
        referenceNumber: r.reference_number,
        reference_number: r.reference_number,
        paymentReference: r.payment_reference,
        payment_reference: r.payment_reference,
        items: parsedItems,
        notes: r.notes,
        paymentInstructions: r.payment_instructions,
        termsConditions: r.terms_conditions,
        footerMessage: r.footer_message,
        createdAt: r.created_at,
        created_at: r.created_at,
        updatedAt: r.updated_at,
        updated_at: r.updated_at,
      };
    });

    return {
      invoices,
      total,
      page: isUnpaginated ? 1 : Number(page || 1),
      limit: isUnpaginated ? total : Number(limit || 15),
      totalPages: isUnpaginated ? 1 : (Math.ceil(total / Number(limit || 15)) || 1),
    };
  },

  // ==========================================
  // 3. GET SINGLE INVOICE BY ID
  // ==========================================
  async getInvoiceById(id) {
    const today = new Date().toISOString().split("T")[0];

    const [rows] = await db.execute(
      `
        SELECT i.*, 
               m.merchant_code, 
               COALESCE(p.company_name, m.merchant_code, 'Merchant information unavailable') AS company_name, 
               p.address AS merchant_address, p.city AS merchant_city, p.country AS merchant_country,
               COALESCE(mc.email, u.email) AS merchant_email,
               COALESCE(mc.phone, u.phone) AS merchant_phone
        FROM invoices i
        LEFT JOIN merchants m ON i.merchant_id = m.id
        LEFT JOIN users u ON m.user_id = u.id
        LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
        LEFT JOIN merchant_contacts mc ON mc.merchant_id = m.id
        WHERE i.id = ?
        LIMIT 1
      `,
      [id]
    );

    if (!rows.length) return null;
    const r = rows[0];

    let derivedStatus = r.status;
    if (r.status !== "cancelled" && r.status !== "paid" && r.due_date && r.due_date < today && Number(r.balance_due) > 0) {
      derivedStatus = "overdue";
    }

    let parsedItems = r.items;
    if (typeof parsedItems === "string") {
      try { parsedItems = JSON.parse(parsedItems); } catch { parsedItems = []; }
    }
    if (!Array.isArray(parsedItems)) parsedItems = [];

    // Fetch payments
    const [payments] = await db.execute(
      `SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY payment_date DESC, created_at DESC`,
      [id]
    );

    // Fetch history
    const [history] = await db.execute(
      `SELECT * FROM invoice_history WHERE invoice_id = ? ORDER BY created_at DESC`,
      [id]
    );

    return {
      id: r.id,
      invoice_id: r.id,
      invoiceNumber: r.invoice_number,
      invoice_number: r.invoice_number,
      merchantId: r.merchant_id,
      merchant_id: r.merchant_id,
      merchantCode: r.merchant_code,
      merchant_code: r.merchant_code,
      companyName: r.company_name,
      company_name: r.company_name,
      merchantEmail: r.merchant_email,
      merchant_email: r.merchant_email,
      merchantPhone: r.merchant_phone,
      merchant_phone: r.merchant_phone,
      merchant: {
        companyName: r.company_name,
        company_name: r.company_name,
        address: [r.merchant_address, r.merchant_city, r.merchant_country].filter(Boolean).join(", "),
        email: r.merchant_email,
        phone: r.merchant_phone,
      },
      customerId: r.customer_id,
      customer_id: r.customer_id,
      customerName: r.customer_name,
      customer_name: r.customer_name,
      customerEmail: r.customer_email,
      customer_email: r.customer_email,
      customerPhone: r.customer_phone,
      customer_phone: r.customer_phone,
      customerBusinessName: r.customer_business_name,
      customer_business_name: r.customer_business_name,
      customerAddress: r.customer_address,
      customer_address: r.customer_address,
      amount: Number(r.amount),
      totalAmount: Number(r.amount),
      grandTotal: Number(r.amount),
      subtotal: Number(r.subtotal || r.amount),
      discountAmount: Number(r.discount_amount || 0),
      discount_amount: Number(r.discount_amount || 0),
      taxAmount: Number(r.tax_amount || 0),
      tax_amount: Number(r.tax_amount || 0),
      amountPaid: Number(r.amount_paid || 0),
      amount_paid: Number(r.amount_paid || 0),
      balanceDue: Number(r.balance_due || 0),
      balance_due: Number(r.balance_due || 0),
      currency: r.currency || "BDT",
      issueDate: r.issue_date,
      issue_date: r.issue_date,
      dueDate: r.due_date,
      due_date: r.due_date,
      status: derivedStatus,
      rawStatus: r.status,
      poNumber: r.po_number,
      po_number: r.po_number,
      referenceNumber: r.reference_number,
      reference_number: r.reference_number,
      paymentReference: r.payment_reference,
      payment_reference: r.payment_reference,
      notes: r.notes,
      paymentInstructions: r.payment_instructions,
      termsConditions: r.terms_conditions,
      footerMessage: r.footer_message,
      items: parsedItems,
      payments: payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        paymentDate: p.payment_date,
        paymentMethod: p.payment_method,
        referenceId: p.reference_id,
        notes: p.notes,
        isGatewayVerified: Boolean(p.is_gateway_verified),
        createdAt: p.created_at,
      })),
      history: history.map((h) => ({
        id: h.id,
        action: h.action,
        description: h.description,
        metadata: typeof h.metadata === "string" ? JSON.parse(h.metadata) : h.metadata,
        createdAt: h.created_at,
      })),
      createdAt: r.created_at,
      created_at: r.created_at,
      updatedAt: r.updated_at,
      updated_at: r.updated_at,
    };
  },

  // ==========================================
  // 4. UPDATE INVOICE STATUS
  // ==========================================
  async updateInvoiceStatus(id, status, paymentReference) {
    const isPaid = status === "paid";
    await db.execute(
      `UPDATE invoices 
       SET status = ?, 
           payment_reference = COALESCE(?, payment_reference),
           amount_paid = CASE WHEN ? = 'paid' THEN amount ELSE amount_paid END,
           balance_due = CASE WHEN ? = 'paid' THEN 0.00 ELSE balance_due END,
           paid_at = CASE WHEN ? = 'paid' THEN NOW() ELSE paid_at END,
           updated_at = NOW() 
       WHERE id = ?`,
      [status, paymentReference || null, status, status, status, id]
    );

    // Record in history
    await db.execute(
      `INSERT INTO invoice_history (merchant_id, invoice_id, action, description, created_at)
       SELECT merchant_id, ?, 'status_change', CONCAT('Admin updated status to ', ?), NOW()
       FROM invoices WHERE id = ? LIMIT 1`,
      [id, status, id]
    );
  },

  // ==========================================
  // 5. GET PAYMENTS FOR EXPORT
  // ==========================================
  async getPaymentsForInvoices(invoiceIds = []) {
    if (!invoiceIds.length) return [];
    const placeholders = invoiceIds.map(() => "?").join(",");
    const [rows] = await db.execute(
      `
        SELECT p.*, i.invoice_number, m.merchant_code
        FROM invoice_payments p
        JOIN invoices i ON p.invoice_id = i.id
        LEFT JOIN merchants m ON p.merchant_id = m.id
        WHERE p.invoice_id IN (${placeholders})
        ORDER BY p.payment_date DESC, p.created_at DESC
      `,
      invoiceIds
    );
    return rows;
  },
};

export const adminInvoicesService = {
  async getStats() {
    return await adminInvoicesRepository.getInvoiceStats();
  },

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

  async getInvoicePdfBuffer(id) {
    const inv = await this.getInvoice(id);
    return await generateInvoicePdf({
      invoiceNumber: inv.invoiceNumber,
      issueDate: inv.issueDate,
      dueDate: inv.dueDate,
      status: inv.status,
      currency: inv.currency,
      subtotal: inv.subtotal,
      discountAmount: inv.discountAmount,
      taxAmount: inv.taxAmount,
      totalAmount: inv.grandTotal,
      amountPaid: inv.amountPaid,
      balanceDue: inv.balanceDue,
      items: inv.items,
      customer: {
        name: inv.customerName,
        customer_name: inv.customerName,
        businessName: inv.customerBusinessName,
        customer_business_name: inv.customerBusinessName,
        email: inv.customerEmail,
        customer_email: inv.customerEmail,
        phone: inv.customerPhone,
        customer_phone: inv.customerPhone,
        address: inv.customerAddress,
        customer_address: inv.customerAddress,
      },
      merchant: inv.merchant || {
        companyName: inv.companyName,
        email: inv.merchantEmail,
        phone: inv.merchantPhone,
      },
      notes: inv.notes,
      paymentInstructions: inv.paymentInstructions,
      termsConditions: inv.termsConditions,
      footerMessage: inv.footerMessage,
    });
  },

  async exportExcel(filters) {
    // Unpaginated query for all matching invoices
    const result = await adminInvoicesRepository.listInvoices({ ...filters, exportAll: true });
    const invoices = result.invoices || [];

    const invoiceIds = invoices.map((i) => i.id);
    const payments = await adminInvoicesRepository.getPaymentsForInvoices(invoiceIds);

    return await generateInvoiceExcelWorkbook({
      invoices,
      payments,
      scope: "admin",
    });
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
  async getStats(req, res, next) {
    try {
      const data = await adminInvoicesService.getStats();
      res.json({ success: true, data, stats: data });
    } catch (err) {
      next(err);
    }
  },

  async list(req, res, next) {
    try {
      const data = await adminInvoicesService.listInvoices(req.query);
      res.json({
        success: true,
        data,
        invoices: data.invoices,
        total: data.total,
        page: data.page,
        totalPages: data.totalPages,
      });
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const id = Number(req.params.invoiceId || req.params.id);
      if (!id || isNaN(id)) {
        return res.status(400).json({ success: false, message: "Invalid invoice ID" });
      }
      const data = await adminInvoicesService.getInvoice(id);
      res.json({ success: true, data, invoice: data });
    } catch (err) {
      next(err);
    }
  },

  async downloadPdf(req, res, next) {
    try {
      const id = Number(req.params.invoiceId || req.params.id);
      const pdfBuffer = await adminInvoicesService.getInvoicePdfBuffer(id);
      const inv = await adminInvoicesService.getInvoice(id);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="Invoice-${inv.invoiceNumber || id}.pdf"`);
      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  },

  async exportExcel(req, res, next) {
    try {
      const excelBuffer = await adminInvoicesService.exportExcel(req.query);
      const today = new Date().toISOString().split("T")[0];

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="banglaqr-admin-invoices-${today}.xlsx"`);
      res.send(excelBuffer);
    } catch (err) {
      next(err);
    }
  },

  async updateStatus(req, res, next) {
    try {
      const id = Number(req.params.invoiceId || req.params.id);
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
