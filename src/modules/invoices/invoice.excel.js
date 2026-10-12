import ExcelJS from "exceljs";

function sanitizeCell(val) {
  if (val === null || val === undefined) return "";
  if (typeof val === "string" && /^[=+\-@]/.test(val)) {
    return "'" + val;
  }
  return val;
}

function formatDate(d) {
  if (!d) return "";
  try {
    return new Date(d).toISOString().split("T")[0];
  } catch {
    return String(d);
  }
}

export async function generateInvoiceExcelWorkbook({ invoices = [], payments = [], scope = "merchant" }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BanglaQR Digital Payment Platform";
  workbook.created = new Date();
  workbook.modified = new Date();

  const isAdmin = scope === "admin";
  const headerBgColor = isAdmin ? "1E293B" : "065F46"; // Slate-900 for Admin, Emerald-800 for Merchant

  // ==========================================
  // WORKSHEET 1: INVOICE SUMMARY
  // ==========================================
  const summarySheet = workbook.addWorksheet("Invoice Summary", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const summaryColumns = isAdmin
    ? [
        { header: "Invoice ID", key: "id", width: 12 },
        { header: "Invoice Number", key: "invoiceNumber", width: 20 },
        { header: "Merchant Code", key: "merchantCode", width: 20 },
        { header: "Merchant Business Name", key: "companyName", width: 28 },
        { header: "Merchant Contact Email", key: "merchantEmail", width: 26 },
        { header: "Customer Name", key: "customerName", width: 24 },
        { header: "Customer Business Name", key: "customerBusinessName", width: 26 },
        { header: "Customer Email", key: "customerEmail", width: 26 },
        { header: "Customer Phone", key: "customerPhone", width: 18 },
        { header: "Issue Date", key: "issueDate", width: 14 },
        { header: "Due Date", key: "dueDate", width: 14 },
        { header: "Currency", key: "currency", width: 10 },
        { header: "Subtotal", key: "subtotal", width: 16 },
        { header: "Discount Amount", key: "discountAmount", width: 16 },
        { header: "Tax Amount", key: "taxAmount", width: 16 },
        { header: "Grand Total", key: "grandTotal", width: 18 },
        { header: "Amount Paid", key: "amountPaid", width: 16 },
        { header: "Amount Due", key: "balanceDue", width: 16 },
        { header: "Invoice Status", key: "status", width: 16 },
        { header: "Created Date", key: "createdAt", width: 16 },
        { header: "Updated Date", key: "updatedAt", width: 16 },
      ]
    : [
        { header: "Invoice Number", key: "invoiceNumber", width: 20 },
        { header: "Customer Name", key: "customerName", width: 24 },
        { header: "Customer Business Name", key: "customerBusinessName", width: 26 },
        { header: "Customer Email", key: "customerEmail", width: 26 },
        { header: "Customer Phone", key: "customerPhone", width: 18 },
        { header: "Issue Date", key: "issueDate", width: 14 },
        { header: "Due Date", key: "dueDate", width: 14 },
        { header: "Currency", key: "currency", width: 10 },
        { header: "Subtotal", key: "subtotal", width: 16 },
        { header: "Discount Amount", key: "discountAmount", width: 16 },
        { header: "Tax Amount", key: "taxAmount", width: 16 },
        { header: "Grand Total", key: "grandTotal", width: 18 },
        { header: "Amount Paid", key: "amountPaid", width: 16 },
        { header: "Amount Due", key: "balanceDue", width: 16 },
        { header: "Invoice Status", key: "status", width: 16 },
        { header: "Created Date", key: "createdAt", width: 16 },
        { header: "Updated Date", key: "updatedAt", width: 16 },
      ];

  summarySheet.columns = summaryColumns;

  // Add Summary Rows
  for (const inv of invoices) {
    const rawSubtotal = Number(inv.subtotal ?? inv.amount ?? 0);
    const rawDiscount = Number(inv.discount_amount ?? inv.discountAmount ?? 0);
    const rawTax = Number(inv.tax_amount ?? inv.taxAmount ?? 0);
    const rawTotal = Number(inv.amount ?? inv.grandTotal ?? 0);
    const rawPaid = Number(inv.amount_paid ?? inv.amountPaid ?? 0);
    const rawBalance = Number(inv.balance_due ?? inv.balanceDue ?? 0);

    const rowData = {
      ...(isAdmin ? { id: inv.id } : {}),
      invoiceNumber: sanitizeCell(inv.invoice_number || inv.invoiceNumber || `INV-${inv.id}`),
      ...(isAdmin
        ? {
            merchantCode: sanitizeCell(inv.merchant_code || inv.merchantCode || "—"),
            companyName: sanitizeCell(inv.company_name || inv.companyName || "Merchant information unavailable"),
            merchantEmail: sanitizeCell(inv.merchant_email || inv.merchantEmail || "—"),
          }
        : {}),
      customerName: sanitizeCell(inv.customer_name || inv.customerName || "—"),
      customerBusinessName: sanitizeCell(inv.customer_business_name || inv.customerBusinessName || "—"),
      customerEmail: sanitizeCell(inv.customer_email || inv.customerEmail || "—"),
      customerPhone: sanitizeCell(inv.customer_phone || inv.customerPhone || "—"),
      issueDate: formatDate(inv.issue_date || inv.issueDate),
      dueDate: (inv.due_date || inv.dueDate) ? formatDate(inv.due_date || inv.dueDate) : "Not set",
      currency: sanitizeCell(inv.currency || "BDT"),
      subtotal: rawSubtotal,
      discountAmount: rawDiscount,
      taxAmount: rawTax,
      grandTotal: rawTotal,
      amountPaid: rawPaid,
      balanceDue: rawBalance,
      status: String(inv.status || "draft").toUpperCase(),
      createdAt: formatDate(inv.created_at || inv.createdAt),
      updatedAt: formatDate(inv.updated_at || inv.updatedAt),
    };

    summarySheet.addRow(rowData);
  }

  // Format Numeric/Currency Columns in Summary
  summarySheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: headerBgColor },
      };
      row.height = 26;
      row.alignment = { vertical: "middle", horizontal: "center" };
    } else {
      row.height = 20;
      row.alignment = { vertical: "middle" };
      // Format currency cells
      const currencyKeys = ["subtotal", "discountAmount", "taxAmount", "grandTotal", "amountPaid", "balanceDue"];
      currencyKeys.forEach((k) => {
        const cell = row.getCell(k);
        if (cell && typeof cell.value === "number") {
          cell.numFmt = '"৳"#,##0.00';
          cell.alignment = { vertical: "middle", horizontal: "right" };
        }
      });
    }
  });

  summarySheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: summaryColumns.length },
  };

  // ==========================================
  // WORKSHEET 2: INVOICE ITEMS
  // ==========================================
  const itemsSheet = workbook.addWorksheet("Invoice Items", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const itemColumns = isAdmin
    ? [
        { header: "Invoice ID", key: "invoiceId", width: 12 },
        { header: "Invoice Number", key: "invoiceNumber", width: 20 },
        { header: "Merchant Code", key: "merchantCode", width: 20 },
        { header: "Customer Name", key: "customerName", width: 24 },
        { header: "Item Description", key: "description", width: 34 },
        { header: "Quantity", key: "quantity", width: 12 },
        { header: "Unit Price", key: "unitPrice", width: 16 },
        { header: "Discount %", key: "discountPercent", width: 14 },
        { header: "Tax %", key: "taxPercent", width: 14 },
        { header: "Line Total", key: "lineTotal", width: 18 },
      ]
    : [
        { header: "Invoice Number", key: "invoiceNumber", width: 20 },
        { header: "Customer Name", key: "customerName", width: 24 },
        { header: "Item Description", key: "description", width: 34 },
        { header: "Quantity", key: "quantity", width: 12 },
        { header: "Unit Price", key: "unitPrice", width: 16 },
        { header: "Discount %", key: "discountPercent", width: 14 },
        { header: "Tax %", key: "taxPercent", width: 14 },
        { header: "Line Total", key: "lineTotal", width: 18 },
      ];

  itemsSheet.columns = itemColumns;

  // Add Item Rows from each invoice
  for (const inv of invoices) {
    let rawItems = inv.items;
    if (typeof rawItems === "string") {
      try {
        rawItems = JSON.parse(rawItems);
      } catch {
        rawItems = [];
      }
    }
    if (!Array.isArray(rawItems)) rawItems = [];

    const invNum = sanitizeCell(inv.invoice_number || inv.invoiceNumber || `INV-${inv.id}`);
    const custName = sanitizeCell(inv.customer_name || inv.customerName || "—");
    const merchCode = sanitizeCell(inv.merchant_code || inv.merchantCode || "—");

    for (const it of rawItems) {
      const qty = Number(it.quantity || 1);
      const unit = Number(it.unitPrice ?? it.unit_price ?? 0);
      const disc = Number(it.discountPercent ?? it.discount_percent ?? 0);
      const tax = Number(it.taxPercent ?? it.tax_percent ?? 0);
      const base = qty * unit;
      const discAmt = base * (disc / 100);
      const taxAmt = (base - discAmt) * (tax / 100);
      const total = Number(it.lineTotal ?? it.line_total ?? (base - discAmt + taxAmt));

      itemsSheet.addRow({
        ...(isAdmin ? { invoiceId: inv.id, merchantCode: merchCode } : {}),
        invoiceNumber: invNum,
        customerName: custName,
        description: sanitizeCell(it.description || "Service / Product Item"),
        quantity: qty,
        unitPrice: unit,
        discountPercent: `${disc}%`,
        taxPercent: `${tax}%`,
        lineTotal: total,
      });
    }
  }

  // Format Items Sheet
  itemsSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: headerBgColor },
      };
      row.height = 26;
      row.alignment = { vertical: "middle", horizontal: "center" };
    } else {
      row.height = 20;
      row.alignment = { vertical: "middle" };
      const qCell = row.getCell("quantity");
      if (qCell && typeof qCell.value === "number") qCell.numFmt = "#,##0";
      const uCell = row.getCell("unitPrice");
      if (uCell && typeof uCell.value === "number") uCell.numFmt = '"৳"#,##0.00';
      const lCell = row.getCell("lineTotal");
      if (lCell && typeof lCell.value === "number") lCell.numFmt = '"৳"#,##0.00';
    }
  });

  itemsSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: itemColumns.length },
  };

  // ==========================================
  // WORKSHEET 3: PAYMENT REFERENCES
  // ==========================================
  const paymentSheet = workbook.addWorksheet("Payment References", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const paymentColumns = isAdmin
    ? [
        { header: "Invoice ID", key: "invoiceId", width: 12 },
        { header: "Invoice Number", key: "invoiceNumber", width: 20 },
        { header: "Merchant Code", key: "merchantCode", width: 20 },
        { header: "Payment ID", key: "paymentId", width: 14 },
        { header: "Amount", key: "amount", width: 16 },
        { header: "Payment Date", key: "paymentDate", width: 14 },
        { header: "Payment Method", key: "paymentMethod", width: 18 },
        { header: "Reference ID", key: "referenceId", width: 24 },
        { header: "Gateway Verified", key: "isGatewayVerified", width: 18 },
        { header: "Notes", key: "notes", width: 30 },
        { header: "Recorded At", key: "createdAt", width: 16 },
      ]
    : [
        { header: "Invoice Number", key: "invoiceNumber", width: 20 },
        { header: "Payment ID", key: "paymentId", width: 14 },
        { header: "Amount", key: "amount", width: 16 },
        { header: "Payment Date", key: "paymentDate", width: 14 },
        { header: "Payment Method", key: "paymentMethod", width: 18 },
        { header: "Reference ID", key: "referenceId", width: 24 },
        { header: "Gateway Verified", key: "isGatewayVerified", width: 18 },
        { header: "Notes", key: "notes", width: 30 },
        { header: "Recorded At", key: "createdAt", width: 16 },
      ];

  paymentSheet.columns = paymentColumns;

  // Add Payment Rows
  for (const pay of payments) {
    paymentSheet.addRow({
      ...(isAdmin ? { invoiceId: pay.invoice_id, merchantCode: sanitizeCell(pay.merchant_code || "—") } : {}),
      invoiceNumber: sanitizeCell(pay.invoice_number || `INV-${pay.invoice_id}`),
      paymentId: pay.id,
      amount: Number(pay.amount || 0),
      paymentDate: formatDate(pay.payment_date),
      paymentMethod: sanitizeCell(pay.payment_method || "manual"),
      referenceId: sanitizeCell(pay.reference_id || "—"),
      isGatewayVerified: pay.is_gateway_verified ? "YES (Gateway Verified)" : "NO (Manual Record)",
      notes: sanitizeCell(pay.notes || "—"),
      createdAt: formatDate(pay.created_at),
    });
  }

  // Format Payment Sheet
  paymentSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: headerBgColor },
      };
      row.height = 26;
      row.alignment = { vertical: "middle", horizontal: "center" };
    } else {
      row.height = 20;
      row.alignment = { vertical: "middle" };
      const aCell = row.getCell("amount");
      if (aCell && typeof aCell.value === "number") aCell.numFmt = '"৳"#,##0.00';
    }
  });

  paymentSheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: paymentColumns.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

