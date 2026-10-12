import crypto from "crypto";
import { db } from "../../config/db.js";
import { paymentsRepository } from "./payments.repository.js";
import dgepayService, {
  initiateDgePayPayment,
  checkDgePayTransaction,
  decryptDgePayPayload,
  normalizeGatewayStatus,
  isGatewayApproved,
  findGatewayField,
} from "./dgepay.service.js";
import { notificationService } from "../notifications/notification.service.js";
import { merchantRepository } from "../merchants/merchant.repository.js";

function generateOrderNumber() {
  const ts = Date.now().toString().slice(-6);
  const rand = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `ORD-ADDON-${ts}-${rand}`;
}

function generatePaymentReference() {
  const ts = Date.now().toString().slice(-6);
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `PAY-DGE-${ts}-${rand}`;
}

export const paymentsService = {
  /**
   * Merchant initiates an add-on subscription order
   */
  async createAddonSubscriptionOrder({ userId, addonId, notes = "", paymentMethod = null }) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    if (!merchant) {
      const err = new Error("Merchant account not found");
      err.statusCode = 404;
      throw err;
    }

    // Load authoritative add-on from database
    const [addonRows] = await db.query(
      "SELECT * FROM addons WHERE id = ? AND status = 'available' LIMIT 1",
      [addonId]
    );
    if (!addonRows.length) {
      const err = new Error("Selected add-on service is not currently available for subscription.");
      err.statusCode = 400;
      throw err;
    }
    const addon = addonRows[0];

    if (addon.accepts_applications === 0 || addon.accepts_applications === false) {
      const err = new Error("New subscriptions for this add-on are temporarily suspended.");
      err.statusCode = 400;
      throw err;
    }

    // Check existing active subscription in merchant_addons
    const [existing] = await db.query(
      "SELECT id, status FROM merchant_addons WHERE merchant_id = ? AND addon_id = ? LIMIT 1",
      [merchant.id, addonId]
    );
    if (existing.length > 0) {
      const currentStatus = existing[0].status;
      if (currentStatus === "activated" || currentStatus === "approved") {
        const err = new Error("This add-on is already active on your merchant account.");
        err.statusCode = 400;
        throw err;
      }
    }

    const authoritativeAmount = Number(addon.price || 0);
    const orderNumber = generateOrderNumber();

    // 1. FREE Add-on: Zero cost bypasses payment gateway
    if (authoritativeAmount === 0) {
      let merchantAddonId = existing[0]?.id || null;
      if (merchantAddonId) {
        await db.execute(
          `UPDATE merchant_addons 
           SET status = 'activated', activated_at = NOW(), updated_at = NOW() 
           WHERE id = ?`,
          [merchantAddonId]
        );
      } else {
        const [insertMa] = await db.execute(
          `INSERT INTO merchant_addons 
            (merchant_id, addon_id, addon_name, addon_code, logo_url, category, price, pricing_type, status, applied_at, activated_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'activated', NOW(), NOW(), NOW(), NOW())`,
          [
            merchant.id,
            addon.id,
            addon.name,
            addon.code,
            addon.logo_url || null,
            addon.category || "Operations",
            addon.pricing_type || "free",
          ]
        );
        merchantAddonId = insertMa.insertId;
      }

      const orderId = await paymentsRepository.createOrder({
        orderNumber,
        merchantId: merchant.id,
        addonId: addon.id,
        merchantAddonId,
        addonName: addon.name,
        addonCode: addon.code,
        billingCycle: addon.billing_cycle || "monthly",
        pricingType: addon.pricing_type || "free",
        amount: 0,
        currency: "BDT",
        status: "active",
        notes,
      });

      // Update merchant_addons with order_id
      await db.execute("UPDATE merchant_addons SET order_id = ? WHERE id = ?", [orderId, merchantAddonId]);

      // Notifications
      await notificationService.notifyMerchant(merchant.id, {
        title: "অ্যাড-অন সাবস্ক্রিপশন সক্রিয়",
        message: `${addon.name} আপনার মার্চেন্ট অ্যাকাউন্টে সফলভাবে সক্রিয় করা হয়েছে।`,
        type: "addon",
        link: "/merchant/addons",
      });
      await notificationService.notifyAdmin({
        title: "নতুন অ্যাড-অন সাবস্ক্রিপশন",
        message: `${merchant.merchant_code} সফলভাবে বিনামূল্যে ${addon.name} সাবস্ক্রাইব করেছে।`,
        type: "addon",
        link: "/admin/addons",
      });

      const order = await paymentsRepository.getOrderById(orderId);
      return {
        success: true,
        isFree: true,
        order,
        payment: null,
        message: "Free add-on activated successfully.",
      };
    }

    // 2. PAID Add-on: Check if an active/pending order already exists to prevent duplicate orders
    const [existingOrders] = await db.query(
      `SELECT o.*, p.id AS payment_id, p.payment_reference, p.checkout_url, p.status AS payment_status, p.created_at AS payment_created_at
       FROM addon_orders o
       LEFT JOIN addon_payments p ON p.order_id = o.id AND p.status IN ('pending', 'processing')
       WHERE o.merchant_id = ? AND o.addon_id = ? AND o.status = 'pending_payment'
       ORDER BY o.id DESC LIMIT 1`,
      [merchant.id, addon.id]
    );

    if (existingOrders.length > 0) {
      const existingOrder = existingOrders[0];
      if (existingOrder.checkout_url) {
        const ageMs = Date.now() - new Date(existingOrder.payment_created_at || existingOrder.created_at).getTime();
        // If created within the last 45 minutes, reuse the active checkout URL
        if (ageMs < 45 * 60 * 1000) {
          const order = await paymentsRepository.getOrderById(existingOrder.id);
          const payment = await paymentsRepository.getPaymentById(existingOrder.payment_id);
          return {
            success: true,
            isFree: false,
            reused: true,
            order,
            payment,
            checkoutUrl: existingOrder.checkout_url,
            paymentReference: existingOrder.payment_reference,
            orderNumber: existingOrder.order_number,
          };
        }
      }

      // Existing order session expired: create a new payment attempt for the SAME order
      return await this.resumeAddonOrderPayment({
        userId,
        orderId: existingOrder.id,
        paymentMethod,
      });
    }

    let merchantAddonId = existing[0]?.id || null;
    if (!merchantAddonId) {
      const [insertMa] = await db.execute(
        `INSERT INTO merchant_addons 
          (merchant_id, addon_id, addon_name, addon_code, logo_url, category, price, pricing_type, status, applied_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'applied', NOW(), NOW(), NOW())`,
        [
          merchant.id,
          addon.id,
          addon.name,
          addon.code,
          addon.logo_url || null,
          addon.category || "Operations",
          authoritativeAmount,
          addon.pricing_type || "monthly",
        ]
      );
      merchantAddonId = insertMa.insertId;
    }

    const orderId = await paymentsRepository.createOrder({
      orderNumber,
      merchantId: merchant.id,
      addonId: addon.id,
      merchantAddonId,
      addonName: addon.name,
      addonCode: addon.code,
      billingCycle: addon.billing_cycle || "monthly",
      pricingType: addon.pricing_type || "monthly",
      amount: authoritativeAmount,
      currency: "BDT",
      status: "pending_payment",
      notes,
    });

    // Lookup merchant contact phone for DGePay payee_information
    const [contacts] = await db.query(
      "SELECT phone FROM merchant_contacts WHERE merchant_id = ? LIMIT 1",
      [merchant.id]
    );
    const merchantPhone = contacts[0]?.phone || "01618121655";

    // Initiate DGePay Live payment
    let dgepayResult;
    try {
      dgepayResult = await initiateDgePayPayment({
        amount: authoritativeAmount,
        orderNumber,
        customer: { phone: merchantPhone },
        note: `BanglaQR - ${addon.name} (${orderNumber})`,
        paymentMethod,
      });
    } catch (gatewayErr) {
      // If gateway initiation failed, mark order failed
      await paymentsRepository.updateOrderStatus(orderId, "cancelled", {
        adminNotes: `Gateway initiate failed: ${gatewayErr.message}`,
      });
      throw gatewayErr;
    }

    const paymentReference = generatePaymentReference();
    const paymentId = await paymentsRepository.createPayment({
      paymentReference,
      orderId,
      merchantId: merchant.id,
      gateway: "dgepay",
      paymentMethod: dgepayResult.paymentMethod || "dgepay",
      amount: authoritativeAmount,
      currency: "BDT",
      gatewayUniqueTxnId: dgepayResult.uniqueTxnId,
      gatewayOrderId: dgepayResult.gatewayOrderId,
      checkoutUrl: dgepayResult.paymentUrl,
      status: "pending",
    });

    // Link order and payment to merchant_addons
    await db.execute(
      "UPDATE merchant_addons SET order_id = ?, payment_id = ? WHERE id = ?",
      [orderId, paymentId, merchantAddonId]
    );

    // Notifications
    await notificationService.notifyMerchant(merchant.id, {
      title: "অ্যাড-অন পেমেন্ট প্রক্রিয়াধীন",
      message: `${addon.name} এর জন্য ৳${authoritativeAmount} পেমেন্ট সম্পন্ন করতে চেকআউট পেজে যান। (Order: ${orderNumber})`,
      type: "payment",
      link: `/merchant/addons?order=${orderNumber}`,
    });

    await notificationService.notifyAdmin({
      title: "নতুন অ্যাড-অন অর্ডার",
      message: `${merchant.merchant_code} থেকে ${addon.name} এর জন্য ৳${authoritativeAmount} এর অর্ডার তৈরি হয়েছে।`,
      type: "payment",
      link: "/admin/addons",
    });

    const order = await paymentsRepository.getOrderById(orderId);
    const payment = await paymentsRepository.getPaymentById(paymentId);

    return {
      success: true,
      isFree: false,
      order,
      payment,
      checkoutUrl: dgepayResult.paymentUrl,
      paymentReference,
      orderNumber,
    };
  },

  /**
   * Processes Return / IPN / Webhook from DGePay
   */
  async handleDgePayCallback({ encryptedData = null, uniqueTxnId = null, query = {}, body = {} }) {
    let targetUniqueTxnId = uniqueTxnId;
    let decryptedPayload = null;

    // 1. Try decrypting data parameter if present
    const dataToken = encryptedData || body?.data || query?.data || null;
    if (dataToken) {
      decryptedPayload = decryptDgePayPayload(dataToken);
      if (decryptedPayload?.unique_txn_id) {
        targetUniqueTxnId = decryptedPayload.unique_txn_id;
      }
    }

    if (!targetUniqueTxnId) {
      targetUniqueTxnId =
        body?.unique_txn_id ||
        query?.unique_txn_id ||
        query?.order_id ||
        body?.order_id ||
        null;
    }

    if (!targetUniqueTxnId) {
      return {
        success: false,
        status: "unresolved",
        message: "No unique_txn_id supplied in DGePay callback",
      };
    }

    // 2. Lookup existing payment record
    const payment = await paymentsRepository.getPaymentByGatewayTxnId(targetUniqueTxnId);
    if (!payment) {
      return {
        success: false,
        status: "not_found",
        message: `Payment record not found for unique_txn_id: ${targetUniqueTxnId}`,
      };
    }

    // Idempotency: if payment is already marked successful, do not repeat activations or notifications
    if (payment.status === "successful") {
      return {
        success: true,
        alreadyProcessed: true,
        status: "successful",
        orderId: payment.order_id,
        orderNumber: payment.order_number,
        paymentReference: payment.payment_reference,
        merchantId: payment.merchant_id,
      };
    }

    // 3. Authoritative server-to-server transaction status check with DGePay
    let statusResponse = null;
    try {
      statusResponse = await checkDgePayTransaction(targetUniqueTxnId);
    } catch (checkErr) {
      console.warn("[DGePay] checkTransaction API call error:", checkErr.message);
      // If direct status check fails, fallback to decrypted callback payload if approved
      if (decryptedPayload && isGatewayApproved(decryptedPayload)) {
        statusResponse = decryptedPayload;
      }
    }

    const payloadToCheck = statusResponse || decryptedPayload || body || query;
    const normalizedStatus = normalizeGatewayStatus(payloadToCheck);
    const isApproved = isGatewayApproved(payloadToCheck);

    const gatewayTrxId =
      findGatewayField(payloadToCheck, ["transaction_id", "trx_id", "bank_trx_id", "gateway_txn_id"]) || null;
    const gatewayStatusText =
      findGatewayField(payloadToCheck, ["status", "payment_status", "message"]) || normalizedStatus;

    if (isApproved) {
      // Verify payment amount matches stored order
      const reportedAmount = Number(findGatewayField(payloadToCheck, ["amount", "payment_amount"]) || payment.amount);
      if (Math.abs(reportedAmount - Number(payment.amount)) > 1.0) {
        console.error(
          `[DGePay Fraud Warning] Amount mismatch! Expected: ${payment.amount}, Got: ${reportedAmount}`
        );
        await paymentsRepository.updatePaymentStatus(payment.id, "failed", {
          gatewayResponse: payloadToCheck,
          failedAt: new Date(),
        });
        return { success: false, status: "failed", reason: "Amount mismatch detected" };
      }

      // Mark payment successful
      await paymentsRepository.updatePaymentStatus(payment.id, "successful", {
        gatewayTransactionId: gatewayTrxId,
        gatewayStatus: String(gatewayStatusText),
        gatewayResponse: payloadToCheck,
        paidAt: new Date(),
      });

      // Update order to paid & active
      await paymentsRepository.updateOrderStatus(payment.order_id, "paid");

      // Activate add-on in merchant_addons
      await db.execute(
        `UPDATE merchant_addons 
         SET status = 'activated', activated_at = NOW(), updated_at = NOW() 
         WHERE merchant_id = ? AND addon_id = ?`,
        [payment.merchant_id, payment.addon_id]
      );

      // In-app notifications
      await notificationService.notifyMerchant(payment.merchant_id, {
        title: "অ্যাড-অন পেমেন্ট সফল হয়েছে",
        message: `${payment.addon_name} এর জন্য ৳${payment.amount} সফলভাবে পরিশোধিত হয়েছে। সেবাটি এখন সক্রিয়!`,
        type: "payment",
        link: `/merchant/addons`,
      });

      await notificationService.notifyAdmin({
        title: "অ্যাড-অন পেমেন্ট গ্রহণ সম্পন্ন",
        message: `${payment.merchant_code} (${payment.company_name || ""}) ৳${payment.amount} সফলভাবে পরিশোধ করেছে (${payment.addon_name})। Trx: ${gatewayTrxId || "N/A"}`,
        type: "payment",
        link: `/admin/addons`,
      });

      return {
        success: true,
        status: "successful",
        orderId: payment.order_id,
        orderNumber: payment.order_number,
        paymentReference: payment.payment_reference,
        merchantId: payment.merchant_id,
      };
    }

    if (normalizedStatus === "failed") {
      await paymentsRepository.updatePaymentStatus(payment.id, "failed", {
        gatewayStatus: String(gatewayStatusText),
        gatewayResponse: payloadToCheck,
        failedAt: new Date(),
      });
      await paymentsRepository.updateOrderStatus(payment.order_id, "pending_payment");

      await notificationService.notifyMerchant(payment.merchant_id, {
        title: "অ্যাড-অন পেমেন্ট ব্যর্থ হয়েছে",
        message: `${payment.addon_name} এর জন্য ৳${payment.amount} পেমেন্ট ব্যর্থ হয়েছে। অনুগ্রহ করে পুনরায় চেষ্টা করুন।`,
        type: "payment",
        link: `/merchant/addons`,
      });

      return {
        success: false,
        status: "failed",
        orderId: payment.order_id,
        orderNumber: payment.order_number,
        paymentReference: payment.payment_reference,
        merchantId: payment.merchant_id,
      };
    }

    if (normalizedStatus === "cancelled") {
      await paymentsRepository.updatePaymentStatus(payment.id, "cancelled", {
        gatewayStatus: String(gatewayStatusText),
        gatewayResponse: payloadToCheck,
        cancelledAt: new Date(),
      });
      await paymentsRepository.updateOrderStatus(payment.order_id, "cancelled");

      await notificationService.notifyMerchant(payment.merchant_id, {
        title: "অ্যাড-অন পেমেন্ট বাতিল করা হয়েছে",
        message: `${payment.addon_name} এর জন্য পেমেন্ট বাতিল করা হয়েছে।`,
        type: "payment",
        link: `/merchant/addons`,
      });

      return {
        success: false,
        status: "cancelled",
        orderId: payment.order_id,
        orderNumber: payment.order_number,
        paymentReference: payment.payment_reference,
        merchantId: payment.merchant_id,
      };
    }

    // Still pending / processing: do not falsify success
    await paymentsRepository.updatePaymentStatus(payment.id, "processing", {
      gatewayStatus: String(gatewayStatusText),
      gatewayResponse: payloadToCheck,
    });

    return {
      success: true,
      status: "processing",
      orderId: payment.order_id,
      orderNumber: payment.order_number,
      paymentReference: payment.payment_reference,
      merchantId: payment.merchant_id,
    };
  },

  /**
   * Status check / reconciliation for a payment reference
   */
  async getPaymentStatus(paymentReference, merchantId = null) {
    const payment = await paymentsRepository.getPaymentByReference(paymentReference);
    if (!payment) {
      const err = new Error("Payment record not found");
      err.statusCode = 404;
      throw err;
    }

    if (merchantId && Number(payment.merchant_id) !== Number(merchantId)) {
      const err = new Error("Access denied to this payment record");
      err.statusCode = 403;
      throw err;
    }

    // If pending or processing, attempt live reconciliation with DGePay
    if (payment.status === "pending" || payment.status === "processing") {
      try {
        await this.handleDgePayCallback({ uniqueTxnId: payment.gateway_unique_txn_id });
        return await paymentsRepository.getPaymentByReference(paymentReference);
      } catch (e) {
        console.warn("[DGePay Reconcile] Live check error:", e.message);
      }
    }

    return payment;
  },

  /**
   * Admin-initiated status reconciliation
   */
  async adminReconcilePayment(paymentId, adminUser) {
    const payment = await paymentsRepository.getPaymentById(paymentId);
    if (!payment) {
      const err = new Error("Payment record not found");
      err.statusCode = 404;
      throw err;
    }

    const outcome = await this.handleDgePayCallback({
      uniqueTxnId: payment.gateway_unique_txn_id,
    });

    const updated = await paymentsRepository.getPaymentById(paymentId);
    return {
      success: true,
      outcome,
      payment: updated,
      message: `Payment reconciled with gateway. Status is currently '${updated.status}'.`,
    };
  },

  /**
   * Resumes or re-initiates payment for an existing unpaid order
   */
  async resumeAddonOrderPayment({ userId, orderId, paymentMethod = "dgepay" }) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const order = await paymentsRepository.getOrderById(orderId);
    if (!order || Number(order.merchant_id) !== Number(merchant.id)) {
      const err = new Error("Order not found or access denied.");
      err.statusCode = 404;
      throw err;
    }

    if (order.status === "paid" || order.status === "active") {
      return {
        success: true,
        alreadyPaid: true,
        message: "This order has already been paid and activated.",
        order,
      };
    }

    if (order.status === "cancelled") {
      const err = new Error("This order was cancelled. Please create a new subscription request.");
      err.statusCode = 400;
      throw err;
    }

    // Lookup merchant contact phone for DGePay payee_information
    const [contacts] = await db.query(
      "SELECT phone FROM merchant_contacts WHERE merchant_id = ? LIMIT 1",
      [merchant.id]
    );
    const merchantPhone = contacts[0]?.phone || "01618121655";

    // Initiate new DGePay payment attempt
    const dgepayResult = await initiateDgePayPayment({
      amount: Number(order.amount),
      orderNumber: order.order_number,
      customer: { phone: merchantPhone },
      note: `BanglaQR - ${order.addon_name} (${order.order_number})`,
      paymentMethod,
    });

    const paymentReference = generatePaymentReference();
    const paymentId = await paymentsRepository.createPayment({
      paymentReference,
      orderId: order.id,
      merchantId: merchant.id,
      gateway: "dgepay",
      paymentMethod: dgepayResult.paymentMethod || "dgepay",
      amount: Number(order.amount),
      currency: "BDT",
      gatewayUniqueTxnId: dgepayResult.uniqueTxnId,
      gatewayOrderId: dgepayResult.gatewayOrderId,
      checkoutUrl: dgepayResult.paymentUrl,
      status: "pending",
    });

    if (order.merchant_addon_id) {
      await db.execute(
        "UPDATE merchant_addons SET payment_id = ? WHERE id = ?",
        [paymentId, order.merchant_addon_id]
      );
    }

    const updatedPayment = await paymentsRepository.getPaymentById(paymentId);

    return {
      success: true,
      isFree: false,
      reused: false,
      order,
      payment: updatedPayment,
      checkoutUrl: dgepayResult.paymentUrl,
      paymentReference,
      orderNumber: order.order_number,
    };
  },
};

