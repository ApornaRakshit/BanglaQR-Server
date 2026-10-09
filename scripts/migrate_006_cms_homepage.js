import { db } from "../src/config/db.js";

export const initialCmsHomepageData = {
  navbar: {
    brandName: "BanglaQR",
    logo: "", // default uses logoImg if empty
    language: "বাংলা",
    loginButtonText: "লগইন",
    loginButtonUrl: "/login",
    ctaButtonText: "মার্চেন্ট অ্যাকাউন্ট খুলুন",
    ctaButtonUrl: "/register",
    menuItems: [
      { id: "nav-1", label: "হোম", href: "#home", isActive: true, order: 1 },
      { id: "nav-2", label: "সেবা সমূহ", href: "#services", isActive: true, order: 2 },
      { id: "nav-3", label: "ব্যবসায়ী", href: "#merchants", isActive: true, order: 3 },
      { id: "nav-4", label: "বিভিন্ন ব্যবসায়", href: "#industries", isActive: true, order: 4 },
      { id: "nav-5", label: "ফিচারস", href: "#features", isActive: true, order: 5 },
      { id: "nav-6", label: "সাহায্য", href: "#support", isActive: true, order: 6 },
      { id: "nav-7", label: "যোগাযোগ", href: "#contact", isActive: true, order: 7 },
    ],
  },
  hero: {
    badgeText: "বাংলাদেশের নির্ভরযোগ্য QR পেমেন্ট প্ল্যাটফর্ম",
    mainHeading: "একটি QR কোডে",
    highlightedHeading: "সব ধরনের পেমেন্ট",
    subHeading: "এক প্ল্যাটফর্মে",
    description:
      "BanglaQR দিয়ে আপনার ব্যবসা করুন আরও সহজ, নিরাপদ এবং স্মার্ট। অনলাইন ও অফলাইনে বিভিন্ন ডিজিটাল পেমেন্ট সেবা একটি ম্যানেজমেন্ট প্ল্যাটফর্মে পরিচালনা করুন।",
    primaryButtonText: "অ্যাকাউন্ট খুলুন",
    primaryButtonUrl: "/register",
    secondaryButtonText: "ভিডিও দেখুন",
    secondaryButtonUrl: "#how-it-works",
    backgroundImage: "",
    heroImage: "",
    floatingCards: [
      {
        id: "fc-1",
        title: "এক QR-এ বহু পেমেন্ট",
        text: "গ্রাহকের জন্য সহজ অভিজ্ঞতা",
        icon: "QrCode",
        isActive: true,
        order: 1,
      },
      {
        id: "fc-2",
        title: "ব্যবসা বাড়ান",
        text: "সহজ রিপোর্ট ও ইনসাইট",
        icon: "BarChart3",
        isActive: true,
        order: 2,
      },
      {
        id: "fc-3",
        title: "নিরাপদ ও নির্ভরযোগ্য",
        text: "সুরক্ষিত মার্চেন্ট অপারেশন",
        icon: "ShieldCheck",
        isActive: true,
        order: 3,
      },
    ],
  },
  partners: {
    heading: "আমাদের পেমেন্ট পার্টনারসমূহ",
    partnersList: [
      { id: "pt-1", name: "bKash", logo: "", url: "", isBank: false, isActive: true, order: 1 },
      { id: "pt-2", name: "নগদ", logo: "", url: "", isBank: false, isActive: true, order: 2 },
      { id: "pt-3", name: "রকেট", logo: "", url: "", isBank: false, isActive: true, order: 3 },
      { id: "pt-4", name: "upay", logo: "", url: "", isBank: false, isActive: true, order: 4 },
      { id: "pt-5", name: "VISA", logo: "", url: "", isBank: false, isActive: true, order: 5 },
      { id: "pt-6", name: "mastercard", logo: "", url: "", isBank: false, isActive: true, order: 6 },
      { id: "pt-7", name: "সব ব্যাংক", logo: "", url: "", isBank: true, isActive: true, order: 7 },
    ],
  },
  whyBanglaQr: {
    badge: "কেন BanglaQR?",
    heading: "আপনার ব্যবসার জন্য একটি সম্পূর্ণ ডিজিটাল পেমেন্ট সমাধান",
    description:
      "পেমেন্ট গ্রহণ, রিপোর্টিং, সার্ভিস ম্যানেজমেন্ট এবং মার্চেন্ট অপারেশন—সবকিছুকে আরও সহজ ও গুছিয়ে পরিচালনা করুন।",
    features: [
      {
        id: "wb-1",
        title: "ফাস্ট পেমেন্ট",
        text: "কয়েক সেকেন্ডেই পেমেন্ট গ্রহণ এবং যাচাই করুন।",
        icon: "Zap",
        linkText: "আরও জানুন",
        linkUrl: "#contact",
        isActive: true,
        order: 1,
      },
      {
        id: "wb-2",
        title: "নিরাপদ লেনদেন",
        text: "নিরাপত্তা, যাচাই এবং নিয়ন্ত্রণকে গুরুত্ব দিয়ে তৈরি।",
        icon: "ShieldCheck",
        linkText: "আরও জানুন",
        linkUrl: "#contact",
        isActive: true,
        order: 2,
      },
      {
        id: "wb-3",
        title: "রিয়েল-টাইম রিপোর্ট",
        text: "লেনদেন, বিক্রি ও ব্যবসার ইনসাইট এক জায়গায় দেখুন।",
        icon: "BarChart3",
        linkText: "আরও জানুন",
        linkUrl: "#contact",
        isActive: true,
        order: 3,
      },
      {
        id: "wb-4",
        title: "সহজ ইন্টিগ্রেশন",
        text: "POS, ওয়েবসাইট, অ্যাপ বা অন্যান্য চ্যানেলে সহজে ব্যবহার করুন।",
        icon: "Smartphone",
        linkText: "আরও জানুন",
        linkUrl: "#contact",
        isActive: true,
        order: 4,
      },
    ],
  },
  businessGrowth: {
    badge: "ছোট থেকে বড়",
    heading: "সব ধরনের ব্যবসার জন্য একটি পূর্ণাঙ্গ সমাধান",
    description:
      "খুচরা দোকান, ক্যাফে, শিক্ষা, স্বাস্থ্য, সার্ভিস প্রতিষ্ঠান কিংবা কর্পোরেট ব্যবসা—আপনার ব্যবসার ধরন অনুযায়ী ডিজিটাল পেমেন্ট অভিজ্ঞতা তৈরি করুন।",
    primaryButtonText: "অ্যাকাউন্ট খুলুন",
    primaryButtonUrl: "/register",
    secondaryButtonText: "কিভাবে কাজ করে?",
    secondaryButtonUrl: "#how-it-works",
    dashboardImage: "",
    stats: [
      { id: "st-1", value: "10,000+", label: "অ্যাক্টিভ ব্যবসায়ী", icon: "Store", isActive: true, order: 1 },
      { id: "st-2", value: "50M+", label: "সকল লেনদেন", icon: "BarChart3", isActive: true, order: 2 },
      { id: "st-3", value: "99.9%", label: "নিরাপদ ও নির্ভরযোগ্য", icon: "ShieldCheck", isActive: true, order: 3 },
      { id: "st-4", value: "24/7", label: "সাপোর্ট", icon: "Headphones", isActive: true, order: 4 },
    ],
  },
  howItWorks: {
    badge: "কিভাবে কাজ করে?",
    heading: "মাত্র ৩টি ধাপে আপনার ব্যবসার ডিজিটাল পেমেন্ট শুরু করুন",
    description:
      "সহজ রেজিস্ট্রেশন থেকে প্রয়োজনীয় তথ্য জমা এবং অনুমোদনের পর সেবা ব্যবহারের পুরো ফ্লোটি একটি পরিষ্কার মার্চেন্ট অনবোর্ডিং অভিজ্ঞতার মাধ্যমে পরিচালিত হবে।",
    steps: [
      {
        id: "step-1",
        stepNumber: "1",
        title: "অ্যাকাউন্ট খুলুন",
        text: "মাত্র কয়েকটি ধাপে মার্চেন্ট অ্যাকাউন্টের জন্য রেজিস্ট্রেশন করুন।",
        icon: "Store",
        isActive: true,
        order: 1,
      },
      {
        id: "step-2",
        stepNumber: "2",
        title: "ডকুমেন্ট জমা দিন",
        text: "প্রয়োজনীয় তথ্য ও ডকুমেন্ট সম্পূর্ণ করে আবেদন যাচাইয়ের জন্য পাঠান।",
        icon: "QrCode",
        isActive: true,
        order: 2,
      },
      {
        id: "step-3",
        stepNumber: "3",
        title: "পেমেন্ট গ্রহণ শুরু করুন",
        text: "অনুমোদনের পর আপনার নির্বাচিত পেমেন্ট সেবা ও QR চ্যানেল ব্যবহার করুন।",
        icon: "Smartphone",
        isActive: true,
        order: 3,
      },
    ],
  },
  dashboardShowcase: {
    badge: "ড্যাশবোর্ড",
    heading: "রিয়েল-টাইম রিপোর্ট দেখে ব্যবসা চালান আরও স্মার্টভাবে",
    description:
      "লেনদেনের হিস্ট্রি, কাস্টমার ইনসাইট, সার্ভিস স্ট্যাটাস এবং আপনার মার্চেন্ট অপারেশনকে একটি পরিষ্কার ড্যাশবোর্ডে দেখুন।",
    ctaText: "ড্যাশবোর্ড দেখুন",
    ctaUrl: "/login",
    desktopImage: "",
    mobileImage: "",
    features: [
      {
        id: "df-1",
        title: "রিয়েল-টাইম ড্যাশবোর্ড",
        text: "এক নজরে লেনদেনের হিস্ট্রি, ভলিউম, স্ট্যাটাস ও ব্যবসার পারফরম্যান্স দেখুন।",
        isActive: true,
        order: 1,
      },
      {
        id: "df-2",
        title: "মাল্টি-সার্ভিস ম্যানেজমেন্ট",
        text: "আপনার সক্রিয় সেবা, অ্যাপ্লিকেশন, ইন্টিগ্রেশন ও সাপোর্ট একই জায়গায় পরিচালনা করুন।",
        isActive: true,
        order: 2,
      },
      {
        id: "df-3",
        title: "সহজ রিপোর্টিং",
        text: "ব্যবসার সিদ্ধান্তের জন্য গুরুত্বপূর্ণ রিপোর্ট দ্রুত বুঝে নিন।",
        isActive: true,
        order: 3,
      },
    ],
  },
  businessSolutions: {
    badge: "সব ধরনের ব্যবসার জন্য",
    heading: "আপনার ব্যবসা যাই হোক, পেমেন্ট সমাধান আছে",
    description:
      "আপনার ব্যবসার ধরন ও অপারেশন অনুযায়ী মার্চেন্ট পেমেন্ট ম্যানেজমেন্টকে আরও সহজ করতে তৈরি করা হয়েছে।",
    solutionsList: [
      {
        id: "bs-1",
        title: "খুচরা ও রিটেইল দোকান",
        text: "দ্রুত QR ও ডিজিটাল পেমেন্ট গ্রহণের সহজ সমাধান।",
        image: "",
        icon: "Store",
        url: "#contact",
        isActive: true,
        order: 1,
      },
      {
        id: "bs-2",
        title: "রেস্টুরেন্ট ও ক্যাফে",
        text: "কাউন্টার, টেবিল বা ডিজিটাল অর্ডারের জন্য সহজ পেমেন্ট অভিজ্ঞতা।",
        image: "",
        icon: "Utensils",
        url: "#contact",
        isActive: true,
        order: 2,
      },
      {
        id: "bs-3",
        title: "ই-কমার্স",
        text: "অনলাইন অর্ডার ও কাস্টমার পেমেন্টে নির্ভরযোগ্য ডিজিটাল ফ্লো।",
        image: "",
        icon: "ShoppingBag",
        url: "#contact",
        isActive: true,
        order: 3,
      },
      {
        id: "bs-4",
        title: "সেবা প্রতিষ্ঠান",
        text: "শিক্ষা, স্বাস্থ্য, ট্রেনিং ও অন্যান্য সেবার পেমেন্ট ব্যবস্থাপনা।",
        image: "",
        icon: "GraduationCap",
        url: "#contact",
        isActive: true,
        order: 4,
      },
      {
        id: "bs-5",
        title: "কর্পোরেট ও বড় প্রতিষ্ঠান",
        text: "বড় পরিসরের ব্যবসায়িক পেমেন্ট ব্যবস্থাপনা ও রিপোর্টিং।",
        image: "",
        icon: "Building2",
        url: "#contact",
        isActive: true,
        order: 5,
      },
      {
        id: "bs-6",
        title: "স্বাস্থ্যসেবা",
        text: "ক্লিনিক, হাসপাতাল ও স্বাস্থ্যসেবা প্রতিষ্ঠানে সহজ ডিজিটাল পেমেন্ট।",
        image: "",
        icon: "Activity",
        url: "#contact",
        isActive: true,
        order: 6,
      },
    ],
  },
  packages: {
    badge: "আমাদের প্যাকেজ",
    heading: "আমাদের প্যাকেজ",
    description: "আপনার ব্যবসার জন্য সঠিক প্যাকেজ নির্বাচন করুন।",
    packagesList: [
      {
        id: "micro",
        name: "সেটআপ প্যাকেজ (এককালীন)",
        subtitle: "একবারের জন্য সেটআপ",
        price: "৳ ৫০০",
        period: "এককালীন",
        icon: "Settings",
        colorScheme: "emerald",
        features: [
          "পেমেন্ট গেটওয়ে সেটআপ",
          "বেসিক ইন্টিগ্রেশন সাপোর্ট",
          "টেস্ট ও লাইভ সেটআপ",
        ],
        buttonText: "এখনই কিনুন",
        buttonLink: "/register",
        isActive: true,
        order: 1,
      },
      {
        id: "enterprise",
        name: "মাসিক প্যাকেজ",
        subtitle: "মাসিক ব্যবহারের পরিকল্পনা",
        price: "৳ ১,৫০০",
        period: "প্রতি মাসে",
        icon: "Calendar",
        colorScheme: "blue",
        features: [
          "ফুল গেটওয়ে অ্যাক্সেস",
          "API অ্যাক্সেস",
          "টেকনিক্যাল সাপোর্ট",
          "লেনদেন পর্যবেক্ষণ ও মনিটরিং",
        ],
        buttonText: "এখনই কিনুন",
        buttonLink: "/register",
        isActive: true,
        order: 2,
      },
    ],
  },
  testimonials: {
    badge: "আমাদের ব্যবহারকারীদের মতামত",
    heading: "ব্যবসায়ীদের অভিজ্ঞতাই আমাদের অনুপ্রেরণা",
    description:
      "BanglaQR কীভাবে তাদের প্রতিদিনের পেমেন্ট ব্যবস্থাপনাকে সহজ করছে, সেটিই আমাদের সবচেয়ে গুরুত্বপূর্ণ feedback।",
    testimonialsList: [
      {
        id: "t-1",
        name: "রাকিব হাসান",
        role: "রিটেইল ব্যবসায়ী",
        businessName: "হাসান স্টোর",
        avatar: "র",
        avatarImage: "",
        quote: "BanglaQR ব্যবহার করে আমাদের দোকানের পেমেন্ট নেওয়ার প্রক্রিয়া অনেক সহজ হয়েছে।",
        rating: 5,
        isActive: true,
        order: 1,
      },
      {
        id: "t-2",
        name: "অঞ্জলি সুলতানা",
        role: "সার্ভিস ব্যবসা",
        businessName: "সুলতানা ফ্যাশন",
        avatar: "অ",
        avatarImage: "",
        quote: "ড্যাশবোর্ড থেকে ব্যবসার পেমেন্ট ও রিপোর্ট খুব দ্রুত বুঝতে পারি।",
        rating: 5,
        isActive: true,
        order: 2,
      },
      {
        id: "t-3",
        name: "জাহিদুল ইসলাম",
        role: "কর্পোরেট ব্যবসা",
        businessName: "ইসলাম এন্টারপ্রাইজ",
        avatar: "জ",
        avatarImage: "",
        quote: "একাধিক পেমেন্ট চ্যানেলকে একটি ম্যানেজমেন্ট ফ্লোতে দেখার বিষয়টি খুব সুবিধাজনক।",
        rating: 5,
        isActive: true,
        order: 3,
      },
    ],
  },
  finalCta: {
    heading: "আজই আপনার ব্যবসা ডিজিটাল করুন",
    description:
      "BanglaQR-এর সাথে যুক্ত হয়ে আপনার ব্যবসার পেমেন্ট, রিপোর্টিং এবং মার্চেন্ট অপারেশনকে আরও সহজ ও গুছিয়ে পরিচালনা করুন।",
    buttonText: "অ্যাকাউন্ট খুলুন",
    buttonUrl: "/register",
    backgroundImage: "",
  },
  footer: {
    brandName: "BanglaQR",
    logo: "",
    description:
      "বাংলাদেশের ব্যবসায়ীদের জন্য একটি সহজ ও সংগঠিত ডিজিটাল পেমেন্ট সার্ভিস ম্যানেজমেন্ট প্ল্যাটফর্ম।",
    contactAddress: "ঢাকা, বাংলাদেশ",
    contactEmail: "support@banglaqr.com",
    contactPhone: "+880 1234 567890",
    copyrightText: "© 2026 BanglaQR. সর্বস্বত্ব সংরক্ষিত।",
    quickLinks: [
      { id: "fl-1", label: "হোম", href: "#home", isActive: true, order: 1 },
      { id: "fl-2", label: "সেবা সমূহ", href: "#features", isActive: true, order: 2 },
      { id: "fl-3", label: "কিভাবে কাজ করে?", href: "#how-it-works", isActive: true, order: 3 },
      { id: "fl-4", label: "প্যাকেজ", href: "#packages", isActive: true, order: 4 },
    ],
    supportLinks: [
      { id: "sl-1", label: "FAQ", href: "#support", isActive: true, order: 1 },
      { id: "sl-2", label: "ডকুমেন্টেশন", href: "#support", isActive: true, order: 2 },
      { id: "sl-3", label: "সাপোর্ট সেন্টার", href: "#support", isActive: true, order: 3 },
      { id: "sl-4", label: "যোগাযোগ করুন", href: "#contact", isActive: true, order: 4 },
    ],
    socialLinks: [
      { id: "soc-1", platform: "Facebook", icon: "f", url: "https://facebook.com", isActive: true, order: 1 },
      { id: "soc-2", platform: "YouTube", icon: "▶", url: "https://youtube.com", isActive: true, order: 2 },
      { id: "soc-3", platform: "LinkedIn", icon: "in", url: "https://linkedin.com", isActive: true, order: 3 },
      { id: "soc-4", platform: "Instagram", icon: "◎", url: "https://instagram.com", isActive: true, order: 4 },
    ],
    legalLinks: [
      { id: "ll-1", label: "গোপনীয়তা নীতি", href: "#contact", isActive: true, order: 1 },
      { id: "ll-2", label: "শর্তাবলি", href: "#contact", isActive: true, order: 2 },
      { id: "ll-3", label: "সাহায্য", href: "#contact", isActive: true, order: 3 },
    ],
  },
};

async function migrateCmsHomepage() {
  console.log("Starting Migration 006: CMS Homepage tables & permissions...");

  // 1. Create cms_homepage table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS cms_homepage (
      id INT AUTO_INCREMENT PRIMARY KEY,
      page_slug VARCHAR(50) NOT NULL UNIQUE DEFAULT 'homepage',
      draft_content JSON NOT NULL,
      published_content JSON NULL,
      is_published BOOLEAN NOT NULL DEFAULT FALSE,
      last_saved_by INT NULL,
      last_published_by INT NULL,
      last_saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      last_published_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_page_slug (page_slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("✅ cms_homepage table created/verified.");

  // 2. Check if homepage record already exists
  const [existing] = await db.execute("SELECT id FROM cms_homepage WHERE page_slug = 'homepage'");
  if (existing.length === 0) {
    const jsonStr = JSON.stringify(initialCmsHomepageData);
    await db.execute(
      `INSERT INTO cms_homepage (page_slug, draft_content, published_content, is_published, last_published_at) 
       VALUES ('homepage', ?, ?, TRUE, NOW())`,
      [jsonStr, jsonStr]
    );
    console.log("✅ Seeded initial default CMS Homepage content.");
  } else {
    console.log("ℹ️ CMS Homepage record already exists.");
  }

  // 3. Seed permissions
  const permissions = [
    { name: "cms.view", description: "View CMS content and draft preview" },
    { name: "cms.manage", description: "Edit, upload media and publish CMS content" },
  ];

  for (const p of permissions) {
    await db.execute(
      "INSERT IGNORE INTO permissions (name, description) VALUES (?, ?)",
      [p.name, p.description]
    );
  }

  // Map to super_admin and admin roles
  const [roles] = await db.execute("SELECT id, name FROM roles WHERE name IN ('super_admin', 'admin')");
  const [perms] = await db.execute("SELECT id, name FROM permissions WHERE name IN ('cms.view', 'cms.manage')");

  for (const r of roles) {
    for (const p of perms) {
      await db.execute(
        "INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)",
        [r.id, p.id]
      );
    }
  }
  console.log("✅ Seeded CMS permissions (cms.view, cms.manage) for super_admin and admin.");
  console.log("🎉 Migration 006 Completed Successfully!");
  process.exit(0);
}

migrateCmsHomepage().catch((err) => {
  console.error("❌ Migration 006 Failed:", err);
  process.exit(1);
});

