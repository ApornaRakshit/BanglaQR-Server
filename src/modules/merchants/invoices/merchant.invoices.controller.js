import { merchantInvoicesService } from "./merchant.invoices.service.js";

export const merchantInvoicesController = {
  async getStats(req, res, next) {
    try {
      const data = await merchantInvoicesService.getInvoiceStats(req.user.id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async list(req, res, next) {
    try {
      const data = await merchantInvoicesService.listInvoices(req.user.id, req.query);
      res.json({ success: true, ...data });
    } catch (err) {
      next(err);
    }
  },

  async getNextNumber(req, res, next) {
    try {
      const data = await merchantInvoicesService.getNextInvoiceNumber(req.user.id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async getById(req, res, next) {
    try {
      const id = Number(req.params.id);
      const data = await merchantInvoicesService.getInvoiceById(req.user.id, id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async create(req, res, next) {
    try {
      const result = await merchantInvoicesService.createInvoice(req.user.id, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const id = Number(req.params.id);
      const result = await merchantInvoicesService.updateDraftInvoice(req.user.id, id, req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async exportExcel(req, res, next) {
    try {
      const excelBuffer = await merchantInvoicesService.exportExcel(req.user.id, req.query);
      const today = new Date().toISOString().split("T")[0];

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="banglaqr-merchant-invoices-${today}.xlsx"`);
      res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
      res.send(excelBuffer);
    } catch (err) {
      next(err);
    }
  },

  async downloadPdf(req, res, next) {
    try {
      const id = Number(req.params.id);
      const { pdfBuffer, invoiceNumber } = await merchantInvoicesService.getInvoicePdfBuffer(req.user.id, id);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="Invoice-${invoiceNumber}.pdf"`);
      res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
      res.setHeader("X-Content-Type-Options", "nosniff");

      res.send(pdfBuffer);
    } catch (err) {
      next(err);
    }
  },

  async send(req, res, next) {
    try {
      const id = Number(req.params.id);
      const result = await merchantInvoicesService.sendInvoice(req.user.id, id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async sendReminder(req, res, next) {
    try {
      const id = Number(req.params.id);
      const result = await merchantInvoicesService.sendReminder(req.user.id, id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async recordPayment(req, res, next) {
    try {
      const id = Number(req.params.id);
      const result = await merchantInvoicesService.recordPayment(req.user.id, id, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async cancel(req, res, next) {
    try {
      const id = Number(req.params.id);
      const result = await merchantInvoicesService.cancelInvoice(req.user.id, id, req.body.reason);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async getPaymentLink(req, res, next) {
    try {
      const id = Number(req.params.id);
      const data = await merchantInvoicesService.getPaymentLink(req.user.id, id);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  // Customer Management
  async listCustomers(req, res, next) {
    try {
      const data = await merchantInvoicesService.listCustomers(req.user.id, req.query);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async createCustomer(req, res, next) {
    try {
      const result = await merchantInvoicesService.createCustomer(req.user.id, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },

  async getCustomerById(req, res, next) {
    try {
      const customerId = Number(req.params.customerId);
      const data = await merchantInvoicesService.getCustomerById(req.user.id, customerId);
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async updateCustomer(req, res, next) {
    try {
      const customerId = Number(req.params.customerId);
      const result = await merchantInvoicesService.updateCustomer(req.user.id, customerId, req.body);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async deleteCustomer(req, res, next) {
    try {
      const customerId = Number(req.params.customerId);
      const result = await merchantInvoicesService.deleteCustomer(req.user.id, customerId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
};

