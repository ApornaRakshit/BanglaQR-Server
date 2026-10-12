import { db } from "../../config/db.js";

const CATEGORY_LABELS = {
  bank: "ব্যাংক",
  mfs: "MFS",
  gateway: "পেমেন্ট গেটওয়ে",
  addon: "অ্যাড-অন সেবা",
};

function formatGatewayCapabilities(g) {
  // If custom supported methods are defined, return them directly
  const methods = typeof g.supported_methods === "string" 
    ? JSON.parse(g.supported_methods || "[]") 
    : (g.supported_methods || []);
  
  if (Array.isArray(methods) && methods.length > 0) {
    return methods;
  }

  const caps = ["QR পেমেন্ট", "মার্চেন্ট অ্যাকাউন্ট"];
  if (g.api_supported) {
    caps.push("API ইন্টিগ্রেশন");
  } else if (g.card_supported) {
    caps.push("পেমেন্ট গেটওয়ে");
  } else if (g.mobile_supported) {
    caps.push("ইনস্ট্যান্ট সেটেলমেন্ট");
  } else {
    caps.push("ব্যাংক পেমেন্ট");
  }

  return caps;
}

function formatGatewayPricing(g) {
  const fee = Number(g.service_fee || 0);
  const setup = Number(g.setup_fee || 0);
  return {
    serviceFee: fee,
    setupFee: setup,
    displayPrice: fee > 0 ? `${fee}% ট্রানজেকশন ফি` : "ফ্রি সেটআপ",
    pricingNote: setup > 0 ? `সেটআপ ফি: ৳${setup}` : "কোনো সেটআপ ফি নেই",
  };
}

function formatAddonPricing(a) {
  const price = Number(a.price || 0);
  const type = a.pricing_type || "monthly";
  const cycle = a.billing_cycle || (type === "monthly" ? "মাসিক" : "প্রতি ট্রানজেকশন");

  let displayPrice = "ফ্রি";
  if (type !== "free" && price > 0) {
    displayPrice = `৳${price}/${cycle}`;
  }

  return {
    price,
    pricingType: type,
    billingCycle: cycle,
    displayPrice,
    pricingNote: `${type === "monthly" ? "মাসিক সাবস্ক্রিপশন" : "ব্যবহার অনুযায়ী চার্জ"}`,
  };
}

export const publicMarketplaceRepository = {
  async listServices({ category = "all", search = "" } = {}) {
    const services = [];

    // 1. Fetch Gateways (Bank, MFS, Payment Gateway)
    const shouldFetchGateways = ["all", "bank", "mfs", "gateway"].includes(category);
    if (shouldFetchGateways) {
      const gwConditions = ["g.status = 'active'", "g.is_published = 1"];
      const gwParams = [];

      if (category !== "all") {
        gwConditions.push("g.category = ?");
        gwParams.push(category);
      }

      if (search) {
        gwConditions.push("(g.name LIKE ? OR g.code LIKE ? OR g.description LIKE ? OR g.short_description LIKE ?)");
        const s = `%${search}%`;
        gwParams.push(s, s, s, s);
      }

      const [gwRows] = await db.query(
        `SELECT * FROM gateways g WHERE ${gwConditions.join(" AND ")} ORDER BY g.display_order ASC, g.id ASC`,
        gwParams
      );

      for (const r of gwRows) {
        const cat = r.category || (r.service_type?.toLowerCase().includes("bank") ? "bank" : "gateway");
        services.push({
          id: `gw_${r.id}`,
          rawId: r.id,
          sourceType: "gateway",
          name: r.name,
          code: r.code,
          category: cat,
          categoryLabel: CATEGORY_LABELS[cat] || "পেমেন্ট গেটওয়ে",
          serviceType: r.service_type || "Payment Gateway",
          logoUrl: r.logo_url,
          shortDescription: r.short_description || (r.description ? r.description.slice(0, 140) + "..." : ""),
          description: r.description,
          capabilities: formatGatewayCapabilities(r),
          pricing: formatGatewayPricing(r),
          acceptsApplications: Boolean(r.accepts_applications),
          availabilityStatus: r.code === "NAGAD_DIRECT" ? "সীমিত" : (r.accepts_applications ? "সক্রিয়" : "স্থগিত"),
          isAvailable: Boolean(r.accepts_applications),
          requiredDocuments: typeof r.required_documents === "string" 
            ? JSON.parse(r.required_documents || "[]") 
            : (r.required_documents || []),
          eligibility: r.eligibility || "অনবোর্ডিং সম্পন্ন ও অনুমোদিত বাংলা কিউআর মার্চেন্ট অ্যাকাউন্ট।",
          displayOrder: Number(r.display_order || 0),
        });
      }
    }

    // 2. Fetch Addons
    const shouldFetchAddons = category === "all" || category === "addon";
    if (shouldFetchAddons) {
      const addonConditions = ["(a.status = 'available' OR a.status = 'active')", "a.is_published = 1"];
      const addonParams = [];

      if (search) {
        addonConditions.push("(a.name LIKE ? OR a.code LIKE ? OR a.description LIKE ? OR a.category LIKE ?)");
        const s = `%${search}%`;
        addonParams.push(s, s, s, s);
      }

      const [addonRows] = await db.query(
        `SELECT * FROM addons a WHERE ${addonConditions.join(" AND ")} ORDER BY a.display_order ASC, a.id ASC`,
        addonParams
      );

      for (const a of addonRows) {
        services.push({
          id: `addon_${a.id}`,
          rawId: a.id,
          sourceType: "addon",
          name: a.name,
          code: a.code,
          category: "addon",
          categoryLabel: CATEGORY_LABELS.addon,
          serviceType: a.category || "Add-on Service",
          logoUrl: a.logo_url,
          shortDescription: a.short_description || (a.description ? a.description.slice(0, 140) + "..." : ""),
          description: a.description,
          capabilities: [
            "অ্যাড-অন ফিচার",
            "তাৎক্ষণিক সক্ষমতা",
            a.category === "Hardware" ? "হার্ডওয়্যার টার্মিনাল" : "ক্লাউড অটোমেশন",
            "মার্কেটপ্লেস সাপোর্ট",
          ],
          pricing: formatAddonPricing(a),
          acceptsApplications: Boolean(a.accepts_applications),
          availabilityStatus: a.accepts_applications ? "সক্রিয়" : "স্থগিত",
          isAvailable: Boolean(a.accepts_applications),
          requiredDocuments: ["সক্রিয় মার্চেন্ট প্রোফাইল"],
          eligibility: a.eligibility || a.requirements || "যেকোনো সক্রিয় ও ভেরিফায়েড মার্চেন্ট অ্যাকাউন্ট।",
          displayOrder: Number(a.display_order || 0),
        });
      }
    }

    // Sort by display order then name
    services.sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) {
        return a.displayOrder - b.displayOrder;
      }
      return a.name.localeCompare(b.name);
    });

    return services;
  },

  async getServiceDetails(uniqueId) {
    if (!uniqueId) return null;

    let sourceType = "gateway";
    let rawId = uniqueId;

    if (String(uniqueId).startsWith("gw_")) {
      sourceType = "gateway";
      rawId = String(uniqueId).replace("gw_", "");
    } else if (String(uniqueId).startsWith("addon_")) {
      sourceType = "addon";
      rawId = String(uniqueId).replace("addon_", "");
    }

    if (sourceType === "gateway") {
      const [rows] = await db.query(
        "SELECT * FROM gateways WHERE id = ? AND is_published = 1 AND status = 'active' LIMIT 1",
        [rawId]
      );
      if (!rows.length) return null;
      const r = rows[0];
      const cat = r.category || (r.service_type?.toLowerCase().includes("bank") ? "bank" : "gateway");
      return {
        id: `gw_${r.id}`,
        rawId: r.id,
        sourceType: "gateway",
        name: r.name,
        code: r.code,
        category: cat,
        categoryLabel: CATEGORY_LABELS[cat] || "পেমেন্ট গেটওয়ে",
        serviceType: r.service_type || "Payment Gateway",
        logoUrl: r.logo_url,
        shortDescription: r.short_description || r.description,
        description: r.description,
        capabilities: formatGatewayCapabilities(r),
        pricing: formatGatewayPricing(r),
        acceptsApplications: Boolean(r.accepts_applications),
        availabilityStatus: r.accepts_applications ? "আবেদন গ্রহণ চলছে" : "সাময়িক স্থগিত",
        isAvailable: Boolean(r.accepts_applications),
        requiredDocuments: typeof r.required_documents === "string" 
          ? JSON.parse(r.required_documents || "[]") 
          : (r.required_documents || []),
        eligibility: r.eligibility || "অনবোর্ডিং সম্পন্ন ও অনুমোদিত বাংলা কিউআর মার্চেন্ট অ্যাকাউন্ট।",
        displayOrder: Number(r.display_order || 0),
      };
    } else {
      const [rows] = await db.query(
        "SELECT * FROM addons WHERE id = ? AND is_published = 1 AND (status = 'available' OR status = 'active') LIMIT 1",
        [rawId]
      );
      if (!rows.length) return null;
      const a = rows[0];
      return {
        id: `addon_${a.id}`,
        rawId: a.id,
        sourceType: "addon",
        name: a.name,
        code: a.code,
        category: "addon",
        categoryLabel: CATEGORY_LABELS.addon,
        serviceType: a.category || "Add-on Service",
        logoUrl: a.logo_url,
        shortDescription: a.short_description || a.description,
        description: a.description,
        capabilities: [
          "অ্যাড-অন ফিচার",
          "তাৎক্ষণিক সক্ষমতা",
          a.category === "Hardware" ? "হার্ডওয়্যার টার্মিনাল" : "ক্লাউড অটোমেশন",
          "মার্কেটপ্লেস সাপোর্ট",
        ],
        pricing: formatAddonPricing(a),
        acceptsApplications: Boolean(a.accepts_applications),
        availabilityStatus: a.accepts_applications ? "সক্রিয় সেবা" : "সাময়িক অনুপলব্ধ",
        isAvailable: Boolean(a.accepts_applications),
        requiredDocuments: ["সক্রিয় মার্চেন্ট প্রোফাইল"],
        eligibility: a.eligibility || a.requirements || "যেকোনো সক্রিয় ও ভেরিফায়েড মার্চেন্ট অ্যাকাউন্ট।",
        displayOrder: Number(a.display_order || 0),
      };
    }
  },
};

