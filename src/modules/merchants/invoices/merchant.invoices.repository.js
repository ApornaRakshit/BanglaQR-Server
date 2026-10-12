import { db } from "../../../config/db.js";

export const merchantInvoicesRepository = {
  // ==========================================
  // DASHBOARD SUMMARY CARDS
  // ==========================================
  async getInvoiceStats(merchantId) {
    const today = new Date().toISOString().split("T")[0];

    const [rows] = await db.execute(
      `
        SELECT
          COUNT(*) AS total_invoices,
          COUNT(CASE WHEN status = 'draft' THEN 1 END) AS draft_count,
          COUNT(CASE WHEN status = 'sent' AND due_date >= ? THEN 1 END) AS sent_count,
          COUNT(CASE WHEN status = 'paid' THEN 1 END) AS paid_count,
          COUNT(CASE WHEN status = 'partially_paid' AND due_date >= ? THEN 1 END) AS partially_paid_count,
          COUNT(CASE WHEN (status = 'overdue' OR ((status = 'sent' OR status = 'partially_paid') AND due_date < ?)) THEN 1 END) AS overdue_count,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled_count,
          COALESCE(SUM(CASE WHEN status NOT IN ('cancelled', 'paid') THEN balance_due ELSE 0 END), 0) AS total_outstanding,
          COALESCE(SUM(amount_paid), 0) AS total_collected,
          COALESCE(SUM(CASE WHEN status != 'cancelled' THEN amount ELSE 0 END), 0) AS total_revenue
        FROM invoices
        WHERE merchant_id = ?
      `,
      [today, today, today, merchantId]
    );

    const stats = rows[0] || {};
    return {
      totalInvoices: Number(stats.total_invoices || 0),
      draftInvoices: Number(stats.draft_count || 0),
      sentInvoices: Number(stats.sent_count || 0),
      paidInvoices: Number(stats.paid_count || 0),
      partiallyPaidInvoices: Number(stats.partially_paid_count || 0),
      overdueInvoices: Number(stats.overdue_count || 0),
      cancelledInvoices: Number(stats.cancelled_count || 0),
      totalOutstanding: Number(stats.total_outstanding || 0),
      totalCollected: Number(stats.total_collected || 0),
      totalRevenue: Number(stats.total_revenue || 0),
    };
  },

  // ==========================================
  // LIST PAGINATED INVOICES
  // ==========================================
  async listInvoices(merchantId, filters = {}) {
    const page = Math.max(1, Number(filters.page || 1));
    const limit = Math.max(1, Math.min(100, Number(filters.limit || 15)));
    const offset = (page - 1) * limit;

    const conditions = ["i.merchant_id = ?"];
    const params = [merchantId];

    if (filters.search) {
      conditions.push("(i.invoice_number LIKE ? OR i.customer_name LIKE ? OR i.customer_email LIKE ?)");
      const term = `%${filters.search}%`;
      params.push(term, term, term);
    }

    if (filters.status && filters.status !== "all") {
      const today = new Date().toISOString().split("T")[0];
      if (filters.status === "overdue") {
        conditions.push("(i.status = 'overdue' OR (i.status IN ('sent', 'partially_paid') AND i.due_date < ?))");
        params.push(today);
      } else {
        conditions.push("i.status = ?");
        params.push(filters.status);
      }
    }

    if (filters.startDate) {
      conditions.push("i.issue_date >= ?");
      params.push(filters.startDate);
    }

    if (filters.endDate) {
      conditions.push("i.issue_date <= ?");
      params.push(filters.endDate);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    // Get total count
    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS total FROM invoices i ${whereClause}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const isUnpaginated = filters.exportAll || String(filters.limit).toLowerCase() === "all";
    let query = `
      SELECT i.*, 
             c.name AS customer_full_name, c.business_name AS customer_org
      FROM invoices i
      LEFT JOIN invoice_customers c ON i.customer_id = c.id
      ${whereClause}
      ORDER BY i.created_at DESC
    `;
    const queryParams = [...params];
    if (!isUnpaginated) {
      query += ` LIMIT ? OFFSET ?`;
      queryParams.push(String(limit), String(offset));
    }

    const [rows] = await db.execute(query, queryParams);

    const today = new Date().toISOString().split("T")[0];

    const invoices = rows.map((r) => {
      let derivedStatus = r.status;
      if (r.status !== "cancelled" && r.status !== "paid" && r.due_date && r.due_date < today && Number(r.balance_due) > 0) {
        derivedStatus = "overdue";
      }

      return {
        id: r.id,
        invoice_id: r.id,
        invoiceNumber: r.invoice_number,
        invoice_number: r.invoice_number,
        customerId: r.customer_id,
        customer_id: r.customer_id,
        customerName: r.customer_name,
        customer_name: r.customer_name,
        customerEmail: r.customer_email,
        customer_email: r.customer_email,
        customerPhone: r.customer_phone,
        customer_phone: r.customer_phone,
        customerBusinessName: r.customer_business_name || r.customer_org,
        customer_business_name: r.customer_business_name || r.customer_org,
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
        items: typeof r.items === "string" ? JSON.parse(r.items) : (r.items || []),
        createdAt: r.created_at,
        created_at: r.created_at,
        updatedAt: r.updated_at,
        updated_at: r.updated_at,
        sentAt: r.sent_at,
        paidAt: r.paid_at,
      };
    });

    return {
      invoices,
      pagination: {
        total,
        page: isUnpaginated ? 1 : page,
        limit: isUnpaginated ? total : limit,
        totalPages: isUnpaginated ? 1 : (Math.ceil(total / limit) || 1),
      },
    };
  },

  // ==========================================
  // GET INVOICE BY ID
  // ==========================================
  async getInvoiceById(merchantId, invoiceId) {
    const [rows] = await db.execute(
      `
        SELECT i.*, 
               p.company_name AS merchant_company_name,
               p.address AS merchant_address,
               p.city AS merchant_city,
               p.country AS merchant_country,
               mc.email AS merchant_email,
               mc.phone AS merchant_phone
        FROM invoices i
        LEFT JOIN merchant_profiles p ON i.merchant_id = p.merchant_id
        LEFT JOIN merchant_contacts mc ON i.merchant_id = mc.merchant_id
        WHERE i.id = ? AND i.merchant_id = ?
        LIMIT 1
      `,
      [invoiceId, merchantId]
    );

    if (!rows.length) return null;
    const r = rows[0];

    const today = new Date().toISOString().split("T")[0];
    let derivedStatus = r.status;
    if (r.status !== "cancelled" && r.status !== "paid" && r.due_date && r.due_date < today && Number(r.balance_due) > 0) {
      derivedStatus = "overdue";
    }

    // Load payments for this invoice
    const [payments] = await db.execute(
      `SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY payment_date DESC, created_at DESC`,
      [invoiceId]
    );

    // Load history for this invoice
    const [history] = await db.execute(
      `SELECT * FROM invoice_history WHERE invoice_id = ? ORDER BY created_at DESC`,
      [invoiceId]
    );

    return {
      id: r.id,
      invoiceNumber: r.invoice_number,
      customerId: r.customer_id,
      customerName: r.customer_name,
      customerEmail: r.customer_email,
      customerPhone: r.customer_phone,
      customerAddress: r.customer_address,
      customerBusinessName: r.customer_business_name,
      amount: Number(r.amount),
      subtotal: Number(r.subtotal || r.amount),
      discountAmount: Number(r.discount_amount || 0),
      taxAmount: Number(r.tax_amount || 0),
      amountPaid: Number(r.amount_paid || 0),
      balanceDue: Number(r.balance_due || 0),
      currency: r.currency || "BDT",
      issueDate: r.issue_date,
      dueDate: r.due_date,
      status: derivedStatus,
      rawStatus: r.status,
      poNumber: r.po_number,
      referenceNumber: r.reference_number,
      paymentReference: r.payment_reference,
      notes: r.notes,
      paymentInstructions: r.payment_instructions,
      termsConditions: r.terms_conditions,
      footerMessage: r.footer_message,
      items: typeof r.items === "string" ? JSON.parse(r.items) : (r.items || []),
      merchant: {
        companyName: r.merchant_company_name || "BanglaQR Merchant",
        address: [r.merchant_address, r.merchant_city, r.merchant_country].filter(Boolean).join(", "),
        email: r.merchant_email,
        phone: r.merchant_phone,
      },
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
      updatedAt: r.updated_at,
      sentAt: r.sent_at,
      paidAt: r.paid_at,
      cancelledAt: r.cancelled_at,
    };
  },

  // ==========================================
  // GENERATE UNIQUE INVOICE NUMBER
  // ==========================================
  async generateUniqueInvoiceNumber(merchantId) {
    const year = new Date().getFullYear();
    const [rows] = await db.execute(
      `SELECT COUNT(*) AS count FROM invoices WHERE invoice_number LIKE ?`,
      [`INV-${year}-%`]
    );
    const count = Number(rows[0]?.count || 0) + 1;
    let nextNum = count;
    let candidate = `INV-${year}-${String(nextNum).padStart(6, "0")}`;

    // Ensure global uniqueness across the invoices table
    let exists = true;
    while (exists) {
      candidate = `INV-${year}-${String(nextNum).padStart(6, "0")}`;
      const [check] = await db.execute(
        "SELECT id FROM invoices WHERE invoice_number = ? LIMIT 1",
        [candidate]
      );
      if (check.length === 0) {
        exists = false;
      } else {
        nextNum++;
      }
    }
    return candidate;
  },

  // ==========================================
  // CREATE INVOICE
  // ==========================================
  async createInvoice(merchantId, data, userId) {
    let invoiceNumber = data.invoiceNumber || data.invoice_number;
    if (!invoiceNumber) {
      invoiceNumber = await this.generateUniqueInvoiceNumber(merchantId);
    } else {
      // Check collision
      const [check] = await db.execute(
        "SELECT id FROM invoices WHERE invoice_number = ? LIMIT 1",
        [invoiceNumber]
      );
      if (check.length > 0) {
        const err = new Error(`Invoice number '${invoiceNumber}' already exists. Please use a unique number.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const totalAmount = Number(data.amount || data.totalAmount || 0);
    const subtotal = Number(data.subtotal || totalAmount);
    const discountAmount = Number(data.discountAmount || data.discount_amount || 0);
    const taxAmount = Number(data.taxAmount || data.tax_amount || 0);
    const amountPaid = Number(data.amountPaid || data.amount_paid || 0);
    const balanceDue = Math.max(0, totalAmount - amountPaid);
    const initialStatus = data.status || (data.sendNow ? "sent" : "draft");

    const [res] = await db.execute(
      `
        INSERT INTO invoices (
          invoice_number, merchant_id, customer_id, customer_name, customer_email, customer_phone,
          customer_address, customer_business_name, amount, subtotal, discount_amount, tax_amount,
          amount_paid, balance_due, currency, issue_date, due_date, po_number, reference_number,
          status, items, notes, payment_instructions, terms_conditions, footer_message,
          sent_at, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, NOW(), NOW()
        )
      `,
      [
        invoiceNumber,
        merchantId,
        data.customerId || data.customer_id || null,
        data.customerName || data.customer_name || "Customer",
        data.customerEmail || data.customer_email || "customer@example.com",
        data.customerPhone || data.customer_phone || null,
        data.customerAddress || data.customer_address || null,
        data.customerBusinessName || data.customer_business_name || null,
        totalAmount,
        subtotal,
        discountAmount,
        taxAmount,
        amountPaid,
        balanceDue,
        data.currency || "BDT",
        data.issueDate || data.issue_date || new Date().toISOString().split("T")[0],
        data.dueDate || data.due_date || new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0],
        data.poNumber || data.po_number || null,
        data.referenceNumber || data.reference_number || null,
        initialStatus,
        JSON.stringify(data.items || []),
        data.notes || null,
        data.paymentInstructions || data.payment_instructions || null,
        data.termsConditions || data.terms_conditions || null,
        data.footerMessage || data.footer_message || null,
        data.sendNow ? new Date() : null,
      ]
    );

    const invoiceId = res.insertId;

    // Log History
    await db.execute(
      `INSERT INTO invoice_history (merchant_id, invoice_id, action, description, created_by, created_at)
       VALUES (?, ?, 'created', ?, ?, NOW())`,
      [merchantId, invoiceId, `Invoice ${invoiceNumber} created as ${initialStatus}`, userId || null]
    );

    return {
      id: invoiceId,
      invoiceNumber,
      status: initialStatus,
      totalAmount,
      balanceDue,
    };
  },

  // ==========================================
  // UPDATE DRAFT INVOICE
  // ==========================================
  async updateDraftInvoice(merchantId, invoiceId, data, userId) {
    const [rows] = await db.execute(
      "SELECT * FROM invoices WHERE id = ? AND merchant_id = ? LIMIT 1",
      [invoiceId, merchantId]
    );
    if (!rows.length) {
      const err = new Error("Invoice not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }
    const existing = rows[0];
    if (existing.status !== "draft") {
      const err = new Error(`Only draft invoices can be edited. Current status is '${existing.status}'`);
      err.statusCode = 400;
      throw err;
    }

    const totalAmount = Number(data.amount || data.totalAmount || existing.amount);
    const subtotal = Number(data.subtotal || totalAmount);
    const discountAmount = Number(data.discountAmount ?? data.discount_amount ?? existing.discount_amount);
    const taxAmount = Number(data.taxAmount ?? data.tax_amount ?? existing.tax_amount);
    const amountPaid = Number(existing.amount_paid || 0);
    const balanceDue = Math.max(0, totalAmount - amountPaid);

    await db.execute(
      `
        UPDATE invoices SET
          customer_id = ?, customer_name = ?, customer_email = ?, customer_phone = ?,
          customer_address = ?, customer_business_name = ?, amount = ?, subtotal = ?,
          discount_amount = ?, tax_amount = ?, balance_due = ?, currency = ?,
          issue_date = ?, due_date = ?, po_number = ?, reference_number = ?,
          items = ?, notes = ?, payment_instructions = ?, terms_conditions = ?,
          footer_message = ?, updated_at = NOW()
        WHERE id = ? AND merchant_id = ?
      `,
      [
        data.customerId || data.customer_id || existing.customer_id,
        data.customerName || data.customer_name || existing.customer_name,
        data.customerEmail || data.customer_email || existing.customer_email,
        data.customerPhone || data.customer_phone || existing.customer_phone,
        data.customerAddress || data.customer_address || existing.customer_address,
        data.customerBusinessName || data.customer_business_name || existing.customer_business_name,
        totalAmount,
        subtotal,
        discountAmount,
        taxAmount,
        balanceDue,
        data.currency || existing.currency || "BDT",
        data.issueDate || data.issue_date || existing.issue_date,
        data.dueDate || data.due_date || existing.due_date,
        data.poNumber || data.po_number || existing.po_number,
        data.referenceNumber || data.reference_number || existing.reference_number,
        JSON.stringify(data.items || JSON.parse(existing.items || "[]")),
        data.notes ?? existing.notes,
        data.paymentInstructions ?? existing.payment_instructions,
        data.termsConditions ?? existing.terms_conditions,
        data.footerMessage ?? existing.footer_message,
        invoiceId,
        merchantId,
      ]
    );

    // Log History
    await db.execute(
      `INSERT INTO invoice_history (merchant_id, invoice_id, action, description, created_by, created_at)
       VALUES (?, ?, 'updated', 'Draft invoice updated', ?, NOW())`,
      [merchantId, invoiceId, userId || null]
    );

    return { id: invoiceId, success: true };
  },

  // ==========================================
  // RECORD PAYMENT
  // ==========================================
  async recordPayment(merchantId, invoiceId, data, userId) {
    const [rows] = await db.execute(
      "SELECT * FROM invoices WHERE id = ? AND merchant_id = ? LIMIT 1",
      [invoiceId, merchantId]
    );
    if (!rows.length) {
      const err = new Error("Invoice not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }
    const inv = rows[0];

    if (inv.status === "cancelled") {
      const err = new Error("Cannot record payment on a cancelled invoice.");
      err.statusCode = 400;
      throw err;
    }

    if (inv.status === "paid" || Number(inv.balance_due) <= 0) {
      const err = new Error("This invoice is already fully paid.");
      err.statusCode = 400;
      throw err;
    }

    const payAmount = Number(data.amount || 0);
    if (payAmount <= 0) {
      const err = new Error("Payment amount must be greater than zero.");
      err.statusCode = 400;
      throw err;
    }

    const currentPaid = Number(inv.amount_paid || 0);
    const totalInvoice = Number(inv.amount || 0);
    const newPaid = currentPaid + payAmount;
    const newBalance = Math.max(0, totalInvoice - newPaid);
    const newStatus = newBalance <= 0 ? "paid" : "partially_paid";

    // Insert payment record
    const [payRes] = await db.execute(
      `
        INSERT INTO invoice_payments (
          merchant_id, invoice_id, amount, payment_date, payment_method, reference_id, notes, is_gateway_verified, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        merchantId,
        invoiceId,
        payAmount,
        data.paymentDate || data.payment_date || new Date().toISOString().split("T")[0],
        data.paymentMethod || data.payment_method || "manual_cash",
        data.referenceId || data.reference_id || null,
        data.notes || null,
        Boolean(data.isGatewayVerified),
      ]
    );

    // Update invoice
    await db.execute(
      `
        UPDATE invoices SET
          amount_paid = ?, balance_due = ?, status = ?,
          paid_at = CASE WHEN ? = 'paid' THEN NOW() ELSE paid_at END,
          updated_at = NOW()
        WHERE id = ? AND merchant_id = ?
      `,
      [newPaid, newBalance, newStatus, newStatus, invoiceId, merchantId]
    );

    // History
    await db.execute(
      `INSERT INTO invoice_history (merchant_id, invoice_id, action, description, created_by, created_at)
       VALUES (?, ?, 'payment_recorded', ?, ?, NOW())`,
      [
        merchantId,
        invoiceId,
        `Payment of ৳${payAmount.toFixed(2)} recorded via ${data.paymentMethod || "manual"}. New Status: ${newStatus}`,
        userId || null,
      ]
    );

    return {
      success: true,
      paymentId: payRes.insertId,
      amountPaid: newPaid,
      balanceDue: newBalance,
      status: newStatus,
    };
  },

  // ==========================================
  // CANCEL INVOICE
  // ==========================================
  async cancelInvoice(merchantId, invoiceId, reason, userId) {
    const [rows] = await db.execute(
      "SELECT * FROM invoices WHERE id = ? AND merchant_id = ? LIMIT 1",
      [invoiceId, merchantId]
    );
    if (!rows.length) {
      const err = new Error("Invoice not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }
    const inv = rows[0];

    if (inv.status === "paid") {
      const err = new Error("Cannot cancel a fully paid invoice.");
      err.statusCode = 400;
      throw err;
    }

    await db.execute(
      `UPDATE invoices SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = ? AND merchant_id = ?`,
      [invoiceId, merchantId]
    );

    // History
    await db.execute(
      `INSERT INTO invoice_history (merchant_id, invoice_id, action, description, created_by, created_at)
       VALUES (?, ?, 'cancelled', ?, ?, NOW())`,
      [merchantId, invoiceId, reason ? `Invoice cancelled. Reason: ${reason}` : "Invoice cancelled by merchant", userId || null]
    );

    return { success: true, message: "Invoice cancelled successfully", status: "cancelled" };
  },

  // ==========================================
  // MARK AS SENT & RECORD SEND HISTORY
  // ==========================================
  async markAsSent(merchantId, invoiceId, userId) {
    await db.execute(
      `UPDATE invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = NOW(), updated_at = NOW() WHERE id = ? AND merchant_id = ?`,
      [invoiceId, merchantId]
    );

    await db.execute(
      `INSERT INTO invoice_history (merchant_id, invoice_id, action, description, created_by, created_at)
       VALUES (?, ?, 'sent', 'Invoice marked as sent to customer', ?, NOW())`,
      [merchantId, invoiceId, userId || null]
    );
  },

  // ==========================================
  // RECORD REMINDER
  // ==========================================
  async recordReminder(merchantId, invoiceId, userId) {
    await db.execute(
      `UPDATE invoices SET last_reminder_at = NOW(), updated_at = NOW() WHERE id = ? AND merchant_id = ?`,
      [invoiceId, merchantId]
    );

    await db.execute(
      `INSERT INTO invoice_history (merchant_id, invoice_id, action, description, created_by, created_at)
       VALUES (?, ?, 'reminder_sent', 'Payment reminder sent to customer', ?, NOW())`,
      [merchantId, invoiceId, userId || null]
    );
  },

  // ==========================================
  // CUSTOMER MANAGEMENT
  // ==========================================
  async listCustomers(merchantId, filters = {}) {
    const conditions = ["merchant_id = ?", "status = 'active'"];
    const params = [merchantId];

    if (filters.search) {
      conditions.push("(name LIKE ? OR business_name LIKE ? OR email LIKE ? OR phone LIKE ?)");
      const term = `%${filters.search}%`;
      params.push(term, term, term, term);
    }

    const [rows] = await db.execute(
      `SELECT * FROM invoice_customers WHERE ${conditions.join(" AND ")} ORDER BY name ASC`,
      params
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      businessName: r.business_name,
      email: r.email,
      phone: r.phone,
      billingAddress: r.billing_address,
      taxIdentification: r.tax_identification,
      notes: r.notes,
      createdAt: r.created_at,
    }));
  },

  async createCustomer(merchantId, data) {
    const [res] = await db.execute(
      `
        INSERT INTO invoice_customers (
          merchant_id, name, business_name, email, phone, billing_address, tax_identification, notes, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NOW(), NOW())
      `,
      [
        merchantId,
        data.name,
        data.businessName || data.business_name || null,
        data.email || null,
        data.phone || null,
        data.billingAddress || data.billing_address || null,
        data.taxIdentification || data.tax_identification || null,
        data.notes || null,
      ]
    );

    return {
      id: res.insertId,
      name: data.name,
      businessName: data.businessName || data.business_name,
      email: data.email,
      phone: data.phone,
      billingAddress: data.billingAddress || data.billing_address,
    };
  },

  async getCustomerById(merchantId, customerId) {
    const [rows] = await db.execute(
      "SELECT * FROM invoice_customers WHERE id = ? AND merchant_id = ? LIMIT 1",
      [customerId, merchantId]
    );
    if (!rows.length) return null;
    const r = rows[0];

    // Get customer's invoices
    const [invoices] = await db.execute(
      "SELECT id, invoice_number, amount, balance_due, status, issue_date, due_date FROM invoices WHERE customer_id = ? AND merchant_id = ? ORDER BY created_at DESC",
      [customerId, merchantId]
    );

    return {
      id: r.id,
      name: r.name,
      businessName: r.business_name,
      email: r.email,
      phone: r.phone,
      billingAddress: r.billing_address,
      taxIdentification: r.tax_identification,
      notes: r.notes,
      status: r.status,
      invoices: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        amount: Number(inv.amount),
        balanceDue: Number(inv.balance_due),
        status: inv.status,
        issueDate: inv.issue_date,
        dueDate: inv.due_date,
      })),
      createdAt: r.created_at,
    };
  },

  async updateCustomer(merchantId, customerId, data) {
    const [check] = await db.execute(
      "SELECT id FROM invoice_customers WHERE id = ? AND merchant_id = ? LIMIT 1",
      [customerId, merchantId]
    );
    if (!check.length) {
      const err = new Error("Customer not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }

    await db.execute(
      `
        UPDATE invoice_customers SET
          name = ?, business_name = ?, email = ?, phone = ?,
          billing_address = ?, tax_identification = ?, notes = ?, updated_at = NOW()
        WHERE id = ? AND merchant_id = ?
      `,
      [
        data.name,
        data.businessName || data.business_name || null,
        data.email || null,
        data.phone || null,
        data.billingAddress || data.billing_address || null,
        data.taxIdentification || data.tax_identification || null,
        data.notes || null,
        customerId,
        merchantId,
      ]
    );

    return { id: customerId, success: true };
  },

  async archiveCustomer(merchantId, customerId) {
    const [check] = await db.execute(
      "SELECT id FROM invoice_customers WHERE id = ? AND merchant_id = ? LIMIT 1",
      [customerId, merchantId]
    );
    if (!check.length) {
      const err = new Error("Customer not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }

    await db.execute(
      "UPDATE invoice_customers SET status = 'archived', updated_at = NOW() WHERE id = ? AND merchant_id = ?",
      [customerId, merchantId]
    );
    return { success: true, message: "Customer archived successfully" };
  },

  async getPaymentsForInvoices(merchantId, invoiceIds = []) {
    if (!invoiceIds.length) return [];
    const placeholders = invoiceIds.map(() => "?").join(",");
    const [rows] = await db.execute(
      `
        SELECT p.*, i.invoice_number
        FROM invoice_payments p
        JOIN invoices i ON p.invoice_id = i.id
        WHERE p.merchant_id = ? AND p.invoice_id IN (${placeholders})
        ORDER BY p.payment_date DESC, p.created_at DESC
      `,
      [merchantId, ...invoiceIds]
    );
    return rows;
  },
};
