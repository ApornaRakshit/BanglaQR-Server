import nodemailer from "nodemailer";
import { merchantInvoicesRepository } from "./merchant.invoices.repository.js";
import { merchantRepository } from "../merchant.repository.js";
import { generateInvoicePdf } from "./merchant.invoices.pdf.js";
import { generateInvoiceExcelWorkbook } from "../../invoices/invoice.excel.js";
import { env } from "../../../config/env.js";
import { db } from "../../../config/db.js";

// Helper to calculate totals securely on backend
function calculateInvoiceTotals(items = [], globalDiscount = 0, globalTax = 0) {
  let subtotal = 0;
  let itemsDiscount = 0;
  let itemsTax = 0;

  const sanitizedItems = items.map((item) => {
    const qty = Math.max(1, Number(item.quantity || item.qty || 1));
    const price = Math.max(0, Number(item.unitPrice || item.unit_price || 0));
    const lineSubtotal = qty * price;

    const discountRate = Math.max(0, Math.min(100, Number(item.discountPercent || 0)));
    const itemDiscount = item.discountAmount ? Number(item.discountAmount) : (lineSubtotal * discountRate) / 100;

    const taxRate = Math.max(0, Math.min(100, Number(item.taxPercent || 0)));
    const itemTax = item.taxAmount ? Number(item.taxAmount) : ((lineSubtotal - itemDiscount) * taxRate) / 100;

    const lineTotal = Math.max(0, lineSubtotal - itemDiscount + itemTax);

    subtotal += lineSubtotal;
    itemsDiscount += itemDiscount;
    itemsTax += itemTax;

    return {
      name: item.name || item.description || "Service / Product",
      description: item.description || item.name || "",
      quantity: qty,
      unitPrice: price,
      discountPercent: discountRate,
      discountAmount: Number(itemDiscount.toFixed(2)),
      taxPercent: taxRate,
      taxAmount: Number(itemTax.toFixed(2)),
      total: Number(lineTotal.toFixed(2)),
    };
  });

  const totalDiscount = itemsDiscount + Math.max(0, Number(globalDiscount || 0));
  const totalTax = itemsTax + Math.max(0, Number(globalTax || 0));
  const grandTotal = Math.max(0, subtotal - totalDiscount + totalTax);

  return {
    items: sanitizedItems,
    subtotal: Number(subtotal.toFixed(2)),
    discountAmount: Number(totalDiscount.toFixed(2)),
    taxAmount: Number(totalTax.toFixed(2)),
    totalAmount: Number(grandTotal.toFixed(2)),
  };
}

export const merchantInvoicesService = {
  // ==========================================
  // DASHBOARD STATS
  // ==========================================
  async getInvoiceStats(userId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    return await merchantInvoicesRepository.getInvoiceStats(merchant.id);
  },

  // ==========================================
  // LIST INVOICES
  // ==========================================
  async listInvoices(userId, query) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    return await merchantInvoicesRepository.listInvoices(merchant.id, query);
  },

  // ==========================================
  // GET INVOICE BY ID
  // ==========================================
  async getInvoiceById(userId, invoiceId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const invoice = await merchantInvoicesRepository.getInvoiceById(merchant.id, invoiceId);
    if (!invoice) {
      const err = new Error("Invoice not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }
    return invoice;
  },

  // ==========================================
  // GET UNIQUE INVOICE NUMBER
  // ==========================================
  async getNextInvoiceNumber(userId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const invoiceNumber = await merchantInvoicesRepository.generateUniqueInvoiceNumber(merchant.id);
    return { invoiceNumber };
  },

  // ==========================================
  // CREATE INVOICE
  // ==========================================
  async createInvoice(userId, payload) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);

    // If customerId is provided, verify customer ownership
    let customerData = {
      customerId: payload.customerId || payload.customer_id || null,
      customerName: payload.customerName || payload.customer_name || "Customer",
      customerEmail: payload.customerEmail || payload.customer_email || "customer@example.com",
      customerPhone: payload.customerPhone || payload.customer_phone || null,
      customerAddress: payload.customerAddress || payload.customer_address || null,
      customerBusinessName: payload.customerBusinessName || payload.customer_business_name || null,
    };

    if (customerData.customerId) {
      const cust = await merchantInvoicesRepository.getCustomerById(merchant.id, customerData.customerId);
      if (!cust) {
        const err = new Error("Selected customer not found or unauthorized");
        err.statusCode = 404;
        throw err;
      }
      customerData = {
        customerId: cust.id,
        customerName: cust.name,
        customerEmail: cust.email || customerData.customerEmail,
        customerPhone: cust.phone || customerData.customerPhone,
        customerAddress: cust.billingAddress || customerData.customerAddress,
        customerBusinessName: cust.businessName || customerData.customerBusinessName,
      };
    } else if (payload.saveCustomer && customerData.customerName) {
      // Auto-save new customer if requested
      const newCust = await merchantInvoicesRepository.createCustomer(merchant.id, {
        name: customerData.customerName,
        businessName: customerData.customerBusinessName,
        email: customerData.customerEmail,
        phone: customerData.customerPhone,
        billingAddress: customerData.customerAddress,
      });
      customerData.customerId = newCust.id;
    }

    // Backend calculation
    const calculated = calculateInvoiceTotals(
      payload.items || [],
      payload.discountAmount || payload.discount_amount || 0,
      payload.taxAmount || payload.tax_amount || 0
    );

    const invoicePayload = {
      ...payload,
      ...customerData,
      items: calculated.items,
      subtotal: calculated.subtotal,
      discountAmount: calculated.discountAmount,
      taxAmount: calculated.taxAmount,
      amount: calculated.totalAmount,
      totalAmount: calculated.totalAmount,
      amountPaid: 0,
    };

    const created = await merchantInvoicesRepository.createInvoice(merchant.id, invoicePayload, userId);

    // If sendNow requested, trigger sending workflow
    if (payload.sendNow) {
      await this.sendInvoice(userId, created.id);
    }

    return {
      success: true,
      message: payload.sendNow ? "Invoice created and sent successfully" : "Invoice created successfully",
      data: created,
    };
  },

  // ==========================================
  // UPDATE DRAFT INVOICE
  // ==========================================
  async updateDraftInvoice(userId, invoiceId, payload) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);

    const calculated = calculateInvoiceTotals(
      payload.items || [],
      payload.discountAmount || payload.discount_amount || 0,
      payload.taxAmount || payload.tax_amount || 0
    );

    const updatePayload = {
      ...payload,
      items: calculated.items,
      subtotal: calculated.subtotal,
      discountAmount: calculated.discountAmount,
      taxAmount: calculated.taxAmount,
      amount: calculated.totalAmount,
      totalAmount: calculated.totalAmount,
    };

    await merchantInvoicesRepository.updateDraftInvoice(merchant.id, invoiceId, updatePayload, userId);

    return {
      success: true,
      message: "Draft invoice updated successfully",
      data: { id: invoiceId, ...calculated },
    };
  },

  // ==========================================
  // DOWNLOAD / STREAM PDF
  // ==========================================
  async getInvoicePdfBuffer(userId, invoiceId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const invoice = await merchantInvoicesRepository.getInvoiceById(merchant.id, invoiceId);

    if (!invoice) {
      const err = new Error("Invoice not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }

    const pdfBuffer = await generateInvoicePdf(invoice);
    return {
      pdfBuffer,
      invoiceNumber: invoice.invoiceNumber,
    };
  },

  // ==========================================
  // SEND INVOICE TO CUSTOMER
  // ==========================================
  async sendInvoice(userId, invoiceId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const invoice = await merchantInvoicesRepository.getInvoiceById(merchant.id, invoiceId);

    if (!invoice) {
      const err = new Error("Invoice not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }

    if (invoice.status === "cancelled") {
      const err = new Error("Cannot send a cancelled invoice");
      err.statusCode = 400;
      throw err;
    }

    await merchantInvoicesRepository.markAsSent(merchant.id, invoiceId, userId);

    const hasSmtp = Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);

    if (hasSmtp && invoice.customerEmail) {
      try {
        const pdfBuffer = await generateInvoicePdf(invoice);
        const transporter = nodemailer.createTransport({
          host: env.smtp.host,
          port: env.smtp.port,
          secure: env.smtp.secure,
          auth: {
            user: env.smtp.user,
            pass: env.smtp.pass,
          },
          connectionTimeout: 3000,
          greetingTimeout: 2000,
          socketTimeout: 3000,
        });

        await transporter.sendMail({
          from: env.smtp.from || `"${invoice.merchant.companyName}" <no-reply@banglaqr.com>`,
          to: invoice.customerEmail,
          subject: `Invoice ${invoice.invoiceNumber} from ${invoice.merchant.companyName}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
              <h2 style="color: #059669; margin-top: 0;">${invoice.merchant.companyName}</h2>
              <p>Dear <strong>${invoice.customerName}</strong>,</p>
              <p>Please find attached invoice <strong>#${invoice.invoiceNumber}</strong> for the amount of <strong>৳${invoice.amount.toFixed(2)}</strong>.</p>
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr style="background-color: #f8fafc;">
                  <td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>Invoice #</strong></td>
                  <td style="padding: 8px; border: 1px solid #e2e8f0;">${invoice.invoiceNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>Due Date</strong></td>
                  <td style="padding: 8px; border: 1px solid #e2e8f0;">${invoice.dueDate || "Upon Receipt"}</td>
                </tr>
                <tr style="background-color: #f8fafc;">
                  <td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>Total Due</strong></td>
                  <td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>৳${invoice.balanceDue.toFixed(2)}</strong></td>
                </tr>
              </table>
              ${invoice.paymentInstructions ? `<p><strong>Payment Instructions:</strong><br>${invoice.paymentInstructions}</p>` : ""}
              <p style="color: #64748b; font-size: 12px; margin-top: 30px;">This digital invoice was generated by ${invoice.merchant.companyName} via BanglaQR.</p>
            </div>
          `,
          attachments: [
            {
              filename: `Invoice-${invoice.invoiceNumber}.pdf`,
              content: pdfBuffer,
            },
          ],
        });

        return {
          success: true,
          message: `Invoice ${invoice.invoiceNumber} sent successfully to ${invoice.customerEmail}.`,
          deliveryStatus: "sent",
        };
      } catch (mailErr) {
        console.error("SMTP sending error:", mailErr.message);
        return {
          success: true,
          message: `Invoice marked as sent in system. Email notification delivery failed: ${mailErr.message}`,
          deliveryStatus: "failed",
        };
      }
    }

    return {
      success: true,
      message: `Invoice #${invoice.invoiceNumber} marked as sent. Email delivery adapter is in local development mode.`,
      deliveryStatus: "local_dev_bypass",
    };
  },

  // ==========================================
  // SEND PAYMENT REMINDER
  // ==========================================
  async sendReminder(userId, invoiceId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const invoice = await merchantInvoicesRepository.getInvoiceById(merchant.id, invoiceId);

    if (!invoice) {
      const err = new Error("Invoice not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }

    if (invoice.status === "paid" || invoice.status === "cancelled") {
      const err = new Error(`Cannot send reminder for an invoice with status '${invoice.status}'`);
      err.statusCode = 400;
      throw err;
    }

    await merchantInvoicesRepository.recordReminder(merchant.id, invoiceId, userId);

    const hasSmtp = Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
    if (hasSmtp && invoice.customerEmail) {
      try {
        const transporter = nodemailer.createTransport({
          host: env.smtp.host,
          port: env.smtp.port,
          secure: env.smtp.secure,
          auth: { user: env.smtp.user, pass: env.smtp.pass },
          connectionTimeout: 3000,
          greetingTimeout: 2000,
          socketTimeout: 3000,
        });

        await transporter.sendMail({
          from: env.smtp.from || `"${invoice.merchant.companyName}" <no-reply@banglaqr.com>`,
          to: invoice.customerEmail,
          subject: `Payment Reminder: Invoice ${invoice.invoiceNumber} from ${invoice.merchant.companyName}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
              <h3 style="color: #d97706; margin-top: 0;">Payment Reminder</h3>
              <p>Dear <strong>${invoice.customerName}</strong>,</p>
              <p>This is a reminder regarding outstanding invoice <strong>#${invoice.invoiceNumber}</strong> with a balance due of <strong>৳${invoice.balanceDue.toFixed(2)}</strong>.</p>
              <p>Due Date: <strong>${invoice.dueDate || "Immediate"}</strong></p>
            </div>
          `,
        });

        return { success: true, message: `Reminder email sent to ${invoice.customerEmail}.` };
      } catch (e) {
        return { success: true, message: `Reminder recorded in system. Email failed: ${e.message}` };
      }
    }

    return {
      success: true,
      message: `Reminder recorded for invoice #${invoice.invoiceNumber}. (Local dev mode)`,
    };
  },

  // ==========================================
  // RECORD PAYMENT
  // ==========================================
  async recordPayment(userId, invoiceId, payload) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const result = await merchantInvoicesRepository.recordPayment(merchant.id, invoiceId, payload, userId);
    return {
      success: true,
      message: "Payment recorded successfully",
      data: result,
    };
  },

  // ==========================================
  // CANCEL INVOICE
  // ==========================================
  async cancelInvoice(userId, invoiceId, reason) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const result = await merchantInvoicesRepository.cancelInvoice(merchant.id, invoiceId, reason, userId);
    return result;
  },

  // ==========================================
  // GET PAYMENT LINK
  // ==========================================
  async getPaymentLink(userId, invoiceId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const invoice = await merchantInvoicesRepository.getInvoiceById(merchant.id, invoiceId);

    if (!invoice) {
      const err = new Error("Invoice not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }

    // Check if merchant has an active payment gateway service
    const [services] = await db.execute(
      `
        SELECT mgs.*, g.name AS gateway_name, g.code AS gateway_code
        FROM merchant_gateway_services mgs
        JOIN gateways g ON mgs.gateway_id = g.id
        WHERE mgs.merchant_id = ? AND mgs.status = 'active'
        LIMIT 1
      `,
      [merchant.id]
    );

    if (!services.length) {
      return {
        available: false,
        message: "No active payment gateway integration configured for your account. You can apply for a gateway service in Gateway Services catalogue.",
      };
    }

    const activeService = services[0];
    const rawConfig = typeof activeService.configuration === "string" ? JSON.parse(activeService.configuration) : (activeService.configuration || {});

    return {
      available: true,
      gatewayName: activeService.gateway_name,
      gatewayCode: activeService.gateway_code,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.balanceDue,
      currency: invoice.currency,
      paymentUrl: `${rawConfig.success_url || "https://checkout.banglaqr.com/pay"}/?inv=${invoice.invoiceNumber}&amt=${invoice.balanceDue}`,
    };
  },

  // ==========================================
  // CUSTOMER MANAGEMENT
  // ==========================================
  async listCustomers(userId, query) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    return await merchantInvoicesRepository.listCustomers(merchant.id, query);
  },

  async createCustomer(userId, payload) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    if (!payload.name) {
      const err = new Error("Customer name is required");
      err.statusCode = 400;
      throw err;
    }
    const customer = await merchantInvoicesRepository.createCustomer(merchant.id, payload);
    return {
      success: true,
      message: "Customer created successfully",
      data: customer,
    };
  },

  async getCustomerById(userId, customerId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const customer = await merchantInvoicesRepository.getCustomerById(merchant.id, customerId);
    if (!customer) {
      const err = new Error("Customer not found or unauthorized");
      err.statusCode = 404;
      throw err;
    }
    return customer;
  },

  async updateCustomer(userId, customerId, payload) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const result = await merchantInvoicesRepository.updateCustomer(merchant.id, customerId, payload);
    return {
      success: true,
      message: "Customer updated successfully",
      data: result,
    };
  },

  async deleteCustomer(userId, customerId) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const result = await merchantInvoicesRepository.archiveCustomer(merchant.id, customerId);
    return result;
  },

  async exportExcel(userId, filters = {}) {
    const merchant = await merchantRepository.findOrCreateMerchantByUserId(userId);
    const result = await merchantInvoicesRepository.listInvoices(merchant.id, {
      ...filters,
      exportAll: true,
    });
    const invoices = result.invoices || [];
    const invoiceIds = invoices.map((i) => i.id);
    const payments = await merchantInvoicesRepository.getPaymentsForInvoices(merchant.id, invoiceIds);

    return await generateInvoiceExcelWorkbook({
      invoices,
      payments,
      scope: "merchant",
    });
  },
};

