import express from "express";
import { cmsController } from "../admin/cms/cms.controller.js";
import { db } from "../../config/db.js";

const router = express.Router();

// Simple in-memory cache to prevent accidental double-submits within 10 seconds
const recentSubmissions = new Map();

function cleanOldSubmissions() {
  const now = Date.now();
  for (const [key, timestamp] of recentSubmissions.entries()) {
    if (now - timestamp > 30000) {
      recentSubmissions.delete(key);
    }
  }
}

import { publicMarketplaceRepository } from "./public.marketplace.module.js";

// 1. Public CMS endpoints
router.get("/cms/homepage", cmsController.getPublicHomepage);

// 1b. Public Marketplace endpoints
router.get("/marketplace/services", async (req, res, next) => {
  try {
    const { category, search } = req.query;
    const services = await publicMarketplaceRepository.listServices({ category, search });
    res.json({
      success: true,
      count: services.length,
      data: services,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/marketplace/services/:id", async (req, res, next) => {
  try {
    const service = await publicMarketplaceRepository.getServiceDetails(req.params.id);
    if (!service) {
      return res.status(404).json({
        success: false,
        message: "Marketplace service not found or not published.",
      });
    }
    res.json({
      success: true,
      data: service,
    });
  } catch (err) {
    next(err);
  }
});

// 2. Public Contact / Demo Request Handler
const handleContactSubmission = async (req, res, next) => {
  try {
    cleanOldSubmissions();

    const body = req.body || {};
    const fullName = (body.fullName || body.name || "").trim();
    const phone = (body.phone || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const companyName = (body.companyName || body.company || "").trim();
    const serviceName = (body.service || body.serviceName || "BanglaQR Payment Gateway").trim();
    const serviceId = body.serviceId ? String(body.serviceId).trim() : null;
    const message = (body.message || "").trim();

    // Validation
    if (!fullName || fullName.length < 2) {
      return res.status(400).json({
        success: false,
        message: "অনুগ্রহ করে আপনার পূর্ণ নাম লিখুন (কমপক্ষে ২ অক্ষর)।",
      });
    }

    if (!phone || phone.length < 6 || phone.length > 30) {
      return res.status(400).json({
        success: false,
        message: "অনুগ্রহ করে একটি সঠিক মোবাইল নম্বর দিন।",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "অনুগ্রহ করে একটি সঠিক ইমেইল ঠিকানা দিন।",
      });
    }

    if (!message || message.length < 2) {
      return res.status(400).json({
        success: false,
        message: "অনুগ্রহ করে আপনার বার্তা লিখুন।",
      });
    }

    if (message.length > 3000) {
      return res.status(400).json({
        success: false,
        message: "বার্তা সর্বোচ্চ ৩০০০ অক্ষরের মধ্যে হতে হবে।",
      });
    }

    // Rate-limit / idempotency check for instant repeated double-clicks
    const clientIp = req.ip || req.headers["x-forwarded-for"] || "127.0.0.1";
    const dedupeKey = `${clientIp}_${phone}_${email}`;
    const lastSubmitTime = recentSubmissions.get(dedupeKey);

    if (lastSubmitTime && Date.now() - lastSubmitTime < 5000) {
      return res.status(429).json({
        success: false,
        message: "অনুগ্রহ করে কয়েক সেকেন্ড অপেক্ষা করে পুনরায় চেষ্টা করুন।",
      });
    }

    // Validate service against published CMS if active list is present
    try {
      const [cmsRows] = await db.query(
        "SELECT published_content FROM cms_homepage WHERE page_slug = 'homepage' LIMIT 1"
      );
      if (cmsRows.length > 0 && cmsRows[0].published_content) {
        const published = typeof cmsRows[0].published_content === "string"
          ? JSON.parse(cmsRows[0].published_content)
          : cmsRows[0].published_content;

        const cmsServices = published?.contact?.services;
        if (Array.isArray(cmsServices) && cmsServices.length > 0) {
          // If CMS services are structured objects with isActive flag, verify it is not inactive
          const matched = cmsServices.find((s) => {
            if (typeof s === "string") return s.toLowerCase() === serviceName.toLowerCase();
            return (s.name && s.name.toLowerCase() === serviceName.toLowerCase()) || (s.id && s.id === serviceId);
          });

          if (matched && typeof matched === "object" && matched.isActive === false) {
            return res.status(400).json({
              success: false,
              message: "নির্বাচিত সেবাটি বর্তমানে বন্ধ রয়েছে। অনুগ্রহ করে অন্য সেবা নির্বাচন করুন।",
            });
          }
        }
      }
    } catch (e) {
      // Continue if CMS inspection fails non-critically
    }

    // Record submission timestamp in dedupe cache
    recentSubmissions.set(dedupeKey, Date.now());

    // Generate unique inquiry reference
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const inquiryReference = `INQ-${todayStr}-${randSuffix}`;

    // Insert Inquiry into MySQL
    const [inquiryRes] = await db.execute(
      `
        INSERT INTO contact_inquiries (
          full_name, phone, email, company_name, inquiry_reference,
          service_id, service_name, message, status, ip_address, user_agent, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, NOW())
      `,
      [
        fullName,
        phone,
        email,
        companyName || null,
        inquiryReference,
        serviceId,
        serviceName,
        message,
        String(clientIp).slice(0, 45),
        (req.headers["user-agent"] || "").slice(0, 500),
      ]
    );

    const inquiryId = inquiryRes.insertId;

    // Create real Admin Notification in MySQL
    try {
      const notifTitle = "নতুন যোগাযোগের অনুরোধ";
      const compLabel = companyName ? ` (${companyName})` : "";
      const notifMessage = `${fullName}${compLabel} "${serviceName}" সম্পর্কে যোগাযোগের অনুরোধ পাঠিয়েছেন। রেফারেন্স: ${inquiryReference}`;
      const notifLink = `/admin/contact-inquiries?id=${inquiryId}`;

      await db.execute(
        `
          INSERT INTO notifications (recipient_type, title, message, type, link, is_read, created_at)
          VALUES ('admin', ?, ?, 'contact_inquiry', ?, 0, NOW())
        `,
        [notifTitle, notifMessage, notifLink]
      );
    } catch (notifErr) {
      console.error("[Notification Creation Error]:", notifErr.message);
    }

    // Optional Audit Log entry
    try {
      await db.execute(
        `
          INSERT INTO audit_logs (user_id, admin_email, action, resource_type, resource_id, details, ip_address, created_at)
          VALUES (NULL, 'system@banglaqr.com', 'contact_inquiry_received', 'contact_inquiries', ?, ?, ?, NOW())
        `,
        [
          String(inquiryId),
          JSON.stringify({ inquiryReference, fullName, phone, email, companyName, serviceName }),
          String(clientIp).slice(0, 45),
        ]
      );
    } catch (auditErr) {
      // Non-blocking
    }

    return res.status(201).json({
      success: true,
      message: `আপনার অনুরোধটি সফলভাবে গৃহীত হয়েছে। রেফারেন্স নম্বর: ${inquiryReference}। BanglaQR টিম শিগগিরই আপনার সঙ্গে যোগাযোগ করবে।`,
      data: {
        inquiryId,
        inquiryReference,
      },
    });
  } catch (err) {
    next(err);
  }
};

// Mount on both /contact and /contact-inquiries
router.post("/contact", handleContactSubmission);
router.post("/contact-inquiries", handleContactSubmission);

export default router;
