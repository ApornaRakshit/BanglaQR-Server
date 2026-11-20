import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";

/**
 * Resolve Bengali-capable font or fallback to Helvetica
 */
function getFontPath() {
  const localFont = path.join(process.cwd(), "assets", "fonts", "kalpurush.ttf");
  if (fs.existsSync(localFont)) return localFont;
  const winFont = "C:/Windows/Fonts/kalpurush.ttf";
  if (fs.existsSync(winFont)) return winFont;
  return null;
}

/**
 * Format string or dash if empty
 */
function val(v) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

/**
 * Generate Structured Form-style PDF Overview
 */
export async function generateMerchantOverviewPdf(data = {}) {
  const merchant = data?.merchant || {};
  const profile = data?.profile || {};
  const contact = data?.contact || {};
  const commercial = data?.commercial || {};
  const kyc = data?.kyc || {};
  const documents = data?.documents || [];
  const services = data?.services || [];

  const doc = new PDFDocument({
    margin: 36,
    size: "A4",
    bufferPages: true,
    autoFirstPage: true,
  });

  const fontPath = getFontPath();
  if (fontPath) {
    doc.registerFont("Kalpurush", fontPath);
    doc.font("Kalpurush");
  } else {
    doc.font("Helvetica");
  }

  const pageWidth = 595.28;
  const margin = 36;
  const contentWidth = pageWidth - margin * 2; // ~523.28 pt

  // Colors
  const emeraldDark = "#065f46";
  const emeraldLight = "#ecfdf5";
  const emeraldBorder = "#a7f3d0";
  const slate900 = "#0f172a";
  const slate700 = "#334155";
  const slate500 = "#64748b";
  const slate100 = "#f1f5f9";
  const slate200 = "#e2e8f0";

  // --- HEADER SECTION (Form Style) ---
  const headerY = doc.y;
  doc.rect(margin, headerY, contentWidth, 54).fillAndStroke("#f8fafc", slate200);

  doc.fillColor(emeraldDark).fontSize(14).text("BANGLAQR DIGITAL PAYMENT SERVICES", margin + 12, headerY + 10, {
    width: contentWidth - 24,
    align: "center",
  });
  doc.fillColor(slate700).fontSize(9.5).text("মার্চেন্ট অনবোর্ডিং প্রোফাইল ও পরিচিতি বিবরণী (Merchant Onboarding Overview)", margin + 12, headerY + 28, {
    width: contentWidth - 24,
    align: "center",
  });

  doc.y = headerY + 62;

  // Top Meta Bar (Code, Status, Registration Date)
  const metaY = doc.y;
  doc.rect(margin, metaY, contentWidth, 24).fillAndStroke(emeraldLight, emeraldBorder);
  doc.fillColor(emeraldDark).fontSize(8.5);

  const codeText = `Merchant Code: ${val(merchant.merchantCode || merchant.merchant_code)}`;
  const statusText = `Status: ${String(merchant.accountStatus || merchant.account_status || "PENDING").toUpperCase().replace(/_/g, " ")}`;
  const regDateText = `Registered: ${merchant.createdAt ? new Date(merchant.createdAt).toLocaleDateString() : "—"}`;

  doc.text(codeText, margin + 8, metaY + 7);
  doc.text(statusText, margin + 200, metaY + 7);
  doc.text(regDateText, margin + 370, metaY + 7, { align: "right", width: contentWidth - 378 });

  doc.y = metaY + 32;

  // Helper for drawing 2-column or 3-column structured form table
  function drawSectionTitle(numberTitle, enTitle) {
    checkPageSpace(35);
    const startY = doc.y;
    doc.rect(margin, startY, contentWidth, 20).fillAndStroke("#e0e7ff", "#c7d2fe");
    doc.fillColor("#1e1b4b").fontSize(9.5).text(`${numberTitle} — ${enTitle}`, margin + 8, startY + 5);
    doc.y = startY + 24;
  }

  function checkPageSpace(neededHeight) {
    if (doc.y + neededHeight > 790) {
      doc.addPage();
    }
  }

  function drawKeyValueGrid(rows, cols = 2) {
    const colWidth = contentWidth / cols;
    for (const row of rows) {
      checkPageSpace(28);
      const rowY = doc.y;
      let maxHeight = 24;

      // Draw each column in row
      row.forEach((item, colIdx) => {
        const x = margin + colIdx * colWidth;
        const currentColWidth = (item.span || 1) * colWidth;

        // Background box for label & value
        doc.rect(x, rowY, currentColWidth, maxHeight).strokeColor(slate200).stroke();

        // Label
        doc.fillColor(slate500).fontSize(7.5).text(item.label, x + 5, rowY + 3, {
          width: currentColWidth - 10,
        });
        // Value
        doc.fillColor(slate900).fontSize(8.5).text(val(item.value), x + 5, rowY + 12, {
          width: currentColWidth - 10,
          ellipsis: true,
        });
      });

      doc.y = rowY + maxHeight;
    }
    doc.moveDown(0.6);
  }

  // --- SECTION 1: COMPANY PROFILE ---
  drawSectionTitle("০১. বাণিজ্যিক প্রতিষ্ঠানের পরিচিতি", "Company Profile");
  drawKeyValueGrid([
    [
      { label: "প্রতিষ্ঠানের নাম (Registered Company Name)", value: profile.companyName || profile.company_name || merchant.business_name },
      { label: "ব্যবসার ধরন (Business Entity Type)", value: profile.businessType || profile.business_type || kyc.businessEntityType || kyc.business_entity_type },
    ],
    [
      { label: "শিল্পের ক্ষেত্র / ক্যাটাগরি (Industry)", value: profile.industry || "Software & Technology" },
      { label: "ওয়েবসাইট / সোশ্যাল লিংক (Website)", value: profile.website || "—" },
    ],
    [
      { label: "বিভাগ ও জেলা (Division & District)", value: `${val(profile.city || profile.district)}, ${val(profile.state)}` },
      { label: "পোস্টাল কোড ও দেশ (Postal Code & Country)", value: `${val(profile.postalCode || profile.postal_code)} (${val(profile.country || "Bangladesh")})` },
    ],
    [
      { label: "নিবন্ধিত কার্যালয়ের ঠিকানা (Registered Address)", value: profile.address || "—", span: 2 },
    ],
  ], 2);

  // --- SECTION 2: AUTHORIZED CONTACT PERSON & NOMINEE ---
  drawSectionTitle("০২. দায়িত্বপ্রাপ্ত প্রতিনিধি ও নমিনীর বিবরণ", "Contact & Nominee Details");
  drawKeyValueGrid([
    [
      { label: "প্রতিনিধির পূর্ণ নাম (Representative Name)", value: contact.name || "—" },
      { label: "নাম বাংলায় (Name in Bengali)", value: contact.nameBn || contact.name_bn || "—" },
    ],
    [
      { label: "পদবি (Designation)", value: contact.designation || "—" },
      { label: "জাতীয় পরিচয়পত্র নম্বর (NID Number)", value: contact.nidNo || contact.nid_no || contact.nid || kyc.rawNid || kyc.raw_nid || kyc.nidNumber || kyc.nid_number || "—" },
    ],
    [
      { label: "ইমেইল (Email Address)", value: contact.email || merchant.email || merchant.user?.email || "—" },
      { label: "মোবাইল নম্বর (Phone Number)", value: contact.phone || merchant.user_phone || merchant.user?.phone || "—" },
    ],
    [
      { label: "জন্ম তারিখ (Date of Birth)", value: contact.dob ? String(contact.dob).split("T")[0] : "—" },
      { label: "লিঙ্গ ও বৈবাহিক অবস্থা (Gender & Marital Status)", value: `${val(contact.gender)} / ${val(contact.maritalStatus || contact.marital_status)}` },
    ],
    [
      { label: "পিতা ও মাতার নাম (Father & Mother Name)", value: `পিতা: ${val(contact.fatherName || contact.father_name)} | মাতা: ${val(contact.motherName || contact.mother_name)}`, span: 2 },
    ],
    [
      { label: "স্থায়ী ঠিকানা (Permanent Address)", value: contact.permanentAddress || contact.permanent_address || "—", span: 2 },
    ],
    [
      { label: "বর্তমান ঠিকানা (Present Address)", value: contact.isSameAddress || contact.is_same_address ? "স্থায়ী ঠিকানার অনুরূপ" : (contact.presentAddress || contact.present_address || "—"), span: 2 },
    ],
    [
      { label: "মনোনীত ব্যক্তির নাম (Nominee Name)", value: contact.nomineeName || contact.nominee_name || "—" },
      { label: "নমিনীর সাথে সম্পর্ক (Nominee Relation)", value: contact.nomineeRelation || contact.nominee_relation || "—" },
    ],
    [
      { label: "নমিনীর মোবাইল নম্বর (Nominee Phone)", value: contact.nomineeMobile || contact.nominee_mobile || "—" },
      { label: "নমিনীর এনআইডি (Nominee NID)", value: contact.nomineeNid || contact.nominee_nid || "—" },
    ],
  ], 2);

  // --- SECTION 3: KYC & BANKING DETAILS ---
  drawSectionTitle("০৩. গ্রাহক পরিচিতি ও ব্যাংক হিসাব বিবরণী", "KYC & Bank Account Details");
  const kycFormData = kyc.kycFormData || kyc.kyc_form_data || {};
  drawKeyValueGrid([
    [
      { label: "হিসাবের নাম (Bank Account Name / Title)", value: kyc.bankAccountName || kyc.bank_account_name || kyc.legalBusinessName || kyc.legal_business_name || kycFormData.accountTitle || "—" },
      { label: "হিসাব নম্বর (Bank Account Number)", value: kyc.rawBankAccountNumber || kyc.raw_bank_account_number || kyc.bankAccountNumber || kyc.bank_account_number || kycFormData.accountNumberDigits || "—" },
    ],
    [
      { label: "ব্যাংক ও শাখার নাম (Bank & Branch Name)", value: `${val(kyc.bankName || kyc.bank_name || "Bank")} — শাখা: ${val(kyc.branchName || kyc.branch_name || kycFormData.branchName)}` },
      { label: "রাউটিং নম্বর (Routing Number)", value: kyc.routingNumber || kyc.routing_number || kycFormData.routingNumber || "—" },
    ],
    [
      { label: "ট্রেড লাইসেন্স নম্বর (Trade License Number)", value: kyc.tradeLicenseNumber || kyc.trade_license_number || "—" },
      { label: "ই-টিন নম্বর (e-TIN Number)", value: kyc.rawTin || kyc.raw_tin || kyc.tin || kycFormData.tinNumber || "—" },
    ],
    [
      { label: "ভ্যাট / বিআইএন নম্বর (BIN / VAT Number)", value: kyc.rawBin || kyc.raw_bin || kyc.bin || kycFormData.binNumber || "—" },
      { label: "তহবিলের উৎস (Source of Funds)", value: kycFormData.sourceOfFundsDetails || "Business Revenue / সেলস রেভিনিউ" },
    ],
    [
      { label: "মাসিক আনুমানিক টার্নওভার (Estimated Monthly Volume)", value: commercial.expectedMonthlyVolume || commercial.expected_monthly_volume ? `${val(commercial.expectedMonthlyVolume || commercial.expected_monthly_volume)} BDT` : "—" },
      { label: "গড় লেনদেনের পরিমাণ (Average Ticket Size)", value: commercial.averageTicketSize || commercial.average_ticket_size ? `${val(commercial.averageTicketSize || commercial.average_ticket_size)} BDT` : "—" },
    ],
  ], 2);

  // --- SECTION 4: SUBMITTED COMPLIANCE DOCUMENTS ---
  drawSectionTitle("০৪. জমাকৃত কমপ্লায়েন্স ডকুমেন্টস", "Submitted Compliance Documents");
  if (documents && documents.length > 0) {
    const docRows = documents.map((docItem, index) => [
      { label: `#${index + 1} ডকুমেন্ট টাইপ (Document Type)`, value: (docItem.document_type || docItem.documentType || "DOCUMENT").toUpperCase().replace(/_/g, " ") },
      { label: "ফাইলের নাম ও স্ট্যাটাস (File Name & Status)", value: `${val(docItem.original_filename || docItem.document_name || "Attachment")} [${String(docItem.status || "PENDING").toUpperCase()}]` },
    ]);
    drawKeyValueGrid(docRows, 2);
  } else {
    checkPageSpace(25);
    doc.fillColor(slate500).fontSize(8.5).text("কোনো সংযুক্তি নথিপত্র নিবন্ধিত নেই (No separate documents registered).", margin + 8, doc.y);
    doc.moveDown(1);
  }

  // --- FOOTER NOTE & SIGNATURE BOXES ---
  checkPageSpace(90);
  doc.moveDown(1);
  const sigY = doc.y;

  // Authorized Bank Reviewer Box
  doc.rect(margin, sigY, 240, 50).strokeColor(slate200).stroke();
  doc.fillColor(slate500).fontSize(7.5).text("অনবোর্ডিং অফিসার / ব্যাংক কর্মকর্তা স্বাক্ষর", margin + 8, sigY + 6);
  doc.text("Approved / Verified By: ___________________", margin + 8, sigY + 34);

  // Merchant Signatory Box
  doc.rect(margin + contentWidth - 240, sigY, 240, 50).strokeColor(slate200).stroke();
  doc.fillColor(slate500).fontSize(7.5).text("মার্চেন্ট / অনুমোদিত ব্যক্তির স্বাক্ষর ও সিল", margin + contentWidth - 232, sigY + 6);
  doc.text("Signature & Date: ___________________", margin + contentWidth - 232, sigY + 34);

  // Bottom footer page numbers
  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    doc.fillColor(slate500).fontSize(7).text(
      `BanglaQR Merchant Digital Onboarding System • Generated on ${new Date().toLocaleString()} • Confidential • Page ${i + 1} of ${totalPages}`,
      margin,
      812,
      { align: "center", width: contentWidth }
    );
  }

  doc.end();
  return doc;
}

/**
 * Generate Multi-sheet Structured Excel Overview
 */
export async function generateMerchantOverviewExcel(data = {}) {
  const merchant = data?.merchant || {};
  const profile = data?.profile || {};
  const contact = data?.contact || {};
  const commercial = data?.commercial || {};
  const kyc = data?.kyc || {};
  const documents = data?.documents || [];
  const services = data?.services || [];
  const kycFormData = kyc.kycFormData || kyc.kyc_form_data || {};

  const wb = new ExcelJS.Workbook();
  wb.creator = "BanglaQR Portal";
  wb.created = new Date();

  // --- SHEET 1: Column-wise Database Record (কলাম অনুযায়ী ডেটা) ---
  const wsCol = wb.addWorksheet("Merchant Data (Columnar)", {
    views: [{ showGridLines: true }],
  });

  wsCol.columns = [
    { header: "SL", key: "sl", width: 6 },
    { header: "Merchant ID", key: "merchant_id", width: 14 },
    { header: "Merchant Code", key: "merchant_code", width: 22 },
    { header: "Account Status", key: "account_status", width: 16 },
    { header: "KYC Status", key: "kyc_status", width: 16 },
    { header: "Onboarding Step", key: "onboarding_step", width: 16 },
    { header: "Registration Date", key: "created_at", width: 20 },
    // Company Profile
    { header: "Company Name", key: "company_name", width: 28 },
    { header: "Business Entity Type", key: "business_type", width: 24 },
    { header: "Industry", key: "industry", width: 22 },
    { header: "Website", key: "website", width: 26 },
    { header: "City / District", key: "city", width: 18 },
    { header: "Division / State", key: "state", width: 18 },
    { header: "Postal Code", key: "postal_code", width: 14 },
    { header: "Country", key: "country", width: 16 },
    { header: "Registered Address", key: "registered_address", width: 35 },
    // Contact Person
    { header: "Contact Person Name", key: "contact_name", width: 26 },
    { header: "Name (Bengali)", key: "name_bn", width: 24 },
    { header: "Designation", key: "contact_designation", width: 22 },
    { header: "Contact NID No", key: "contact_nid", width: 22 },
    { header: "Contact Email", key: "email", width: 28 },
    { header: "Contact Phone", key: "phone", width: 18 },
    { header: "Date of Birth", key: "dob", width: 14 },
    { header: "Gender", key: "gender", width: 12 },
    { header: "Marital Status", key: "marital_status", width: 14 },
    { header: "Father Name", key: "father_name", width: 24 },
    { header: "Mother Name", key: "mother_name", width: 24 },
    { header: "Permanent Address", key: "permanent_address", width: 32 },
    { header: "Present Address", key: "present_address", width: 32 },
    // Nominee
    { header: "Nominee Name", key: "nominee_name", width: 24 },
    { header: "Nominee Relation", key: "nominee_relation", width: 18 },
    { header: "Nominee Mobile", key: "nominee_mobile", width: 18 },
    { header: "Nominee NID", key: "nominee_nid", width: 22 },
    // KYC & Banking
    { header: "Bank / Channel Name", key: "bank_name", width: 26 },
    { header: "Account Title", key: "bank_account_name", width: 26 },
    { header: "Account Number", key: "bank_account_number", width: 24 },
    { header: "Branch Name", key: "branch_name", width: 22 },
    { header: "Routing Number", key: "routing_number", width: 18 },
    { header: "Account Type", key: "account_type", width: 16 },
    { header: "Trade License No", key: "trade_license_number", width: 24 },
    { header: "e-TIN Number", key: "tin", width: 20 },
    { header: "BIN / VAT Number", key: "bin", width: 20 },
    { header: "Source of Funds", key: "source_of_funds", width: 24 },
    // Commercial Details
    { header: "Daily Volume", key: "volume_per_day", width: 16 },
    { header: "Monthly Volume", key: "volume_per_month", width: 16 },
    { header: "Max Ticket Size", key: "maximum_ticket_size", width: 16 },
    // Documents Count
    { header: "Uploaded Documents Count", key: "document_count", width: 24 },
  ];

  // Title Banner for Sheet 1
  wsCol.spliceRows(1, 0, []);
  wsCol.spliceRows(1, 0, []);

  wsCol.mergeCells("A1:AU1");
  const colTitleCell = wsCol.getCell("A1");
  colTitleCell.value = `BANGLAQR MERCHANT RECORD — ${val(profile.companyName || profile.company_name || merchant.business_name)} (${val(merchant.merchantCode || merchant.merchant_code)})`;
  colTitleCell.font = { name: "Arial", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
  colTitleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF065F46" } };
  colTitleCell.alignment = { horizontal: "center", vertical: "middle" };
  wsCol.getRow(1).height = 28;

  wsCol.mergeCells("A2:AU2");
  const colMetaCell = wsCol.getCell("A2");
  colMetaCell.value = `Database ID: ${val(merchant.id)} | Status: ${String(merchant.accountStatus || merchant.account_status || "PENDING").toUpperCase()} | Generated: ${new Date().toLocaleString()}`;
  colMetaCell.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF334155" } };
  colMetaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECFDF5" } };
  colMetaCell.alignment = { horizontal: "center", vertical: "middle" };
  wsCol.getRow(2).height = 18;

  // Header row styling (row 3)
  const colHeaderRow = wsCol.getRow(3);
  colHeaderRow.height = 24;
  colHeaderRow.font = { name: "Arial", size: 9.5, bold: true, color: { argb: "FFFFFFFF" } };
  colHeaderRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  colHeaderRow.alignment = { vertical: "middle", horizontal: "center" };

  // Add the single Merchant data row in columnar format
  const dataRow = wsCol.addRow({
    sl: 1,
    merchant_id: merchant.id || "—",
    merchant_code: merchant.merchantCode || merchant.merchant_code || "—",
    account_status: String(merchant.accountStatus || merchant.account_status || "").toUpperCase(),
    kyc_status: String(merchant.kycStatus || merchant.kyc_status || "").toUpperCase(),
    onboarding_step: merchant.onboardingStep || merchant.onboarding_step || 1,
    created_at: merchant.createdAt ? new Date(merchant.createdAt).toLocaleDateString() : "—",
    // Company Profile
    company_name: profile.companyName || profile.company_name || merchant.business_name || "—",
    business_type: profile.businessType || profile.business_type || kyc.businessEntityType || kyc.business_entity_type || "—",
    industry: profile.industry || "Software & Technology",
    website: profile.website || "—",
    city: profile.city || profile.district || "—",
    state: profile.state || "—",
    postal_code: profile.postalCode || profile.postal_code || "—",
    country: profile.country || "Bangladesh",
    registered_address: profile.address || "—",
    // Contact Person
    contact_name: contact.name || "—",
    name_bn: contact.nameBn || contact.name_bn || "—",
    contact_designation: contact.designation || "—",
    contact_nid: contact.nidNo || contact.nid_no || contact.nid || kyc.rawNid || kyc.raw_nid || kyc.nidNumber || kyc.nid_number || "—",
    email: contact.email || merchant.email || merchant.user?.email || "—",
    phone: contact.phone || merchant.user_phone || merchant.user?.phone || "—",
    dob: contact.dob ? String(contact.dob).split("T")[0] : "—",
    gender: contact.gender || "—",
    marital_status: contact.maritalStatus || contact.marital_status || "—",
    father_name: contact.fatherName || contact.father_name || "—",
    mother_name: contact.motherName || contact.mother_name || "—",
    permanent_address: contact.permanentAddress || contact.permanent_address || "—",
    present_address: contact.isSameAddress || contact.is_same_address ? "Same as permanent" : (contact.presentAddress || contact.present_address || "—"),
    // Nominee
    nominee_name: contact.nomineeName || contact.nominee_name || "—",
    nominee_relation: contact.nomineeRelation || contact.nominee_relation || "—",
    nominee_mobile: contact.nomineeMobile || contact.nominee_mobile || "—",
    nominee_nid: contact.nomineeNid || contact.nominee_nid || "—",
    // KYC & Banking
    bank_name: kyc.bankName || kyc.bank_name || profile.bank_name || "—",
    bank_account_name: kyc.bankAccountName || kyc.bank_account_name || kyc.legalBusinessName || kyc.legal_business_name || kycFormData.accountTitle || "—",
    bank_account_number: kyc.rawBankAccountNumber || kyc.raw_bank_account_number || kyc.bankAccountNumber || kyc.bank_account_number || kycFormData.accountNumberDigits || "—",
    branch_name: kyc.branchName || kyc.branch_name || kycFormData.branchName || "—",
    routing_number: kyc.routingNumber || kyc.routing_number || kycFormData.routingNumber || "—",
    account_type: kyc.accountType || kyc.account_type || "Current",
    trade_license_number: kyc.tradeLicenseNumber || kyc.trade_license_number || "—",
    tin: kyc.rawTin || kyc.raw_tin || kyc.tin || kycFormData.tinNumber || "—",
    bin: kyc.rawBin || kyc.raw_bin || kyc.bin || kycFormData.binNumber || "—",
    source_of_funds: kycFormData.sourceOfFundsDetails || "Business Revenue",
    // Commercial Details
    volume_per_day: commercial.volumePerDay || commercial.volume_per_day || "—",
    volume_per_month: commercial.volumePerMonth || commercial.volume_per_month || commercial.expectedMonthlyVolume || commercial.expected_monthly_volume || "—",
    maximum_ticket_size: commercial.maximumTicketSize || commercial.maximum_ticket_size || commercial.averageTicketSize || commercial.average_ticket_size || "—",
    // Document count
    document_count: documents.length || 0,
  });

  dataRow.height = 22;
  dataRow.font = { name: "Arial", size: 9.5, color: { argb: "FF0F172A" } };
  dataRow.alignment = { vertical: "middle" };
  dataRow.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
    cell.border = {
      top: { style: "thin", color: { argb: "FFE2E8F0" } },
      bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      left: { style: "thin", color: { argb: "FFE2E8F0" } },
      right: { style: "thin", color: { argb: "FFE2E8F0" } },
    };
  });

  // --- SHEET 2: Full Detailed Overview (Form View) ---
  const ws = wb.addWorksheet("Merchant Overview (Form)", {
    views: [{ showGridLines: true }],
  });

  ws.columns = [
    { width: 38 },
    { width: 55 },
    { width: 25 },
  ];

  // Header Title
  ws.mergeCells("A1:B1");
  const titleCell = ws.getCell("A1");
  titleCell.value = "BANGLAQR DIGITAL PAYMENT SERVICES — MERCHANT OVERVIEW";
  titleCell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF065F46" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;

  // Metadata Row
  ws.mergeCells("A2:B2");
  const metaCell = ws.getCell("A2");
  metaCell.value = `Merchant Code: ${val(merchant.merchantCode || merchant.merchant_code)} | Status: ${String(merchant.accountStatus || merchant.account_status || "PENDING").toUpperCase()} | Generated: ${new Date().toLocaleString()}`;
  metaCell.font = { name: "Arial", size: 9.5, italic: true, color: { argb: "FF334155" } };
  metaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECFDF5" } };
  metaCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(2).height = 20;

  let currentRow = 4;

  function addSectionHeader(title) {
    ws.mergeCells(`A${currentRow}:B${currentRow}`);
    const cell = ws.getCell(`A${currentRow}`);
    cell.value = title;
    cell.font = { name: "Arial", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    ws.getRow(currentRow).height = 24;
    currentRow++;
  }

  function addRow(field, value) {
    const fCell = ws.getCell(`A${currentRow}`);
    const vCell = ws.getCell(`B${currentRow}`);

    fCell.value = field;
    fCell.font = { name: "Arial", size: 9.5, bold: true, color: { argb: "FF475569" } };
    fCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    fCell.border = {
      top: { style: "thin", color: { argb: "FFE2E8F0" } },
      bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      left: { style: "thin", color: { argb: "FFE2E8F0" } },
      right: { style: "thin", color: { argb: "FFE2E8F0" } },
    };

    vCell.value = val(value);
    vCell.font = { name: "Arial", size: 10, color: { argb: "FF0F172A" } };
    vCell.border = {
      top: { style: "thin", color: { argb: "FFE2E8F0" } },
      bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      left: { style: "thin", color: { argb: "FFE2E8F0" } },
      right: { style: "thin", color: { argb: "FFE2E8F0" } },
    };

    ws.getRow(currentRow).height = 20;
    currentRow++;
  }

  // Section 1
  addSectionHeader("01. COMPANY PROFILE (ব্যবসায়িক প্রতিষ্ঠানের তথ্যাদি)");
  addRow("Registered Company Name (প্রতিষ্ঠানের নাম)", profile.companyName || profile.company_name || merchant.business_name);
  addRow("Business Entity Type (ব্যবসার ধরন)", profile.businessType || profile.business_type || kyc.businessEntityType || kyc.business_entity_type);
  addRow("Industry Category (শিল্পের ক্ষেত্র)", profile.industry || "Software & Technology");
  addRow("Website / Social Page", profile.website || "—");
  addRow("Division & District (বিভাগ ও জেলা)", `${val(profile.city || profile.district)}, ${val(profile.state)}`);
  addRow("Postal Code & Country", `${val(profile.postalCode || profile.postal_code)} (${val(profile.country || "Bangladesh")})`);
  addRow("Registered Address (নিবন্ধিত কার্যালয়ের ঠিকানা)", profile.address);
  currentRow++;

  // Section 2
  addSectionHeader("02. CONTACT PERSON & NOMINEE (দায়িত্বপ্রাপ্ত প্রতিনিধি ও নমিনী)");
  addRow("Authorized Person Name (পূর্ণ নাম)", contact.name);
  addRow("Name in Bengali (নাম বাংলায়)", contact.nameBn || contact.name_bn);
  addRow("Designation (পদবি)", contact.designation);
  addRow("National ID (NID No)", contact.nidNo || contact.nid_no || contact.nid || kyc.rawNid || kyc.raw_nid || kyc.nidNumber || kyc.nid_number);
  addRow("Email Address (ইমেইল)", contact.email || merchant.email || merchant.user?.email);
  addRow("Phone Number (মোবাইল নম্বর)", contact.phone || merchant.user_phone || merchant.user?.phone);
  addRow("Date of Birth (জন্ম তারিখ)", contact.dob ? String(contact.dob).split("T")[0] : "—");
  addRow("Gender & Marital Status", `${val(contact.gender)} / ${val(contact.maritalStatus || contact.marital_status)}`);
  addRow("Father & Mother Name", `Father: ${val(contact.fatherName || contact.father_name)} | Mother: ${val(contact.motherName || contact.mother_name)}`);
  addRow("Permanent Address (স্থায়ী ঠিকানা)", contact.permanentAddress || contact.permanent_address);
  addRow("Present Address (বর্তমান ঠিকানা)", contact.isSameAddress || contact.is_same_address ? "Same as permanent address" : (contact.presentAddress || contact.present_address));
  addRow("Nominee Name (মনোনীত ব্যক্তি)", contact.nomineeName || contact.nominee_name);
  addRow("Nominee Relation (সম্পর্ক)", contact.nomineeRelation || contact.nominee_relation);
  addRow("Nominee Mobile (মোবাইল)", contact.nomineeMobile || contact.nominee_mobile);
  addRow("Nominee NID (জাতীয় পরিচয়পত্র)", contact.nomineeNid || contact.nominee_nid);
  currentRow++;

  // Section 3
  addSectionHeader("03. KYC & BANKING (গ্রাহক পরিচিতি ও ব্যাংক হিসাব)");
  addRow("Bank Account Title (হিসাবের নাম)", kyc.bankAccountName || kyc.bank_account_name || kyc.legalBusinessName || kyc.legal_business_name || kycFormData.accountTitle);
  addRow("Bank Account Number (হিসাব নম্বর)", kyc.rawBankAccountNumber || kyc.raw_bank_account_number || kyc.bankAccountNumber || kyc.bank_account_number || kycFormData.accountNumberDigits);
  addRow("Bank & Branch (ব্যাংক ও শাখা)", `${val(kyc.bankName || kyc.bank_name || "Bank")} — Branch: ${val(kyc.branchName || kyc.branch_name || kycFormData.branchName)}`);
  addRow("Routing Number (রাউটিং নম্বর)", kyc.routingNumber || kyc.routing_number || kycFormData.routingNumber);
  addRow("Trade License Number (ট্রেড লাইসেন্স)", kyc.tradeLicenseNumber || kyc.trade_license_number);
  addRow("e-TIN Number (ই-টিন নম্বর)", kyc.rawTin || kyc.raw_tin || kyc.tin || kycFormData.tinNumber);
  addRow("BIN / VAT Number (ভ্যাট নম্বর)", kyc.rawBin || kyc.raw_bin || kyc.bin || kycFormData.binNumber);
  addRow("Source of Funds (তহবিলের উৎস)", kycFormData.sourceOfFundsDetails || "Business Revenue");
  addRow("Expected Monthly Volume (সম্ভাব্য টার্নওভার)", commercial.expectedMonthlyVolume || commercial.expected_monthly_volume ? `${val(commercial.expectedMonthlyVolume || commercial.expected_monthly_volume)} BDT` : "—");
  addRow("Average Ticket Size (গড় লেনদেন)", commercial.averageTicketSize || commercial.average_ticket_size ? `${val(commercial.averageTicketSize || commercial.average_ticket_size)} BDT` : "—");
  currentRow++;

  // Section 4: Documents Tabular List
  addSectionHeader("04. COMPLIANCE DOCUMENTS (সংযুক্তি ডকুমেন্টস)");
  if (documents && documents.length > 0) {
    documents.forEach((d, idx) => {
      addRow(`#${idx + 1} ${(d.document_type || d.documentType || "DOCUMENT").toUpperCase()}`, `${val(d.original_filename || d.document_name)} [Status: ${val(d.status)}]`);
    });
  } else {
    addRow("Documents Registered", "No separate document files uploaded");
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

/**
 * Generate Structured Excel for Institution Dashboard Report
 */
export async function generateAllMerchantsExcel(merchants = []) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BanglaQR Admin Portal";
  wb.created = new Date();

  const ws = wb.addWorksheet("All Merchants", {
    views: [{ showGridLines: true }],
  });

  // Define Columns
  ws.columns = [
    { header: "SL", key: "sl", width: 6 },
    { header: "Merchant Code", key: "merchant_code", width: 22 },
    { header: "Company Name", key: "company_name", width: 28 },
    { header: "Business Entity Type", key: "business_type", width: 22 },
    { header: "Industry", key: "industry", width: 22 },
    { header: "Contact Person", key: "contact_name", width: 24 },
    { header: "Designation", key: "contact_designation", width: 20 },
    { header: "Email Address", key: "email", width: 28 },
    { header: "Phone Number", key: "phone", width: 16 },
    { header: "Account Status", key: "account_status", width: 16 },
    { header: "KYC Status", key: "kyc_status", width: 16 },
    { header: "Bank / MFS Channel", key: "bank_name", width: 24 },
    { header: "Account Name", key: "bank_account_name", width: 24 },
    { header: "Account Number", key: "bank_account_number", width: 22 },
    { header: "Branch Name", key: "branch_name", width: 20 },
    { header: "Trade License No", key: "trade_license_number", width: 24 },
    { header: "e-TIN No", key: "tin", width: 20 },
    { header: "BIN / VAT", key: "bin", width: 18 },
    { header: "Documents Count", key: "document_count", width: 16 },
    { header: "Registration Date", key: "created_at", width: 20 },
    { header: "Registered Address", key: "registered_address", width: 35 },
  ];

  // Title Banner
  ws.spliceRows(1, 0, []);
  ws.spliceRows(1, 0, []);

  ws.mergeCells("A1:U1");
  const titleCell = ws.getCell("A1");
  titleCell.value = "BANGLAQR DIGITAL PAYMENT SERVICES — ALL MERCHANTS DIRECTORY";
  titleCell.font = { name: "Arial", size: 13, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF065F46" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 28;

  ws.mergeCells("A2:U2");
  const metaCell = ws.getCell("A2");
  metaCell.value = `Exported Records: ${merchants.length} | Export Date: ${new Date().toLocaleString()} | Official Admin Management Report`;
  metaCell.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF334155" } };
  metaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECFDF5" } };
  metaCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(2).height = 18;

  // Header row styling (row 3)
  const headerRow = ws.getRow(3);
  headerRow.height = 24;
  headerRow.font = { name: "Arial", size: 9.5, bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  // Add Data Rows
  merchants.forEach((m, idx) => {
    const row = ws.addRow({
      sl: idx + 1,
      merchant_code: m.merchant_code || "—",
      company_name: m.company_name || "—",
      business_type: m.business_type || "—",
      industry: m.industry || "—",
      contact_name: m.contact_name || "—",
      contact_designation: m.contact_designation || "—",
      email: m.email || "—",
      phone: m.phone || "—",
      account_status: String(m.account_status || "").toUpperCase(),
      kyc_status: String(m.kyc_status || "").toUpperCase(),
      bank_name: m.bank_name || "—",
      bank_account_name: m.bank_account_name || "—",
      bank_account_number: m.bank_account_number || "—",
      branch_name: m.branch_name || "—",
      trade_license_number: m.trade_license_number || "—",
      tin: m.tin || "—",
      bin: m.bin || "—",
      document_count: Number(m.document_count || 0),
      created_at: m.created_at ? new Date(m.created_at).toLocaleDateString() : "—",
      registered_address: m.registered_address || "—",
    });

    row.height = 20;
    row.font = { name: "Arial", size: 9, color: { argb: "FF0F172A" } };
    row.alignment = { vertical: "middle" };

    // Alternate row zebra striping
    const isEven = idx % 2 === 0;
    const bgColor = isEven ? "FFFFFFFF" : "FFF8FAFC";
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}

/**
 * Generate Structured Excel for Institution Dashboard Report
 */
export async function generateInstitutionDashboardExcel(stats = {}, institutionName = "Bank / Institution") {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BanglaQR Portal";
  wb.created = new Date();

  // --- SHEET 1: Summary Overview ---
  const wsSummary = wb.addWorksheet("Dashboard Summary", {
    views: [{ showGridLines: true }],
  });

  wsSummary.columns = [
    { header: "Metric / Indicator", key: "metric", width: 35 },
    { header: "Count / Value", key: "value", width: 20 },
    { header: "Notes / Description", key: "notes", width: 45 },
  ];

  // Title Banner
  wsSummary.spliceRows(1, 0, []);
  wsSummary.spliceRows(1, 0, []);

  wsSummary.mergeCells("A1:C1");
  const titleCell = wsSummary.getCell("A1");
  titleCell.value = `${institutionName.toUpperCase()} — EXECUTIVE DASHBOARD PERFORMANCE REPORT`;
  titleCell.font = { name: "Arial", size: 12, bold: true, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF065F46" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  wsSummary.getRow(1).height = 28;

  wsSummary.mergeCells("A2:C2");
  const metaCell = wsSummary.getCell("A2");
  metaCell.value = `Export Date: ${new Date().toLocaleString()} | Official BanglaQR Banking Partner Report`;
  metaCell.font = { name: "Arial", size: 9, italic: true, color: { argb: "FF334155" } };
  metaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFECFDF5" } };
  metaCell.alignment = { horizontal: "center", vertical: "middle" };
  wsSummary.getRow(2).height = 18;

  // Header
  const headerRow = wsSummary.getRow(3);
  headerRow.height = 22;
  headerRow.font = { name: "Arial", size: 9.5, bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  const summaryItems = [
    { metric: "Total Merchant Applications", value: Number(stats?.applications?.total || 0), notes: "All applications received by this institution" },
    { metric: "Pending Review Queue", value: Number(stats?.applications?.pending || 0), notes: "Applications waiting for officer initial review" },
    { metric: "Under Compliance Review", value: Number(stats?.applications?.underReview || 0), notes: "Applications actively under evaluation" },
    { metric: "Approved Applications", value: Number(stats?.applications?.approved || 0), notes: "Officially approved and active merchant partners" },
    { metric: "Rejected Applications", value: Number(stats?.applications?.rejected || 0), notes: "Declined or ineligible merchant applications" },
    { metric: "Additional Info / Corrections Required", value: Number(stats?.applications?.correctionRequired || stats?.applications?.additionalInfo || 0), notes: "Returned to merchant for document/data corrections" },
    { metric: "Active BanglaQR Merchants", value: Number(stats?.activeMerchants || 0), notes: "Merchants provisioned with operational QR services" },
    { metric: "Total Institution Branches", value: Number(stats?.branches?.total || 0), notes: "Configured physical branch and sub-branch locations" },
    { metric: "Active Branch Offices", value: Number(stats?.branches?.active || 0), notes: "Branches currently servicing merchant onboarding" },
    { metric: "Active Digital Payment Services", value: Number(stats?.services?.active || 0), notes: "Online payment rails / settlement services" },
    { metric: "Enrolled Bank Staff Officers", value: Number(stats?.staffCount || 0), notes: "Authorized officers with portal review credentials" },
  ];

  summaryItems.forEach((item, idx) => {
    const row = wsSummary.addRow(item);
    row.height = 20;
    row.font = { name: "Arial", size: 9, color: { argb: "FF0F172A" } };
    const bgColor = idx % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC";
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    });
  });

  // --- SHEET 2: Recent Activities ---
  if (Array.isArray(stats?.recentActivities) && stats.recentActivities.length > 0) {
    const wsAct = wb.addWorksheet("Recent Activities", {
      views: [{ showGridLines: true }],
    });

    wsAct.columns = [
      { header: "SL", key: "sl", width: 8 },
      { header: "Action", key: "action", width: 30 },
      { header: "User / Officer", key: "userEmail", width: 30 },
      { header: "Status Transition", key: "statusTransition", width: 25 },
      { header: "Date & Time", key: "createdAt", width: 22 },
    ];

    wsAct.getRow(1).height = 24;
    wsAct.getRow(1).font = { name: "Arial", size: 9.5, bold: true, color: { argb: "FFFFFFFF" } };
    wsAct.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };

    stats.recentActivities.forEach((act, idx) => {
      const row = wsAct.addRow({
        sl: idx + 1,
        action: act.action || "Activity",
        userEmail: act.userEmail || "System",
        statusTransition: act.statusTransition || "—",
        createdAt: act.createdAt ? new Date(act.createdAt).toLocaleString() : "—",
      });
      row.height = 19;
      row.font = { name: "Arial", size: 9 };
      const bgColor = idx % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC";
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      });
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return buffer;
}


