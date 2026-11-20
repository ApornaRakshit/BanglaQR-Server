import { paymentsService } from "./payments.service.js";
import { paymentsRepository } from "./payments.repository.js";
import { merchantRepository } from "../merchants/merchant.repository.js";
import { env } from "../../config/env.js";
import { db } from "../../config/db.js";

export const paymentsController = {
  /**
   * Merchant creates an Add-on order & initiates checkout
   */
  async createAddonOrder(req, res, next) {
    try {
      const addonId = Number(req.params.addonId || req.body.addonId);
      const { notes, paymentMethod } = req.body;

      const result = await paymentsService.createAddonSubscriptionOrder({
        userId: req.user.id,
        addonId,
        notes,
        paymentMethod,
      });

      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * DGePay Callback / Return Handler (GET and POST)
   */
  async dgepayCallback(req, res, next) {
    try {
      const encryptedData = req.body?.data || req.query?.data || null;
      const uniqueTxnId = req.body?.unique_txn_id || req.query?.unique_txn_id || null;

      const outcome = await paymentsService.handleDgePayCallback({
        encryptedData,
        uniqueTxnId,
        query: req.query,
        body: req.body,
      });

      // Target frontend URL
      const frontendBase =
        env.dgepay.frontendResultUrl || `${env.frontendUrl}/merchant/addons?payment=result`;
      const url = new URL(frontendBase);
      url.searchParams.set("paymentStatus", outcome.status || "unresolved");
      if (outcome.orderNumber) url.searchParams.set("order", outcome.orderNumber);
      if (outcome.paymentReference) url.searchParams.set("paymentRef", outcome.paymentReference);

      // If requested via API / JSON (e.g. server-to-server webhook), return JSON
      const isJsonRequest =
        req.headers.accept?.includes("application/json") ||
        req.headers["content-type"]?.includes("application/json");

      if (isJsonRequest && !req.query.browser_redirect) {
        return res.json({
          success: true,
          outcome,
          redirectUrl: url.toString(),
        });
      }

      // Browser redirect back to Merchant Portal
      return res.redirect(url.toString());
    } catch (err) {
      console.error("[DGePay Callback Error]", err);
      const frontendBase =
        env.dgepay.frontendResultUrl || `${env.frontendUrl}/merchant/addons?payment=result`;
      const url = new URL(frontendBase);
      url.searchParams.set("paymentStatus", "error");
      url.searchParams.set("errorMessage", err.message || "Payment verification error");
      return res.redirect(url.toString());
    }
  },

  /**
   * Merchant fetches status for a specific payment reference
   */
  async getMerchantPaymentStatus(req, res, next) {
    try {
      const merchant = await merchantRepository.findOrCreateMerchantByUserId(req.user.id);
      const paymentRef = req.params.paymentReference;

      const payment = await paymentsService.getPaymentStatus(paymentRef, merchant.id);
      res.json({ success: true, data: payment, payment });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Merchant fetches their own add-on orders
   */
  async listMerchantOrders(req, res, next) {
    try {
      const merchant = await merchantRepository.findOrCreateMerchantByUserId(req.user.id);
      const { status, search, page = 1, limit = 20 } = req.query;

      const data = await paymentsRepository.listOrders({
        merchantId: merchant.id,
        status,
        search,
        page: Number(page),
        limit: Number(limit),
      });

      const stats = await paymentsRepository.getPaymentStats({ merchantId: merchant.id });

      res.json({
        success: true,
        count: data.orders?.length || 0,
        data: data.orders,
        orders: data.orders,
        pagination: data.pagination,
        stats,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Merchant fetches their own add-on payments
   */
  async listMerchantPayments(req, res, next) {
    try {
      const merchant = await merchantRepository.findOrCreateMerchantByUserId(req.user.id);
      const { status, search, page = 1, limit = 20 } = req.query;

      const data = await paymentsRepository.listPayments({
        merchantId: merchant.id,
        status,
        search,
        page: Number(page),
        limit: Number(limit),
      });

      const stats = await paymentsRepository.getPaymentStats({ merchantId: merchant.id });

      res.json({
        success: true,
        count: data.payments?.length || 0,
        data: data.payments,
        payments: data.payments,
        pagination: data.pagination,
        stats,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Admin: List all add-on orders
   */
  async listAdminOrders(req, res, next) {
    try {
      const { status, search, isArchived, page = 1, limit = 20 } = req.query;

      const data = await paymentsRepository.listOrders({
        status,
        search,
        isArchived: isArchived !== undefined ? Number(isArchived) : 0,
        page: Number(page),
        limit: Number(limit),
      });

      const stats = await paymentsRepository.getPaymentStats();

      res.json({
        success: true,
        count: data.orders?.length || 0,
        data: data.orders,
        orders: data.orders,
        pagination: data.pagination,
        stats,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Admin: List all add-on payments & financial statistics
   */
  async listAdminPayments(req, res, next) {
    try {
      const { status, gateway, search, isArchived, page = 1, limit = 20 } = req.query;

      const data = await paymentsRepository.listPayments({
        status,
        gateway,
        search,
        isArchived: isArchived !== undefined ? Number(isArchived) : 0,
        page: Number(page),
        limit: Number(limit),
      });

      const stats = await paymentsRepository.getPaymentStats();

      res.json({
        success: true,
        count: data.payments?.length || 0,
        data: data.payments,
        payments: data.payments,
        pagination: data.pagination,
        stats,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Admin: Get payment details by ID
   */
  async getAdminPaymentById(req, res, next) {
    try {
      const id = Number(req.params.paymentId);
      const payment = await paymentsRepository.getPaymentById(id);
      if (!payment) {
        return res.status(404).json({ success: false, message: "Payment record not found" });
      }
      res.json({ success: true, data: payment, payment });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Admin: Reconcile payment status directly with DGePay gateway
   */
  async reconcileAdminPayment(req, res, next) {
    try {
      const id = Number(req.params.paymentId);
      const result = await paymentsService.adminReconcilePayment(id, req.user);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * Admin: Soft-archive a payment record
   */
  async archiveAdminPayment(req, res, next) {
    try {
      const id = Number(req.params.paymentId);
      const { reason } = req.body;
      await paymentsRepository.archivePayment(id, {
        adminEmail: req.user.email,
        reason: reason || "Archived from operational view",
      });
      res.json({ success: true, message: "Payment record safely archived." });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Admin: Review order (approve / reject)
   */
  async reviewAdminOrder(req, res, next) {
    try {
      const id = Number(req.params.orderId);
      const { action, notes } = req.body;
      const validActions = ["approve", "reject", "activate", "suspend"];
      if (!validActions.includes(action)) {
        return res.status(400).json({ success: false, message: "Invalid action" });
      }

      let newStatus = "approved";
      if (action === "reject") newStatus = "rejected";
      if (action === "activate") newStatus = "active";
      if (action === "suspend") newStatus = "suspended";

      await paymentsRepository.updateOrderStatus(id, newStatus, { adminNotes: notes });
      const order = await paymentsRepository.getOrderById(id);

      if (order && order.merchant_id && order.addon_id) {
        const maStatus = action === "reject" ? "closed" : action === "activate" ? "activated" : "approved";
        await db.execute(
          "UPDATE merchant_addons SET status = ?, updated_at = NOW() WHERE merchant_id = ? AND addon_id = ?",
          [maStatus, order.merchant_id, order.addon_id]
        );
      }

      res.json({ success: true, message: `Order status updated to ${newStatus}`, order });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Merchant resumes/retries checkout for an existing unpaid order
   */
  async resumeMerchantOrderCheckout(req, res, next) {
    try {
      const orderId = Number(req.params.orderId);
      const { paymentMethod } = req.body;
      const result = await paymentsService.resumeAddonOrderPayment({
        userId: req.user.id,
        orderId,
        paymentMethod,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * Merchant gets detail of single owned order
   */
  async getMerchantOrderById(req, res, next) {
    try {
      const merchant = await merchantRepository.findOrCreateMerchantByUserId(req.user.id);
      const orderId = Number(req.params.orderId);
      const order = await paymentsRepository.getOrderById(orderId);
      if (!order || Number(order.merchant_id) !== Number(merchant.id)) {
        return res.status(404).json({ success: false, message: "Order not found" });
      }
      const payments = await paymentsRepository.getPaymentsByOrderId(orderId);
      res.json({ success: true, data: order, order, payments });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Merchant gets detail of single owned payment
   */
  async getMerchantPaymentById(req, res, next) {
    try {
      const merchant = await merchantRepository.findOrCreateMerchantByUserId(req.user.id);
      const paymentId = Number(req.params.paymentId);
      const payment = await paymentsRepository.getPaymentById(paymentId);
      if (!payment || Number(payment.merchant_id) !== Number(merchant.id)) {
        return res.status(404).json({ success: false, message: "Payment record not found" });
      }
      res.json({ success: true, data: payment, payment });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Merchant refreshes status of a payment directly with DGePay
   */
  async refreshMerchantPayment(req, res, next) {
    try {
      const merchant = await merchantRepository.findOrCreateMerchantByUserId(req.user.id);
      const paymentId = Number(req.params.paymentId);
      const payment = await paymentsRepository.getPaymentById(paymentId);
      if (!payment || Number(payment.merchant_id) !== Number(merchant.id)) {
        return res.status(404).json({ success: false, message: "Payment record not found" });
      }

      const refreshed = await paymentsService.getPaymentStatus(payment.payment_reference, merchant.id);
      res.json({
        success: true,
        data: refreshed,
        payment: refreshed,
        message: `Payment status refreshed: currently '${refreshed.status}'`,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Admin gets detail of single order
   */
  async getAdminOrderById(req, res, next) {
    try {
      const orderId = Number(req.params.orderId);
      const order = await paymentsRepository.getOrderById(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found" });
      }
      const payments = await paymentsRepository.getPaymentsByOrderId(orderId);
      res.json({ success: true, data: order, order, payments });
    } catch (err) {
      next(err);
    }
  },

  /**
   * Admin archives order
   */
  async archiveAdminOrder(req, res, next) {
    try {
      const orderId = Number(req.params.orderId);
      const { reason } = req.body;
      await db.execute(
        "UPDATE addon_orders SET is_archived = 1, archived_at = NOW(), archived_by = ? WHERE id = ?",
        [`${req.user.email || "Admin"}: ${reason || "Archived"}`, orderId]
      );
      res.json({ success: true, message: "Order archived successfully" });
    } catch (err) {
      next(err);
    }
  },
};
