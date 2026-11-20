import { db } from "../../config/db.js";

export const paymentsRepository = {
  async createOrder({
    orderNumber,
    merchantId,
    addonId,
    merchantAddonId = null,
    addonName,
    addonCode,
    billingCycle = "monthly",
    pricingType = "monthly",
    amount,
    currency = "BDT",
    notes = null,
    status = "pending_payment",
  }) {
    const [res] = await db.execute(
      `INSERT INTO addon_orders 
        (order_number, merchant_id, addon_id, merchant_addon_id, addon_name, addon_code, billing_cycle, pricing_type, amount, currency, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        orderNumber,
        merchantId,
        addonId,
        merchantAddonId,
        addonName,
        addonCode,
        billingCycle,
        pricingType,
        amount,
        currency,
        status,
        notes,
      ]
    );
    return res.insertId;
  },

  async getOrderById(id) {
    const [rows] = await db.query(
      `SELECT o.*, 
              m.merchant_code,
              m.account_status AS merchant_status,
              p.company_name,
              c.email AS contact_email,
              c.phone AS contact_phone
       FROM addon_orders o
       JOIN merchants m ON m.id = o.merchant_id
       LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
       LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
       WHERE o.id = ?
       LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  },

  async getOrderByNumber(orderNumber) {
    const [rows] = await db.query(
      `SELECT o.*, 
              m.merchant_code,
              p.company_name,
              c.email AS contact_email,
              c.phone AS contact_phone
       FROM addon_orders o
       JOIN merchants m ON m.id = o.merchant_id
       LEFT JOIN merchant_profiles p ON p.merchant_id = m.id
       LEFT JOIN merchant_contacts c ON c.merchant_id = m.id
       WHERE o.order_number = ?
       LIMIT 1`,
      [orderNumber]
    );
    return rows[0] || null;
  },

  async updateOrderStatus(orderId, status, { adminNotes = null, merchantAddonId = null } = {}) {
    const updates = ["status = ?", "updated_at = NOW()"];
    const params = [status];

    if (adminNotes !== null && adminNotes !== undefined) {
      updates.push("admin_notes = ?");
      params.push(adminNotes);
    }
    if (merchantAddonId !== null && merchantAddonId !== undefined) {
      updates.push("merchant_addon_id = ?");
      params.push(merchantAddonId);
    }

    params.push(orderId);
    await db.execute(`UPDATE addon_orders SET ${updates.join(", ")} WHERE id = ?`, params);
  },

  async createPayment({
    paymentReference,
    orderId,
    merchantId,
    gateway = "dgepay",
    paymentMethod = "dgepay",
    amount,
    currency = "BDT",
    gatewayUniqueTxnId,
    gatewayOrderId = null,
    checkoutUrl = null,
    status = "pending",
  }) {
    const [res] = await db.execute(
      `INSERT INTO addon_payments 
        (payment_reference, order_id, merchant_id, gateway, payment_method, amount, currency, gateway_unique_txn_id, gateway_order_id, checkout_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        paymentReference,
        orderId,
        merchantId,
        gateway,
        paymentMethod,
        amount,
        currency,
        gatewayUniqueTxnId,
        gatewayOrderId,
        checkoutUrl,
        status,
      ]
    );
    return res.insertId;
  },

  async getPaymentById(id) {
    const [rows] = await db.query(
      `SELECT p.*,
              o.order_number,
              o.addon_id,
              o.addon_name,
              o.addon_code,
              o.status AS order_status,
              m.merchant_code,
              mp.company_name,
              mc.email AS contact_email,
              mc.phone AS contact_phone
       FROM addon_payments p
       JOIN addon_orders o ON o.id = p.order_id
       JOIN merchants m ON m.id = p.merchant_id
       LEFT JOIN merchant_profiles mp ON mp.merchant_id = m.id
       LEFT JOIN merchant_contacts mc ON mc.merchant_id = m.id
       WHERE p.id = ?
       LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  },

  async getPaymentByReference(paymentReference) {
    const [rows] = await db.query(
      `SELECT p.*,
              o.order_number,
              o.addon_id,
              o.addon_name,
              o.addon_code,
              o.status AS order_status,
              m.merchant_code,
              mp.company_name,
              mc.email AS contact_email,
              mc.phone AS contact_phone
       FROM addon_payments p
       JOIN addon_orders o ON o.id = p.order_id
       JOIN merchants m ON m.id = p.merchant_id
       LEFT JOIN merchant_profiles mp ON mp.merchant_id = m.id
       LEFT JOIN merchant_contacts mc ON mc.merchant_id = m.id
       WHERE p.payment_reference = ?
       LIMIT 1`,
      [paymentReference]
    );
    return rows[0] || null;
  },

  async getPaymentByGatewayTxnId(uniqueTxnId) {
    const [rows] = await db.query(
      `SELECT p.*,
              o.order_number,
              o.addon_id,
              o.addon_name,
              o.addon_code,
              o.status AS order_status,
              m.merchant_code,
              mp.company_name,
              mc.email AS contact_email,
              mc.phone AS contact_phone
       FROM addon_payments p
       JOIN addon_orders o ON o.id = p.order_id
       JOIN merchants m ON m.id = p.merchant_id
       LEFT JOIN merchant_profiles mp ON mp.merchant_id = m.id
       LEFT JOIN merchant_contacts mc ON mc.merchant_id = m.id
       WHERE p.gateway_unique_txn_id = ?
       LIMIT 1`,
      [uniqueTxnId]
    );
    return rows[0] || null;
  },

  async updatePaymentStatus(
    paymentId,
    status,
    {
      gatewayOrderId = null,
      gatewayTransactionId = null,
      gatewayStatus = null,
      gatewayResponse = null,
      paidAt = null,
      failedAt = null,
      cancelledAt = null,
    } = {}
  ) {
    const updates = ["status = ?", "updated_at = NOW()"];
    const params = [status];

    if (gatewayOrderId) {
      updates.push("gateway_order_id = ?");
      params.push(gatewayOrderId);
    }
    if (gatewayTransactionId) {
      updates.push("gateway_transaction_id = ?");
      params.push(gatewayTransactionId);
    }
    if (gatewayStatus) {
      updates.push("gateway_status = ?");
      params.push(gatewayStatus);
    }
    if (gatewayResponse) {
      updates.push("gateway_response = ?");
      params.push(typeof gatewayResponse === "string" ? gatewayResponse : JSON.stringify(gatewayResponse));
    }
    if (paidAt) {
      updates.push("paid_at = ?");
      params.push(paidAt);
    }
    if (failedAt) {
      updates.push("failed_at = ?");
      params.push(failedAt);
    }
    if (cancelledAt) {
      updates.push("cancelled_at = ?");
      params.push(cancelledAt);
    }

    params.push(paymentId);
    await db.execute(`UPDATE addon_payments SET ${updates.join(", ")} WHERE id = ?`, params);
  },

  async listOrders({
    merchantId = null,
    status = null,
    search = "",
    isArchived = 0,
    page = 1,
    limit = 20,
  } = {}) {
    const conditions = [];
    const params = [];

    if (merchantId) {
      conditions.push("o.merchant_id = ?");
      params.push(merchantId);
    }
    if (status && status !== "all") {
      conditions.push("o.status = ?");
      params.push(status);
    }
    if (isArchived !== null && isArchived !== undefined) {
      conditions.push("o.is_archived = ?");
      params.push(isArchived ? 1 : 0);
    }
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push("(o.order_number LIKE ? OR o.addon_name LIKE ? OR m.merchant_code LIKE ? OR mp.company_name LIKE ?)");
      params.push(term, term, term, term);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (Math.max(1, page) - 1) * limit;

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
       FROM addon_orders o
       JOIN merchants m ON m.id = o.merchant_id
       LEFT JOIN merchant_profiles mp ON mp.merchant_id = m.id
       ${where}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.query(
      `SELECT o.*,
              m.merchant_code,
              mp.company_name,
              mc.email AS contact_email,
              mc.phone AS contact_phone
       FROM addon_orders o
       JOIN merchants m ON m.id = o.merchant_id
       LEFT JOIN merchant_profiles mp ON mp.merchant_id = m.id
       LEFT JOIN merchant_contacts mc ON mc.merchant_id = m.id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    );

    return {
      orders: rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  async listPayments({
    merchantId = null,
    status = null,
    gateway = null,
    search = "",
    isArchived = 0,
    page = 1,
    limit = 20,
  } = {}) {
    const conditions = [];
    const params = [];

    if (merchantId) {
      conditions.push("p.merchant_id = ?");
      params.push(merchantId);
    }
    if (status && status !== "all") {
      conditions.push("p.status = ?");
      params.push(status);
    }
    if (gateway) {
      conditions.push("p.gateway = ?");
      params.push(gateway);
    }
    if (isArchived !== null && isArchived !== undefined) {
      conditions.push("p.is_archived = ?");
      params.push(isArchived ? 1 : 0);
    }
    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(
        "(p.payment_reference LIKE ? OR p.gateway_unique_txn_id LIKE ? OR p.gateway_transaction_id LIKE ? OR o.order_number LIKE ? OR o.addon_name LIKE ? OR m.merchant_code LIKE ? OR mp.company_name LIKE ?)"
      );
      params.push(term, term, term, term, term, term, term);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (Math.max(1, page) - 1) * limit;

    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total
       FROM addon_payments p
       JOIN addon_orders o ON o.id = p.order_id
       JOIN merchants m ON m.id = p.merchant_id
       LEFT JOIN merchant_profiles mp ON mp.merchant_id = m.id
       ${where}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const [rows] = await db.query(
      `SELECT p.*,
              o.order_number,
              o.addon_id,
              o.addon_name,
              o.addon_code,
              o.billing_cycle,
              o.pricing_type,
              o.status AS order_status,
              m.merchant_code,
              mp.company_name,
              mc.email AS contact_email,
              mc.phone AS contact_phone
       FROM addon_payments p
       JOIN addon_orders o ON o.id = p.order_id
       JOIN merchants m ON m.id = p.merchant_id
       LEFT JOIN merchant_profiles mp ON mp.merchant_id = m.id
       LEFT JOIN merchant_contacts mc ON mc.merchant_id = m.id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    );

    return {
      payments: rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  },

  async getPaymentsByOrderId(orderId) {
    const [rows] = await db.query(
      `SELECT p.*, o.order_number, o.addon_name
       FROM addon_payments p
       JOIN addon_orders o ON o.id = p.order_id
       WHERE p.order_id = ?
       ORDER BY p.id DESC`,
      [orderId]
    );
    return rows;
  },

  async getPaymentStats(filters = {}) {
    const merchantId = filters.merchantId || null;
    const whereMerchant = merchantId ? "WHERE merchant_id = ?" : "";
    const params = merchantId ? [merchantId] : [];

    const [orderRows] = await db.query(
      `SELECT 
        COUNT(*) AS total_orders,
        SUM(CASE WHEN status = 'pending_payment' THEN 1 ELSE 0 END) AS pending_payment_orders,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing_orders,
        SUM(CASE WHEN status = 'paid' OR status = 'active' THEN 1 ELSE 0 END) AS paid_orders,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_orders,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_orders,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_orders,
        SUM(CASE WHEN status = 'pending_admin_approval' THEN 1 ELSE 0 END) AS awaiting_approval_orders
       FROM addon_orders
       ${whereMerchant}`,
      params
    );

    const [paymentRows] = await db.query(
      `SELECT 
        COUNT(*) AS total_payments,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_payments,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing_payments,
        SUM(CASE WHEN status = 'successful' THEN 1 ELSE 0 END) AS successful_payments,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_payments,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_payments,
        COALESCE(SUM(CASE WHEN status = 'successful' THEN amount ELSE 0 END), 0) AS total_collected_amount
       FROM addon_payments
       ${whereMerchant}`,
      params
    );

    return {
      totalOrders: Number(orderRows[0]?.total_orders || 0),
      awaitingPaymentOrders: Number(orderRows[0]?.pending_payment_orders || 0),
      pendingOrders: Number(orderRows[0]?.pending_payment_orders || 0),
      processingOrders: Number(orderRows[0]?.processing_orders || 0),
      paidOrders: Number(orderRows[0]?.paid_orders || 0),
      activeSubscriptions: Number(orderRows[0]?.active_orders || 0),
      cancelledOrders: Number(orderRows[0]?.cancelled_orders || 0),
      failedOrders: Number(orderRows[0]?.failed_orders || 0),
      awaitingApprovalOrders: Number(orderRows[0]?.awaiting_approval_orders || 0),
      totalPayments: Number(paymentRows[0]?.total_payments || 0),
      pendingPayments: Number(paymentRows[0]?.pending_payments || 0),
      processingPayments: Number(paymentRows[0]?.processing_payments || 0),
      successfulPayments: Number(paymentRows[0]?.successful_payments || 0),
      cancelledPayments: Number(paymentRows[0]?.cancelled_payments || 0),
      failedPayments: Number(paymentRows[0]?.failed_payments || 0),
      totalCollectedAmount: Number(paymentRows[0]?.total_collected_amount || 0),
    };
  },

  async archivePayment(paymentId, { adminEmail, reason }) {
    await db.execute(
      `UPDATE addon_payments 
       SET is_archived = 1, archived_at = NOW(), archived_by = ? 
       WHERE id = ?`,
      [`${adminEmail || "Admin"}: ${reason || "Archived by admin"}`, paymentId]
    );
  },
};

