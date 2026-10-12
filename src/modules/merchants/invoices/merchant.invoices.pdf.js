import PDFDocument from "pdfkit";

export function generateInvoicePdf(invoiceData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const buffers = [];

      doc.on("data", (chunk) => buffers.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", (err) => reject(err));

      const {
        invoiceNumber,
        issueDate,
        dueDate,
        status,
        currency = "BDT",
        subtotal = 0,
        discountAmount = 0,
        taxAmount = 0,
        totalAmount = 0,
        amountPaid = 0,
        balanceDue = 0,
        items = [],
        customer = {},
        merchant = {},
        notes,
        paymentInstructions,
        termsConditions,
        footerMessage,
      } = invoiceData;

      // Primary Colors
      const primaryColor = "#059669"; // Emerald 600
      const secondaryColor = "#1e293b"; // Slate 800
      const mutedColor = "#64748b"; // Slate 500
      const lightBg = "#f8fafc"; // Slate 50

      // --- 1. HEADER & BRANDING ---
      doc
        .fillColor(primaryColor)
        .fontSize(22)
        .font("Helvetica-Bold")
        .text(merchant.companyName || "BanglaQR Merchant Invoice", 50, 50);

      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font("Helvetica")
        .text(merchant.address || "Bangladesh", 50, 78)
        .text(`Email: ${merchant.email || "—"} | Phone: ${merchant.phone || "—"}`, 50, 92);

      // Status Badge (Top Right)
      const badgeText = (status || "draft").toUpperCase();
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .fillColor(status === "paid" ? "#047857" : status === "overdue" ? "#b91c1c" : "#0284c7")
        .text(`STATUS: ${badgeText}`, 380, 55, { align: "right" });

      // Invoice Number & Dates (Top Right)
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor(secondaryColor)
        .text(invoiceNumber || "INV-000000", 380, 72, { align: "right" });

      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor(mutedColor)
        .text(`Issue Date: ${issueDate ? new Date(issueDate).toLocaleDateString() : "—"}`, 380, 88, { align: "right" })
        .text(`Due Date: ${dueDate ? new Date(dueDate).toLocaleDateString() : "Upon Receipt"}`, 380, 102, { align: "right" });

      // Divider
      doc
        .strokeColor("#e2e8f0")
        .lineWidth(1)
        .moveTo(50, 125)
        .lineTo(545, 125)
        .stroke();

      // --- 2. BILL TO SECTION ---
      doc
        .fillColor(primaryColor)
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("BILL TO:", 50, 140);

      doc
        .fillColor(secondaryColor)
        .fontSize(11)
        .font("Helvetica-Bold")
        .text(customer.name || customer.customer_name || "Customer", 50, 155);

      if (customer.businessName || customer.customer_business_name) {
        doc
          .fillColor(mutedColor)
          .fontSize(9)
          .font("Helvetica")
          .text(customer.businessName || customer.customer_business_name, 50, 170);
      }

      const custAddrY = (customer.businessName || customer.customer_business_name) ? 184 : 170;
      doc
        .fillColor(mutedColor)
        .fontSize(9)
        .font("Helvetica")
        .text(customer.address || customer.customer_address || "Address: —", 50, custAddrY)
        .text(`Email: ${customer.email || customer.customer_email || "—"} | Phone: ${customer.phone || customer.customer_phone || "—"}`, 50, custAddrY + 14);

      // --- 3. ITEMS TABLE ---
      const tableTop = custAddrY + 45;

      // Table Header
      doc
        .rect(50, tableTop, 495, 24)
        .fill("#f1f5f9");

      doc
        .fillColor(secondaryColor)
        .fontSize(9)
        .font("Helvetica-Bold")
        .text("Description", 60, tableTop + 7)
        .text("Qty", 310, tableTop + 7, { width: 40, align: "right" })
        .text(`Unit (${currency})`, 360, tableTop + 7, { width: 80, align: "right" })
        .text(`Total (${currency})`, 450, tableTop + 7, { width: 85, align: "right" });

      let currentY = tableTop + 28;
      doc.font("Helvetica").fontSize(9);

      if (Array.isArray(items) && items.length > 0) {
        items.forEach((item, index) => {
          const qty = Number(item.quantity || 1);
          const unitPrice = Number(item.unitPrice || item.unit_price || 0);
          const lineTotal = Number(item.total ?? (qty * unitPrice));

          // Alternating row background
          if (index % 2 === 1) {
            doc.rect(50, currentY - 4, 495, 20).fill("#fafafa");
          }

          doc
            .fillColor(secondaryColor)
            .text(item.description || item.name || "Item", 60, currentY, { width: 240 })
            .text(String(qty), 310, currentY, { width: 40, align: "right" })
            .text(unitPrice.toFixed(2), 360, currentY, { width: 80, align: "right" })
            .text(lineTotal.toFixed(2), 450, currentY, { width: 85, align: "right" });

          currentY += 22;
        });
      } else {
        doc
          .fillColor(secondaryColor)
          .text("Standard Digital Payment Service", 60, currentY)
          .text("1", 310, currentY, { width: 40, align: "right" })
          .text(Number(totalAmount).toFixed(2), 360, currentY, { width: 80, align: "right" })
          .text(Number(totalAmount).toFixed(2), 450, currentY, { width: 85, align: "right" });
        currentY += 22;
      }

      // Divider below table
      doc
        .strokeColor("#e2e8f0")
        .lineWidth(1)
        .moveTo(50, currentY + 5)
        .lineTo(545, currentY + 5)
        .stroke();

      currentY += 15;

      // --- 4. TOTALS SUMMARY ---
      const summaryX = 350;
      doc.fontSize(9).font("Helvetica");

      doc.fillColor(mutedColor).text("Subtotal:", summaryX, currentY);
      doc.fillColor(secondaryColor).text(`${currency} ${Number(subtotal || totalAmount).toFixed(2)}`, 450, currentY, { width: 85, align: "right" });
      currentY += 16;

      if (Number(discountAmount) > 0) {
        doc.fillColor(mutedColor).text("Discount:", summaryX, currentY);
        doc.fillColor("#b91c1c").text(`-${currency} ${Number(discountAmount).toFixed(2)}`, 450, currentY, { width: 85, align: "right" });
        currentY += 16;
      }

      if (Number(taxAmount) > 0) {
        doc.fillColor(mutedColor).text("Tax / VAT:", summaryX, currentY);
        doc.fillColor(secondaryColor).text(`${currency} ${Number(taxAmount).toFixed(2)}`, 450, currentY, { width: 85, align: "right" });
        currentY += 16;
      }

      // Grand Total Box
      doc
        .rect(summaryX - 10, currentY + 2, 205, 26)
        .fill(lightBg);

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(primaryColor)
        .text("Grand Total:", summaryX, currentY + 9)
        .text(`${currency} ${Number(totalAmount).toFixed(2)}`, 450, currentY + 9, { width: 85, align: "right" });

      currentY += 34;

      if (Number(amountPaid) > 0) {
        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor("#047857")
          .text("Amount Paid:", summaryX, currentY)
          .text(`${currency} ${Number(amountPaid).toFixed(2)}`, 450, currentY, { width: 85, align: "right" });
        currentY += 16;
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(secondaryColor)
        .text("Balance Due:", summaryX, currentY)
        .text(`${currency} ${Number(balanceDue).toFixed(2)}`, 450, currentY, { width: 85, align: "right" });

      // --- 5. NOTES & PAYMENT INSTRUCTIONS (Bottom Left) ---
      let notesY = currentY - 70;
      if (notesY < tableTop + 50) notesY = tableTop + 70;

      if (notes) {
        doc
          .font("Helvetica-Bold")
          .fontSize(8)
          .fillColor(primaryColor)
          .text("NOTES:", 50, notesY);
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(mutedColor)
          .text(notes, 50, notesY + 12, { width: 260 });
        notesY += 35;
      }

      if (paymentInstructions) {
        doc
          .font("Helvetica-Bold")
          .fontSize(8)
          .fillColor(primaryColor)
          .text("PAYMENT INSTRUCTIONS:", 50, notesY);
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(mutedColor)
          .text(paymentInstructions, 50, notesY + 12, { width: 260 });
        notesY += 35;
      }

      if (termsConditions) {
        doc
          .font("Helvetica-Bold")
          .fontSize(8)
          .fillColor(primaryColor)
          .text("TERMS & CONDITIONS:", 50, notesY);
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor(mutedColor)
          .text(termsConditions, 50, notesY + 12, { width: 260 });
      }

      // --- 6. FOOTER ---
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor(mutedColor)
        .text(
          footerMessage || "Thank you for your business. For inquiries, please contact the issuing merchant.",
          50,
          750,
          { align: "center", width: 495 }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

