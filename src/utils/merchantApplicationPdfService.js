import PDFDocument from "pdfkit";
import { PDFDocument as PDFLibDoc } from "pdf-lib";
import path from "path";
import fs from "fs";
import { secureStorage } from "../config/storage.js";

/**
 * Helper to resolve asset paths reliably regardless of current working directory
 */
function resolveAssetPath(...segments) {
  const p1 = path.resolve(process.cwd(), ...segments);
  if (fs.existsSync(p1)) return p1;
  const p2 = path.resolve(process.cwd(), "server", ...segments);
  if (fs.existsSync(p2)) return p2;
  const p3 = path.resolve(process.cwd(), "..", ...segments);
  if (fs.existsSync(p3)) return p3;
  return null;
}

/**
 * Resolve Bengali-capable font (Kalpurush)
 */
function getBengaliFontPath() {
  const localFont = resolveAssetPath("assets", "fonts", "kalpurush.ttf");
  if (localFont) return localFont;
  const winFont = "C:/Windows/Fonts/kalpurush.ttf";
  if (fs.existsSync(winFont)) return winFont;
  return null;
}

/**
 * Safe string formatting
 */
function val(v) {
  if (v === null || v === undefined || v === "") return "—";
  return String(v).trim();
}

/**
 * Resolve institution / bank logo file path on server
 */
function resolveBankLogoPath(bankName, institution) {
  // 0. If institution has a uploaded logo_url in storage, prioritize it first (matching Review screen)
  if (institution?.logo_url) {
    const rawUrl = String(institution.logo_url);
    if (rawUrl.startsWith("/uploads/cms/")) {
      const filename = rawUrl.replace("/uploads/cms/", "");
      const p = resolveAssetPath("storage", "public_cms", filename);
      if (p && fs.existsSync(p)) return p;
    } else if (rawUrl.startsWith("/uploads/institutions/")) {
      const filename = rawUrl.replace("/uploads/institutions/", "");
      const p = resolveAssetPath("public", "uploads", "institutions", filename);
      if (p && fs.existsSync(p)) return p;
    }
  }

  const clean = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const bClean = clean(bankName).replace(/^the/, "").replace(/(plc|ltd|limited|bank|limitedcompany)$/g, "");
  const cClean = clean(institution?.institution_code || institution?.code || "");
  
  const bankLogoDir = resolveAssetPath("assets", "BankLogo");
  if (!bankLogoDir || !fs.existsSync(bankLogoDir)) return null;

  // Only allow formats supported natively by PDFKit: PNG and JPEG
  const files = fs.readdirSync(bankLogoDir).filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return ext === ".png" || ext === ".jpg" || ext === ".jpeg";
  });

  // 1. Common bank name special cases
  const lowerName = (bankName || "").toLowerCase();
  if (lowerName.includes("city")) {
    const city = files.find((f) => f.toLowerCase() === "citibank.png" || f.toLowerCase() === "citybank.png");
    if (city) return path.join(bankLogoDir, city);
  }
  if (lowerName.includes("brac")) {
    const brac = files.find((f) => f.toLowerCase().includes("brac"));
    if (brac) return path.join(bankLogoDir, brac);
  }
  if (lowerName.includes("dhaka")) {
    const dhaka = files.find((f) => f.toLowerCase().includes("dhaka"));
    if (dhaka) return path.join(bankLogoDir, dhaka);
  }
  if (lowerName.includes("eastern") || lowerName.includes("ebl")) {
    const ebl = files.find((f) => f.toLowerCase().includes("ebl"));
    if (ebl) return path.join(bankLogoDir, ebl);
  }

  // 2. Check code match
  if (cClean) {
    const match = files.find((f) => clean(f).includes(cClean));
    if (match) return path.join(bankLogoDir, match);
  }

  // 3. Check bank name keyword match
  if (bClean) {
    const match = files.find((f) => {
      const fClean = clean(f);
      return fClean.includes(bClean) || bClean.includes(fClean.replace(/bank/g, ""));
    });
    if (match) return path.join(bankLogoDir, match);
  }

  return null;
}

/**
 * Safely resolve on-disk file path for an uploaded merchant document
 */
function getDocumentDiskPath(doc, merchantId) {
  if (!doc || !doc.storageKey) return null;
  try {
    const p = secureStorage.getFilePath(doc.storageKey, merchantId);
    if (fs.existsSync(p)) return p;
  } catch (err) {
    // ignore
  }
  return null;
}

/**
 * Generate 7-Page Native Searchable Merchant Application PDF
 *
 * @param {Object} data - Complete merchant application dataset
 * @param {Object} options - Options { includeDocuments: boolean }
 * @returns {Promise<Buffer>} - Final Native PDF Buffer
 */
export async function generateMerchantApplicationPdf(data = {}, options = {}) {
  const includeDocuments = options.includeDocuments !== undefined ? Boolean(options.includeDocuments) : true;
  const merchant = data.merchant || {};
  let profile = { ...(data.profile || {}) };
  const contact = data.contact || {};
  const commercial = data.commercial || {};
  let kyc = { ...(data.kyc || {}) };
  const documents = data.documents || [];
  let institution = data.institution ? { ...data.institution } : null;
  const merchantId = merchant.id || merchant.merchantId;
  const applications = data.applications || [];

  if (options.institutionId && applications.length > 0) {
    const targetApp = applications.find(
      (a) => Number(a.institutionId || a.institution_id) === Number(options.institutionId)
    );
    if (targetApp) {
      const snap = targetApp.submittedDataSnapshot || targetApp.submitted_data_snapshot || {};
      institution = {
        id: targetApp.institutionId || targetApp.institution_id || institution?.id,
        name: targetApp.institutionName || targetApp.institution_name || snap.institutionName || snap.bankName || institution?.name,
        institution_code: targetApp.institutionCode || targetApp.institution_code || institution?.institution_code,
        institution_type: targetApp.institutionType || targetApp.institution_type || snap.institutionType || institution?.institution_type,
        logo_url: targetApp.logoUrl || targetApp.logo_url || snap.logoUrl || institution?.logo_url,
      };

      if (snap.bankName || snap.institutionName) {
        kyc.bankName = snap.bankName || snap.institutionName;
        profile.bankName = snap.bankName || snap.institutionName;
      }
      if (snap.branchName) {
        kyc.branchName = snap.branchName;
        profile.branchName = snap.branchName;
      }
      if (snap.accountNumber) {
        kyc.accountNumber = snap.accountNumber;
        kyc.bankAccountNumber = snap.accountNumber;
        kyc.rawBankAccountNumber = snap.accountNumber;
      }
      if (snap.routingNumber) {
        kyc.routingNumber = snap.routingNumber;
        profile.routingNumber = snap.routingNumber;
      }
      if (snap.accountName) {
        kyc.bankAccountName = snap.accountName;
        kyc.accountHolderName = snap.accountName;
      }
      if (snap.accountType) {
        kyc.accountType = snap.accountType;
      }
      if (snap.channel) {
        profile.channel = snap.channel;
        kyc.channel = snap.channel;
      }
    }
  }

  // Custom values mapping
  const customValues = Array.isArray(data.customValues)
    ? data.customValues.reduce((acc, cv) => {
        if (cv.fieldKey) acc[cv.fieldKey] = cv.fieldValue;
        return acc;
      }, {})
    : data.customValues || {};

  // Resolved dynamic field values
  const companyNameBn = customValues.company_name_bn || profile.companyNameBn || "—";
  const companyNameEn = profile.companyName || customValues.company_name || "—";
  const cityState = [profile.city, profile.state, profile.postalCode].filter(Boolean).join(", ");
  const rawAddress = profile.address || customValues.address || "";
  const registeredAddress = rawAddress ? (cityState ? `${rawAddress}, ${cityState}` : rawAddress) : (cityState || "—");
  const website = profile.website || customValues.website || "";
  const businessRegPhone = customValues.business_reg_phone || contact.phone || "—";
  const contactMobile = customValues.contact_mobile || contact.phone || "—";
  const businessType = profile.businessType || customValues.business_type || "—";
  const businessNature = customValues.business_nature || profile.industry || "—";
  const tradeLicense = kyc.tradeLicenseNumber || kyc.trade_license_number || customValues.trade_license || "—";
  const businessStartYear = customValues.business_start_year || "—";
  const businessTin = kyc.rawTin || kyc.tin || customValues.business_tin || "—";
  const businessEmail = customValues.business_email || contact.email || "—";
  const binVatNumber = kyc.rawBin || kyc.bin || customValues.bin_vat_number || "—";

  const ownerNameEn = contact.name || kyc.authorizedPersonName || kyc.authorized_person_name || "—";
  const ownerNameBn = contact.nameBn || contact.name_bn || "";
  const ownerMobile = contact.phone || "—";
  const ownerNid = contact.nidNo || contact.nid_no || kyc.rawNid || kyc.nidNumber || kyc.nid_number || "—";
  const ownerEmail = contact.email || "—";
  const fatherName = contact.fatherName || contact.father_name || "—";
  const motherName = contact.motherName || contact.mother_name || "—";
  const gender = contact.gender || "—";
  const maritalStatus = contact.maritalStatus || contact.marital_status || "—";
  const spouseName = contact.spouseName || contact.spouse_name || "";
  const dob = contact.dob ? String(contact.dob).split("T")[0] : "—";
  const presentAddress = contact.presentAddress || contact.present_address || registeredAddress;
  const permanentAddress = contact.permanentAddress || contact.permanent_address || registeredAddress;

  const nomineeName = contact.nomineeName || contact.nominee_name || "—";
  const nomineeRelation = contact.nomineeRelation || contact.nominee_relation || "—";
  const nomineeMobile = contact.nomineeMobile || contact.nominee_mobile || "—";
  const nomineeNid = contact.nomineeNid || contact.nominee_nid || "—";

  const bankName = kyc.bankName || kyc.bank_name || profile.bankName || profile.bank_name || institution?.name || "—";
  const branchName = kyc.branchName || kyc.branch_name || profile.branchName || profile.branch_name || "—";
  const accountHolderName = kyc.accountHolderName || kyc.bankAccountName || kyc.bank_account_name || kyc.authorizedPersonName || ownerNameEn;
  const accountNumber = kyc.accountNumber || kyc.rawBankAccountNumber || kyc.bankAccountNumber || kyc.bank_account_number || "—";
  const kycFormData = kyc.kycFormData || kyc.kyc_form_data || {};
  const rawAccountType = kyc.accountType || kyc.account_type || "Current";
  const otherAccountType = kycFormData.otherAccountType || kyc.otherAccountType || "";
  const accountType = rawAccountType === "Other" && otherAccountType ? `অন্যান্য (${otherAccountType})` : rawAccountType;
  const routingNumber = kyc.routingNumber || kyc.routing_number || profile.routingNumber || profile.routing_number || "—";
  const rawCustomerProfession = kycFormData.customerProfession || "Business";
  const customerProfessionDetail = kycFormData.customerProfessionDetail || "";
  const customerProfession = customerProfessionDetail
    ? `${rawCustomerProfession === "Business" ? "ব্যবসা" : rawCustomerProfession === "Service" ? "চাকরি" : "অন্যান্য"} (${customerProfessionDetail})`
    : rawCustomerProfession === "Business" ? "ব্যবসা (Business)" : rawCustomerProfession === "Service" ? "চাকরি (Service)" : rawCustomerProfession;
  const sourceOfFundsDetails = kycFormData.sourceOfFundsDetails || "ব্যবসায়িক বিক্রয়লব্ধ আয়";
  const monthlyEstimatedIncome = kycFormData.monthlyEstimatedIncome ? `৳ ${Number(kycFormData.monthlyEstimatedIncome).toLocaleString()}` : "—";
  const yearlyEstimatedIncome = kycFormData.yearlyEstimatedIncome ? `৳ ${Number(kycFormData.yearlyEstimatedIncome).toLocaleString()}` : "—";

  const txnsPerDay = commercial.transactionsPerDay ?? commercial.transactions_per_day ?? kyc.transactionsPerDay ?? "—";
  const txnsPerMonth = commercial.transactionsPerMonth ?? commercial.transactions_per_month ?? kyc.transactionsPerMonth ?? "—";
  const volumePerDay = commercial.volumePerDay ?? commercial.volume_per_day ?? kyc.volumePerDay;
  const volumePerMonth = commercial.volumePerMonth ?? commercial.volume_per_month ?? kyc.volumePerMonth;
  const maxTicketSize = commercial.maximumTicketSize ?? commercial.maximum_ticket_size ?? kyc.maximumTicketSize;

  const formattedVolumePerDay = volumePerDay !== undefined && volumePerDay !== null ? `৳ ${Number(volumePerDay).toLocaleString()}` : "—";
  const formattedVolumePerMonth = volumePerMonth !== undefined && volumePerMonth !== null ? `৳ ${Number(volumePerMonth).toLocaleString()}` : "—";
  const formattedMaxTicketSize = maxTicketSize !== undefined && maxTicketSize !== null ? `৳ ${Number(maxTicketSize).toLocaleString()}` : "—";

  const settlementContactName = kycFormData.settlementContactName || ownerNameEn;
  const settlementContactEmail = kycFormData.settlementContactEmail || ownerEmail;
  const settlementContactMobile = kycFormData.settlementContactPhone || ownerMobile;

  const merchantCode = merchant.merchantCode || merchant.merchant_code || (merchantId ? `BQR-M-${merchantId}` : "—");

  // Merchant Segment (Micro vs Big)
  const rawSegment = (merchant.merchantSegment || merchant.merchant_segment || "").toLowerCase();
  const bType = String(profile.businessType || profile.business_type || kyc.businessEntityType || kyc.business_entity_type || "").toLowerCase();
  const isMicro = rawSegment ? rawSegment === "micro" : (bType.includes("micro") || bType.includes("sole") || bType.includes("pra"));
  const segmentText = isMicro ? "মাইক্রো মার্চেন্ট (Micro Merchant)" : "বিগ মার্চেন্ট (Big Merchant)";

  // Channel determination: Bank vs MFS
  const rawChannel = String(profile.channel || kyc.channel || merchant.channel || customValues.channel || "").toLowerCase();
  const rawInstType = String(institution?.institution_type || institution?.type || "").toLowerCase();
  const isMfsChannel =
    rawChannel === "mfs" ||
    rawInstType.includes("mfs") ||
    rawInstType.includes("mobile") ||
    String(kyc.bankName || profile.bankName || institution?.name || "").toLowerCase().includes("bkash") ||
    String(kyc.bankName || profile.bankName || institution?.name || "").toLowerCase().includes("nagad") ||
    String(kyc.bankName || profile.bankName || institution?.name || "").toLowerCase().includes("rocket") ||
    String(kyc.bankName || profile.bankName || institution?.name || "").toLowerCase().includes("upay") ||
    String(kyc.bankName || profile.bankName || institution?.name || "").toLowerCase().includes("mfs");

  // Document attachments lookup
  const findDoc = (type) => documents.find((d) => (d.documentType || d.document_type) === type);
  const passportPhotoDoc = findDoc("PASSPORT_PHOTO");
  const nomineePhotoDoc = findDoc("NOMINEE_PHOTO");
  const nidFrontDoc = findDoc("NID_FRONT");
  const nidBackDoc = findDoc("NID_BACK");
  const merchantSigDoc = findDoc("MERCHANT_SIGNATURE");
  const utilityBillDoc = findDoc("UTILITY_BILL");
  const nomineeNidDoc = findDoc("NOMINEE_NID");
  const nomineeSigDoc = findDoc("NOMINEE_SIGNATURE");
  const tinCertDoc = findDoc("TIN_CERTIFICATE");
  const bankStatementDoc = findDoc("BANK_STATEMENT");

  // Disk paths
  const passportPhotoPath = getDocumentDiskPath(passportPhotoDoc, merchantId);
  const nomineePhotoPath = getDocumentDiskPath(nomineePhotoDoc, merchantId);
  const nidFrontPath = getDocumentDiskPath(nidFrontDoc, merchantId);
  const nidBackPath = getDocumentDiskPath(nidBackDoc, merchantId);
  const merchantSigPath = getDocumentDiskPath(merchantSigDoc, merchantId);
  const utilityBillPath = getDocumentDiskPath(utilityBillDoc, merchantId);
  const nomineeNidPath = getDocumentDiskPath(nomineeNidDoc, merchantId);
  const nomineeSigPath = getDocumentDiskPath(nomineeSigDoc, merchantId);
  const tinCertPath = getDocumentDiskPath(tinCertDoc, merchantId);
  const bankStatementPath = getDocumentDiskPath(bankStatementDoc, merchantId);

  // Asset paths
  const banglaQrLogoPath = resolveAssetPath("assets", "images", "logo.png");
  const bankLogoPath = resolveBankLogoPath(bankName, institution);
  const fontPath = getBengaliFontPath();

  // Create PDFKit document
  const doc = new PDFDocument({
    size: "A4",
    margin: 20,
    bufferPages: true,
    autoFirstPage: true,
  });

  if (fontPath) {
    doc.registerFont("Kalpurush", fontPath);
    doc.font("Kalpurush");
  } else {
    doc.font("Helvetica");
  }

  const chunks = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 20;
  const contentWidth = pageWidth - margin * 2; // 555.28 pt

  // Color Palette
  const primaryGreen = "#065f46";     // Header banner
  const lightGreenBg = "#d1fae5";     // Section title bg
  const darkGreenText = "#064e3b";    // Section title text
  const tableHeaderBg = "#f8fafc";    // Label cell bg
  const borderColor = "#94a3b8";      // Table borders
  const textDark = "#0f172a";         // Main value text
  const textMuted = "#64748b";        // English sublabel text

  // Helper: Draw Section Banner
  function drawSectionHeader(titleBn, titleEn, extraRightText = "", customBg = null, customTextColor = null) {
    const y = doc.y;
    const bg = customBg || lightGreenBg;
    const textCol = customTextColor || darkGreenText;
    doc.rect(margin, y, contentWidth, 18).fillAndStroke(bg, borderColor);
    doc.fillColor(textCol).fontSize(9.5).text(titleBn + (titleEn ? ` (${titleEn})` : ""), margin + 6, y + 4, {
      width: contentWidth - (extraRightText ? 160 : 12),
      lineBreak: false,
    });
    if (extraRightText) {
      doc.fillColor(textMuted).fontSize(8).text(extraRightText, margin + contentWidth - 150, y + 5, {
        width: 144,
        align: "right",
      });
    }
    doc.y = y + 18;
  }

  // Helper: Draw 2-column or 4-column structured table row
  function drawTableRow(cells, rowHeight = 24) {
    const y = doc.y;
    let currentX = margin;

    cells.forEach((cell) => {
      const cellW = (cell.colSpan || 1) * (contentWidth / 4);

      // Cell background and border
      if (cell.isHeader) {
        doc.rect(currentX, y, cellW, rowHeight).fillAndStroke(tableHeaderBg, borderColor);
      } else {
        doc.rect(currentX, y, cellW, rowHeight).fillAndStroke("#ffffff", borderColor);
      }

      // Cell text
      if (cell.isHeader) {
        doc.fillColor(textDark).fontSize(8).text(cell.labelBn || "", currentX + 4, y + (rowHeight <= 21 ? 2.5 : 3), {
          width: cellW - 8,
          lineBreak: false,
        });
        if (cell.labelEn) {
          doc.fillColor(textMuted).fontSize(6.5).text(`(${cell.labelEn})`, currentX + 4, y + (rowHeight <= 21 ? 11.5 : 13), {
            width: cellW - 8,
            lineBreak: false,
          });
        }
      } else {
        doc.fillColor(textDark).fontSize(cell.fontSize || 8).text(val(cell.value), currentX + 5, y + (cell.topOffset !== undefined ? cell.topOffset : (rowHeight <= 21 ? 5.5 : 7)), {
          width: cellW - 10,
          ellipsis: cell.ellipsis !== undefined ? cell.ellipsis : true,
          lineGap: cell.lineGap || 0,
        });
      }

      currentX += cellW;
    });

    doc.y = y + rowHeight;
  }

  // Helper: Top Header for Page 1
  function drawPage1Header() {
    const headerY = margin;

    // 1. Center: BanglaQR Logo (Top-Center)
    const bqrLogoW = 34;
    const bqrLogoX = margin + (contentWidth - bqrLogoW) / 2;
    if (fs.existsSync(banglaQrLogoPath)) {
      doc.image(banglaQrLogoPath, bqrLogoX, headerY, { width: bqrLogoW, height: 30, fit: [bqrLogoW, 30] });
    }

    // Row 1 Title (Center aligned with Bank/Settlement Logo on left)
    doc.fillColor(primaryGreen).fontSize(12).text("বাংলা কিউআর মার্চেন্ট অনবোর্ডিং", margin, headerY + 31, {
      width: contentWidth,
      align: "center",
    });

    // Row 2 Subtitle (Center)
    const subtitleY = headerY + 45;
    doc.fillColor(textMuted).fontSize(7.5).text("Bangla QR Merchant Digital Payment Application", margin, subtitleY, {
      width: contentWidth,
      align: "center",
    });

    // 2. Left: Bank / Settlement Logo & Merchant Segment Label
    const rawSegment = (merchant.merchantSegment || merchant.merchant_segment || "").toLowerCase();
    const bType = String(profile.businessType || profile.business_type || kyc.businessEntityType || kyc.business_entity_type || "").toLowerCase();
    const isMicro = rawSegment ? rawSegment === "micro" : (bType.includes("micro") || bType.includes("sole") || bType.includes("pra"));
    const segmentText = isMicro ? "মাইক্রো মার্চেন্ট (Micro Merchant)" : "বিগ মার্চেন্ট (Big Merchant)";

    // Settlement Logo directly aligned with "বাংলা কিউআর মার্চেন্ট অনবোর্ডিং" (hY + 28, lowered down to remove gap with Micro Merchant)
    if (bankLogoPath && fs.existsSync(bankLogoPath)) {
      doc.image(bankLogoPath, margin, headerY + 28, { fit: [120, 15] });
    } else {
      doc.rect(margin, headerY + 28, 100, 15).strokeColor(borderColor).stroke();
      doc.fillColor(primaryGreen).fontSize(7.5).text(bankName, margin + 2, headerY + 31, {
        width: 96,
        align: "center",
      });
    }

    // Merchant Segment Label on the same horizontal line as "Bangla QR Merchant Digital Payment Application"
    doc.fillColor("#047857").fontSize(7.5).text(segmentText, margin, subtitleY, {
      width: 170,
      align: "left",
    });

    // 3. Right: Applicant Photo (Slightly higher up so green line below has full width clearance)
    const photoW = 56;
    const photoH = 64;
    const photoX = margin + contentWidth - photoW;
    const photoY = headerY;

    doc.rect(photoX, photoY, photoW, photoH).strokeColor(borderColor).lineWidth(0.8).stroke();

    if (passportPhotoPath && fs.existsSync(passportPhotoPath)) {
      doc.image(passportPhotoPath, photoX + 2, photoY + 2, {
        fit: [photoW - 4, photoH - 4],
        align: "center",
        valign: "center",
      });
    } else {
      doc.fillColor(textMuted).fontSize(7).text("আবেদনকারীর ছবি\n(Applicant Photo)", photoX + 2, photoY + 22, {
        width: photoW - 4,
        align: "center",
      });
    }

    // Full-width Green Divider Line under entire Header (placed below photo so it runs full width)
    const dividerY = headerY + 68;
    doc.moveTo(margin, dividerY).lineTo(margin + contentWidth, dividerY).strokeColor(primaryGreen).lineWidth(1.2).stroke();

    // Banner: MERCHANT ACCOUNT OPENING FORM
    const bannerY = dividerY + 4;
    doc.rect(margin, bannerY, contentWidth, 18).fillAndStroke(primaryGreen, primaryGreen);
    doc.fillColor("#ffffff").fontSize(9.5).text("মার্চেন্ট একাউন্ট খোলার আবেদন ফরম (MERCHANT ACCOUNT OPENING FORM)", margin, bannerY + 4, {
      width: contentWidth,
      align: "center",
    });

    // Sub-instruction
    doc.fillColor(textMuted).fontSize(6.5).text("*সকল তথ্য ইংরেজিতে পূরণ করতে হবে এবং প্রযোজ্য ক্ষেত্রে বাংলায় পূরণ করতে হবে (All information must be filled in English and, where applicable, in Bangla.)", margin, bannerY + 21, {
      width: contentWidth,
      align: "center",
    });

    doc.y = bannerY + 31;
  }

  // =========================================================================
  // PAGE 1: Merchant Account Opening Form, Profile, Owner, Nominee
  // =========================================================================
  drawPage1Header();

  // SECTION 1: Company Profile
  drawSectionHeader("০১. ব্যবসায়িক প্রতিষ্ঠানের সাধারণ তথ্যাদি", "Company Profile", `কোড: ${merchantCode}`);
  
  drawTableRow([
    { isHeader: true, labelBn: "প্রতিষ্ঠানের নাম (বাংলায়)", labelEn: "Merchant/Company Name (Bengali)" },
    { value: companyNameBn, colSpan: 3 },
  ]);
  drawTableRow([
    { isHeader: true, labelBn: "প্রতিষ্ঠানের নাম (ইংরেজি)*", labelEn: "Merchant/Company Name (English)" },
    { value: companyNameEn, colSpan: 3 },
  ]);
  drawTableRow([
    { isHeader: true, labelBn: "প্রতিষ্ঠানের বর্তমান ঠিকানা*", labelEn: "Merchant/Company Registered Address" },
    { value: registeredAddress, colSpan: 3 },
  ]);
  drawTableRow([
    { isHeader: true, labelBn: "ব্যবসা নিবন্ধনের ফোন নাম্বার*", labelEn: "Business Registration Phone No." },
    { value: businessRegPhone },
    { isHeader: true, labelBn: "যোগাযোগ মোবাইল নাম্বার*", labelEn: "Contact Mobile Number" },
    { value: contactMobile },
  ]);
  drawTableRow([
    { isHeader: true, labelBn: "প্রতিষ্ঠানের ধরণ*", labelEn: "Company Type" },
    { value: `☑ ${businessType || "ক্ষুদ্র ব্যবসায়ী (PRA Merchant)"}`, colSpan: 3 },
  ]);
  drawTableRow([
    { isHeader: true, labelBn: "ব্যবসার প্রকৃতি*", labelEn: "Merchant Business Type" },
    { value: businessNature },
    { isHeader: true, labelBn: "ট্রেড লাইসেন্স", labelEn: "Trade License" },
    { value: tradeLicense },
  ]);
  drawTableRow([
    { isHeader: true, labelBn: "ব্যবসা শুরুর বছর*", labelEn: "Business Starting Year" },
    { value: businessStartYear },
    { isHeader: true, labelBn: "ব্যবসায়িক টিন*", labelEn: "Business TIN" },
    { value: businessTin },
  ]);
  drawTableRow([
    { isHeader: true, labelBn: "ব্যবসার ইমেইল", labelEn: "Business Email Address" },
    { value: businessEmail },
    { isHeader: true, labelBn: "ভ্যাট নিবন্ধন নম্বর (যদি থাকে)", labelEn: "BIN / VAT Registration Number" },
    { value: binVatNumber },
  ]);
  if (website) {
    drawTableRow([
      { isHeader: true, labelBn: "ওয়েবসাইট / সোশ্যাল পেজ", labelEn: "Website / Social Page" },
      { value: website, colSpan: 3 },
    ]);
  }

  doc.y += 6;

  // SECTION 2: Owner / Contact Person Information
  drawSectionHeader("০২. আবেদনকারী ব্যক্তির তথ্য", "Owner / Contact Person Information");

  const formattedOwnerName = ownerNameBn ? `${ownerNameEn} (${ownerNameBn})` : ownerNameEn;
  drawTableRow([
    { isHeader: true, labelBn: "নাম*", labelEn: "Name" },
    { value: formattedOwnerName, colSpan: 3 },
  ]);
  drawTableRow([
    { isHeader: true, labelBn: "মোবাইল নম্বর*", labelEn: "Mobile Number" },
    { value: ownerMobile },
    { isHeader: true, labelBn: "জাতীয় পরিচয়পত্র নম্বর*", labelEn: "National ID Number" },
    { value: ownerNid },
  ]);
  drawTableRow([
    { isHeader: true, labelBn: "ইমেইল", labelEn: "Email Address" },
    { value: ownerEmail },
    { isHeader: true, labelBn: "জন্ম তারিখ*", labelEn: "Date of Birth (YYYY-MM-DD)" },
    { value: dob },
  ]);
  drawTableRow([
    { isHeader: true, labelBn: "পিতার নাম*", labelEn: "Father's Name" },
    { value: fatherName },
    { isHeader: true, labelBn: "মাতার নাম*", labelEn: "Mother's Name" },
    { value: motherName },
  ]);
  
  drawTableRow([
    { isHeader: true, labelBn: "লিঙ্গ*", labelEn: "Gender" },
    { value: gender },
    { isHeader: true, labelBn: "বৈবাহিক অবস্থা*", labelEn: "Marital Status" },
    { value: maritalStatus },
  ]);

  if (maritalStatus === "Married" && spouseName) {
    drawTableRow([
      { isHeader: true, labelBn: "স্বামী / স্ত্রীর নাম*", labelEn: "Spouse Name" },
      { value: spouseName, colSpan: 3 },
    ]);
  }

  drawTableRow([
    { isHeader: true, labelBn: "বর্তমান ঠিকানা*", labelEn: "Present Address with Postal Code" },
    { value: presentAddress, colSpan: 3 },
  ]);
  drawTableRow([
    { isHeader: true, labelBn: "স্থায়ী ঠিকানা*", labelEn: "Permanent Address with Postal Code" },
    { value: permanentAddress, colSpan: 3 },
  ]);

  doc.y += 6;

  // SECTION 3: Nominee Information (Strictly on Page 1, balanced 4-column layout)
  drawSectionHeader("০৩. নমিনীর তথ্যাদি", "Nominee Information");

  drawTableRow([
    { isHeader: true, labelBn: "নমিনীর নাম*", labelEn: "Nominee Name" },
    { value: nomineeName },
    { isHeader: true, labelBn: "সম্পর্ক*", labelEn: "Relationship" },
    { value: nomineeRelation },
  ]);
  drawTableRow([
    { isHeader: true, labelBn: "মোবাইল নাম্বার*", labelEn: "Mobile Number" },
    { value: nomineeMobile },
    { isHeader: true, labelBn: "অংশীদারিত্ব হার (%)", labelEn: "Share Percentage" },
    { value: "100%" },
  ]);
  drawTableRow([
    { isHeader: true, labelBn: "জাতীয় পরিচয়পত্র নম্বর*", labelEn: "NID Number" },
    { value: nomineeNid, colSpan: 3 },
  ]);

  // =========================================================================
  // PAGE 2: KYC Form & Banking Information, Affirmation & Signatures
  // =========================================================================
  doc.addPage();

  // Helper for Unified Page Headers (Pages 2 to 7)
  function drawUnifiedPageHeader(titleBn, titleEn, pageNum) {
    const hY = margin;

    // 1. Center: BanglaQR Brand Logo on top, followed by Title & Subtitle with Page Number
    const bqrLogoW = 34;
    const bqrLogoX = margin + (contentWidth - bqrLogoW) / 2;
    if (fs.existsSync(banglaQrLogoPath)) {
      doc.image(banglaQrLogoPath, bqrLogoX, hY, { width: bqrLogoW, height: 30, fit: [bqrLogoW, 30] });
    }

    // Row 1 (Center): Title
    doc.fillColor(primaryGreen).fontSize(10.5).text(titleBn, margin, hY + 31, {
      width: contentWidth,
      align: "center",
    });

    // Row 2 (Center): Subtitle with Page Number
    const subtitleY = hY + 45;
    doc.fillColor(textMuted).fontSize(7.5).text(
      `Bangla QR Merchant Digital Payment Application (Page ${pageNum})`,
      margin,
      subtitleY,
      {
        width: contentWidth,
        align: "center",
      }
    );

    // 2. Left: Settlement / Bank Logo aligned directly with Title (Row 1), and Segment Text aligned horizontally with Subtitle (Row 2)
    if (bankLogoPath && fs.existsSync(bankLogoPath)) {
      doc.image(bankLogoPath, margin, hY + 28, { fit: [120, 15] });
    } else {
      doc.rect(margin, hY + 28, 100, 15).strokeColor(borderColor).stroke();
      doc.fillColor(primaryGreen).fontSize(7.5).text(bankName, margin + 2, hY + 31, {
        width: 96,
        align: "center",
      });
    }

    // Merchant Segment Label on the same line as "Bangla QR Merchant Digital Payment Application"
    doc.fillColor("#047857").fontSize(7.5).text(segmentText, margin, subtitleY, {
      width: 170,
      align: "left",
    });

    // 3. Right: Company Name aligned horizontally with Title (Row 1), Code aligned horizontally with Subtitle (Row 2)
    doc.fillColor(textDark).fontSize(9).text(companyNameEn, margin + contentWidth - 170, hY + 31, { width: 170, align: "right" });
    doc.fillColor(textMuted).fontSize(7.5).text(`কোড: ${merchantCode}`, margin + contentWidth - 170, subtitleY, { width: 170, align: "right" });

    // Page Divider Line
    const dividerY = hY + 62;
    doc.moveTo(margin, dividerY).lineTo(margin + contentWidth, dividerY).strokeColor(primaryGreen).lineWidth(1.5).stroke();
    doc.y = dividerY + 6;
  }

  // Draw Page 2 Header
  drawUnifiedPageHeader("গ্রাহক পরিচিতি (KYC Profile)", "Bangla QR Merchant Digital Payment Application", 2);

  // SECTION 4: Customer / KYC Information (Compact 21pt row height)
  drawSectionHeader("০৪. গ্রাহক পরিচিতি", "KYC Profile");

  drawTableRow([
    {
      isHeader: true,
      labelBn: isMfsChannel ? "ওয়ালেট গ্রাহকের নাম *" : "হিসাবের শিরোনাম (নাম) *",
      labelEn: isMfsChannel ? "Wallet Holder Name" : "Account Title / Holder Name",
    },
    { value: accountHolderName },
    {
      isHeader: true,
      labelBn: isMfsChannel ? "ওয়ালেটের ধরন" : "হিসাবের ধরন",
      labelEn: isMfsChannel ? "Wallet Type" : "Account Type",
    },
    { value: accountType },
  ], 21);
  drawTableRow([
    { isHeader: true, labelBn: "গ্রাহকের পেশা", labelEn: "Customer Profession" },
    { value: customerProfession },
    { isHeader: true, labelBn: "তহবিলের উৎস", labelEn: "Source of Funds" },
    { value: sourceOfFundsDetails },
  ], 21);

  // SECTION 5: Transaction Information
  doc.y += 6;
  drawSectionHeader("০৫. লেনদেনের তথ্য", "Transaction Information");

  drawTableRow([
    { isHeader: true, labelBn: "মাসিক সম্ভাব্য আয়", labelEn: "Estimated Monthly Income" },
    { value: monthlyEstimatedIncome },
    { isHeader: true, labelBn: "বার্ষিক সম্ভাব্য আয়", labelEn: "Estimated Yearly Income" },
    { value: yearlyEstimatedIncome },
  ], 21);
  drawTableRow([
    { isHeader: true, labelBn: "দৈনিক লেনদেনের সংখ্যা", labelEn: "Transactions Per Day" },
    { value: txnsPerDay },
    { isHeader: true, labelBn: "মাসিক লেনদেনের সংখ্যা", labelEn: "Transactions Per Month" },
    { value: txnsPerMonth },
  ], 21);
  drawTableRow([
    { isHeader: true, labelBn: "দৈনিক লেনদেনের ভলিউম", labelEn: "Transaction Volume Per Day" },
    { value: formattedVolumePerDay },
    { isHeader: true, labelBn: "মাসিক লেনদেনের ভলিউম", labelEn: "Transaction Volume Per Month" },
    { value: formattedVolumePerMonth },
  ], 21);
  drawTableRow([
    { isHeader: true, labelBn: "একক সর্বোচ্চ লেনদেনের পরিমাণ", labelEn: "Maximum Single Transaction Amount" },
    { value: formattedMaxTicketSize },
    { isHeader: true, labelBn: "ইউনিক কাস্টমার আইডি", labelEn: "Unique Customer ID" },
    { value: kycFormData.uniqueCustomerId || "—" },
  ], 21);

  // SECTION 6: Settlement / Transaction Point of Contact's Information
  doc.y += 6;
  drawSectionHeader(
    "০৬. নিষ্পত্তি / লেনদেনের যোগাযোগের তথ্য",
    "Settlement / Transaction Point of Contact's Information"
  );
  drawTableRow([
    { isHeader: true, labelBn: "যোগাযোগ ব্যক্তির নাম", labelEn: "Contact Person's Name" },
    { value: settlementContactName, colSpan: 3 },
  ], 21);
  drawTableRow([
    { isHeader: true, labelBn: "ই-মেইল", labelEn: "E-mail" },
    { value: settlementContactEmail },
    { isHeader: true, labelBn: "মোবাইল নম্বর", labelEn: "Mobile Number" },
    { value: settlementContactMobile },
  ], 21);

  // SECTION 7: Bank or MFS Information
  doc.y += 6;
  if (isMfsChannel) {
    drawSectionHeader("০৭. এমএফএস ওয়ালেটের তথ্য", "MFS Wallet Information");

    drawTableRow([
      { isHeader: true, labelBn: "এমএফএস প্রোভাইডার *", labelEn: "MFS Provider" },
      { value: bankName },
      { isHeader: true, labelBn: "ওয়ালেটের ধরন *", labelEn: "Wallet Type" },
      { value: accountType },
    ], 21);
    drawTableRow([
      { isHeader: true, labelBn: "ওয়ালেট গ্রাহকের নাম *", labelEn: "Wallet Holder Name" },
      { value: accountHolderName },
      { isHeader: true, labelBn: "ওয়ালেট নম্বর *", labelEn: "Wallet Number" },
      { value: accountNumber },
    ], 21);
    drawTableRow([
      { isHeader: true, labelBn: "মার্চেন্ট একাউন্ট আইডি (ঐচ্ছিক)", labelEn: "Merchant Account ID" },
      { value: kycFormData.uniqueCustomerId || merchantCode, colSpan: 3 },
    ], 21);
    drawTableRow([
      {
        value: "*** উক্ত এমএফএস ওয়ালেটে আপনার সাথে সকল আর্থিক লেনদেন নিষ্পত্তি করা হবে।\n(All financial transactions with you will be settled through the said MFS wallet account.)",
        colSpan: 4,
        fontSize: 7.5,
        topOffset: 4,
        ellipsis: false,
        lineGap: 1.5,
      },
    ], 28);
  } else {
    drawSectionHeader("০৭. ব্যাংকের তথ্য", "Bank Information");

    drawTableRow([
      { isHeader: true, labelBn: "ব্যাংক একাউন্ট নাম *", labelEn: "Bank Account Name" },
      { value: accountHolderName, colSpan: 3 },
    ], 21);
    drawTableRow([
      { isHeader: true, labelBn: "ব্যাংকের নাম *", labelEn: "Bank Name" },
      { value: bankName },
      { isHeader: true, labelBn: "ব্রাঞ্চের নাম", labelEn: "Branch Name" },
      { value: branchName },
    ], 21);
    drawTableRow([
      { isHeader: true, labelBn: "একাউন্ট নম্বর *", labelEn: "Account Number" },
      { value: accountNumber },
      { isHeader: true, labelBn: "ব্যাংক রাউটিং নম্বর *", labelEn: "Bank Routing Number" },
      { value: routingNumber },
    ], 21);
    drawTableRow([
      {
        value: "*** উক্ত ব্যাংক অ্যাকাউন্টে আপনার সাথে সকল আর্থিক লেনদেন নিষ্পত্তি করা হবে।\n(All financial transactions with you will be settled through the said bank account.)",
        colSpan: 4,
        fontSize: 7.5,
        topOffset: 4,
        ellipsis: false,
        lineGap: 1.5,
      },
    ], 28);
  }

  // Affirmation & 3-Column Signature Block (Naturally aligned below Section 07)
  doc.y += 18;
  const sigDividerY = doc.y;

  doc.moveTo(margin, sigDividerY).lineTo(margin + contentWidth, sigDividerY).strokeColor(borderColor).lineWidth(0.8).stroke();

  doc.fillColor(textDark).fontSize(8.5).text("আমি এই মর্মে নিশ্চয়তা প্রদান করছি যে, এই ফরমে আমার প্রদত্ত যাবতীয় তথ্যাদি সত্য, নির্ভুল ও বৈধ।", margin, sigDividerY + 8, {
    width: contentWidth,
    align: "left",
  });

  const sigColW = contentWidth / 3;
  const sigLineY = sigDividerY + 54;

  // 1. Applicant Name
  doc.moveTo(margin + 12, sigLineY).lineTo(margin + sigColW - 12, sigLineY).strokeColor(textDark).lineWidth(1.2).stroke();
  doc.fillColor(textDark).fontSize(9).text(ownerNameEn, margin + 12, sigLineY - 14, {
    width: sigColW - 24,
    align: "center",
  });
  doc.fillColor(textDark).fontSize(8).text("আবেদনকারীর নাম (Applicant's Name)", margin + 12, sigLineY + 5, {
    width: sigColW - 24,
    align: "center",
  });

  // 2. Applicant Signature
  doc.moveTo(margin + sigColW + 12, sigLineY).lineTo(margin + sigColW * 2 - 12, sigLineY).strokeColor(textDark).lineWidth(1.2).stroke();
  if (merchantSigPath && fs.existsSync(merchantSigPath)) {
    doc.image(merchantSigPath, margin + sigColW + 16, sigLineY - 30, {
      fit: [sigColW - 32, 26],
      align: "center",
      valign: "center",
    });
  } else {
    doc.fillColor(textMuted).fontSize(8).text("স্বাক্ষরিত", margin + sigColW + 12, sigLineY - 14, {
      width: sigColW - 24,
      align: "center",
    });
  }
  doc.fillColor(textDark).fontSize(8).text("স্বাক্ষর (Applicant's Signature)", margin + sigColW + 12, sigLineY + 5, {
    width: sigColW - 24,
    align: "center",
  });

  // 3. Date
  const currentDate = new Date().toISOString().split("T")[0];
  doc.moveTo(margin + sigColW * 2 + 12, sigLineY).lineTo(margin + contentWidth - 12, sigLineY).strokeColor(textDark).lineWidth(1.2).stroke();
  doc.fillColor(textDark).fontSize(9).text(currentDate, margin + sigColW * 2 + 12, sigLineY - 14, {
    width: sigColW - 24,
    align: "center",
  });
  doc.fillColor(textDark).fontSize(8).text("তারিখ (Date)", margin + sigColW * 2 + 12, sigLineY + 5, {
    width: sigColW - 24,
    align: "center",
  });

  // =========================================================================
  // DOCUMENT PAGES (Pages 3 to 7)
  // =========================================================================
  if (includeDocuments) {
    // =========================================================================
    // PAGE 3: Applicant Identity & NID Documents (Vertically Stacked / niche niche)
    // =========================================================================
    doc.addPage();
    drawUnifiedPageHeader(
      "আবেদনকারীর পরিচিতি ও জাতীয় পরিচয়পত্র",
      "Applicant Identity & National ID Documents",
      3
    );

    const nidCardH = 260;

    // 1. Front NID Box (Top, full width)
    const frontNidY = doc.y + 4;
    doc.rect(margin, frontNidY, contentWidth, nidCardH).fillAndStroke("#ffffff", borderColor);
    doc.fillColor(primaryGreen).fontSize(8.5).text("জাতীয় পরিচয়পত্র (সামনের পাতা / Front)", margin + 8, frontNidY + 7);
    doc.moveTo(margin, frontNidY + 20).lineTo(margin + contentWidth, frontNidY + 20).strokeColor(borderColor).lineWidth(0.5).stroke();

    if (nidFrontPath && fs.existsSync(nidFrontPath)) {
      doc.image(nidFrontPath, margin + 8, frontNidY + 24, {
        fit: [contentWidth - 16, nidCardH - 30],
        align: "center",
        valign: "center",
      });
    } else {
      doc.fillColor(textMuted).fontSize(8).text("নথি সংযুক্ত নেই (Document Not Attached)", margin + 8, frontNidY + 120, {
        width: contentWidth - 16,
        align: "center",
      });
    }

    // 2. Back NID Box (Bottom, full width, niche)
    const backNidY = frontNidY + nidCardH + 12;
    doc.rect(margin, backNidY, contentWidth, nidCardH).fillAndStroke("#ffffff", borderColor);
    doc.fillColor(primaryGreen).fontSize(8.5).text("জাতীয় পরিচয়পত্র (পেছনের পাতা / Back)", margin + 8, backNidY + 7);
    doc.moveTo(margin, backNidY + 20).lineTo(margin + contentWidth, backNidY + 20).strokeColor(borderColor).lineWidth(0.5).stroke();

    if (nidBackPath && fs.existsSync(nidBackPath)) {
      doc.image(nidBackPath, margin + 8, backNidY + 24, {
        fit: [contentWidth - 16, nidCardH - 30],
        align: "center",
        valign: "center",
      });
    } else {
      doc.fillColor(textMuted).fontSize(8).text("নথি সংযুক্ত নেই (Document Not Attached)", margin + 8, backNidY + 120, {
        width: contentWidth - 16,
        align: "center",
      });
    }

    // 3. Specimen Signature Box below Back NID
    const specY = backNidY + nidCardH + 12;
    const specH = 80;
    doc.rect(margin, specY, contentWidth, specH).fillAndStroke("#ffffff", borderColor);
    doc.fillColor(primaryGreen).fontSize(8.5).text("আবেদনকারীর নমুনা স্বাক্ষর রেকর্ড (Applicant Specimen Signature)", margin + 8, specY + 7);
    doc.moveTo(margin, specY + 20).lineTo(margin + contentWidth, specY + 20).strokeColor(borderColor).lineWidth(0.5).stroke();

    if (merchantSigPath && fs.existsSync(merchantSigPath)) {
      doc.image(merchantSigPath, margin + 20, specY + 24, {
        fit: [contentWidth - 40, specH - 30],
        align: "center",
        valign: "center",
      });
    } else {
      doc.fillColor(textMuted).fontSize(8).text("স্বাক্ষরিত (Signed)", margin + 8, specY + 40, {
        width: contentWidth - 16,
        align: "center",
      });
    }

    // =========================================================================
    // PAGE 4: Nominee Verification Documents (Vertically Stacked / niche niche)
    // =========================================================================
    doc.addPage();
    drawUnifiedPageHeader(
      "নমিনীর পরিচিতি ও প্রমাণপত্র",
      "Nominee Verification Documents & Identity Record",
      4
    );

    // 1. Nominee National ID Document (Top)
    const nomNidY = doc.y + 4;
    const nomNidH = 250;
    doc.rect(margin, nomNidY, contentWidth, nomNidH).fillAndStroke("#ffffff", borderColor);
    doc.fillColor(primaryGreen).fontSize(8.5).text("নমিনীর জাতীয় পরিচয়পত্র (Nominee National ID Document)", margin + 8, nomNidY + 7);
    doc.moveTo(margin, nomNidY + 20).lineTo(margin + contentWidth, nomNidY + 20).strokeColor(borderColor).lineWidth(0.5).stroke();

    if (nomineeNidPath && fs.existsSync(nomineeNidPath)) {
      doc.image(nomineeNidPath, margin + 8, nomNidY + 24, {
        fit: [contentWidth - 16, nomNidH - 30],
        align: "center",
        valign: "center",
      });
    } else {
      doc.fillColor(textMuted).fontSize(8).text("নথি সংযুক্ত নেই (Document Not Attached)", margin + 8, nomNidY + 115, {
        width: contentWidth - 16,
        align: "center",
      });
    }

    // 2. Nominee Photo (Centered below NID)
    const nomPhotoY = nomNidY + nomNidH + 12;
    const nomPhotoH = 150;
    doc.rect(margin, nomPhotoY, contentWidth, nomPhotoH).fillAndStroke("#ffffff", borderColor);
    doc.fillColor(primaryGreen).fontSize(8.5).text("নমিনীর ছবি (Nominee Photograph)", margin + 8, nomPhotoY + 7);
    doc.moveTo(margin, nomPhotoY + 20).lineTo(margin + contentWidth, nomPhotoY + 20).strokeColor(borderColor).lineWidth(0.5).stroke();

    if (nomineePhotoPath && fs.existsSync(nomineePhotoPath)) {
      doc.image(nomineePhotoPath, margin + 8, nomPhotoY + 24, {
        fit: [contentWidth - 16, nomPhotoH - 30],
        align: "center",
        valign: "center",
      });
    } else {
      doc.fillColor(textMuted).fontSize(8).text("ছবি সংযুক্ত নেই (Photograph Not Attached)", margin + 8, nomPhotoY + 65, {
        width: contentWidth - 16,
        align: "center",
      });
    }

    // 3. Nominee Signature (Centered below Photo)
    const nomSigY = nomPhotoY + nomPhotoH + 12;
    const nomSigH = 85;
    doc.rect(margin, nomSigY, contentWidth, nomSigH).fillAndStroke("#ffffff", borderColor);
    doc.fillColor(primaryGreen).fontSize(8.5).text("নমিনীর স্বাক্ষর (Nominee Signature)", margin + 8, nomSigY + 7);
    doc.moveTo(margin, nomSigY + 20).lineTo(margin + contentWidth, nomSigY + 20).strokeColor(borderColor).lineWidth(0.5).stroke();

    if (nomineeSigPath && fs.existsSync(nomineeSigPath)) {
      doc.image(nomineeSigPath, margin + 8, nomSigY + 24, {
        fit: [contentWidth - 16, nomSigH - 30],
        align: "center",
        valign: "center",
      });
    } else {
      doc.fillColor(textMuted).fontSize(8).text("স্বাক্ষরিত (Signed)", margin + 8, nomSigY + 45, {
        width: contentWidth - 16,
        align: "center",
      });
    }

    // Helper for Full-Page Supporting Documents (Page 5: Utility, Page 6: TIN, Page 7: Cheque)
    // Renders the submitted document cleanly, full-page, without nested layers or redundant boxes
    function drawSingleDocumentPage(docObj, docPath, titleBn, titleEn, pageNum) {
      doc.addPage();
      drawUnifiedPageHeader(titleBn, titleEn, pageNum);
      const contentY = doc.y + 12;
      const availableH = pageHeight - contentY - margin - 15; // ~700 pt

      const isPdf = docObj?.mimeType?.includes("pdf") || (docObj?.originalFilename || "").toLowerCase().endsWith(".pdf");

      if (docPath && fs.existsSync(docPath)) {
        if (isPdf) {
          doc.rect(margin, contentY, contentWidth, availableH).strokeColor(borderColor).stroke();
          doc.fillColor(primaryGreen).fontSize(12).text("📄 মূল PDF ফাইল সংযুক্ত রয়েছে", margin + 10, contentY + availableH / 2 - 20, {
            width: contentWidth - 20,
            align: "center",
          });
          doc.fillColor(textMuted).fontSize(9).text(`ফাইলের নাম: ${docObj?.originalFilename || "document.pdf"}`, margin + 10, contentY + availableH / 2 + 5, {
            width: contentWidth - 20,
            align: "center",
          });
        } else {
          // Display the document cleanly and directly on the page, exactly as submitted
          doc.image(docPath, margin, contentY, {
            fit: [contentWidth, availableH],
            align: "center",
            valign: "center",
          });
        }
      } else {
        doc.rect(margin, contentY, contentWidth, availableH).strokeColor(borderColor).stroke();
        doc.fillColor(textMuted).fontSize(9).text("নথি সংযুক্ত নেই (Document Not Attached)", margin + 10, contentY + availableH / 2, {
          width: contentWidth - 20,
          align: "center",
        });
      }
    }

    // =========================================================================
    // PAGE 5: Utility Bill Copy
    // =========================================================================
    drawSingleDocumentPage(
      utilityBillDoc,
      utilityBillPath,
      "ইউটিলিটি বিলের কপি",
      "Utility Bill Copy (Electricity / Water / Gas / Internet)",
      5
    );

    // =========================================================================
    // PAGE 6: e-TIN Certificate
    // =========================================================================
    drawSingleDocumentPage(
      tinCertDoc,
      tinCertPath,
      "টি আই এন সার্টিফিকেট",
      "Taxpayer Identification Number (e-TIN) Certificate Copy",
      6
    );

    // =========================================================================
    // PAGE 7: Cancelled Bank Cheque Copy
    // =========================================================================
    const isBankStatementPdf = bankStatementDoc?.mimeType?.includes("pdf") || (bankStatementDoc?.originalFilename || "").toLowerCase().endsWith(".pdf");

    if (!isBankStatementPdf) {
      drawSingleDocumentPage(
        bankStatementDoc,
        bankStatementPath,
        "ক্যানসেল ব্যাংক চেক ছবি",
        "Cancelled Bank Cheque Leaf / Verified Bank Statement",
        7
      );
    }
  }

  // Finalize PDFKit document
  doc.end();
  await new Promise((resolve) => doc.on("end", resolve));
  const pdfKitBuffer = Buffer.concat(chunks);

  const isBankStatementPdf = bankStatementDoc?.mimeType?.includes("pdf") || (bankStatementDoc?.originalFilename || "").toLowerCase().endsWith(".pdf");

  // If Bank Statement was an uploaded PDF, seamlessly append/embed its original native pages using pdf-lib
  if (includeDocuments && isBankStatementPdf && bankStatementPath && fs.existsSync(bankStatementPath)) {
    try {
      const mergedPdf = await PDFLibDoc.load(pdfKitBuffer);
      const uploadedBytes = fs.readFileSync(bankStatementPath);
      const uploadedPdf = await PDFLibDoc.load(uploadedBytes);

      const copiedPages = await mergedPdf.copyPages(uploadedPdf, uploadedPdf.getPageIndices());
      copiedPages.forEach((page) => mergedPdf.addPage(page));

      const finalMergedBytes = await mergedPdf.save();
      return Buffer.from(finalMergedBytes);
    } catch (err) {
      console.error("Failed to append native bank statement PDF with pdf-lib, falling back to PDFKit buffer:", err);
      return pdfKitBuffer;
    }
  }

  return pdfKitBuffer;
}
