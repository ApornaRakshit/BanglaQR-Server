import { db } from "../../../config/db.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";

// Cached settings for quick synchronous and asynchronous platform middleware checks
let settingsCache = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 10000; // 10 seconds

export const adminSettingsRepository = {
  async getSettings() {
    const [rows] = await db.execute("SELECT * FROM admin_settings ORDER BY id ASC");
    const result = {};
    rows.forEach((r) => {
      result[r.setting_key] = {
        key: r.setting_key,
        value: typeof r.setting_value === "string" ? JSON.parse(r.setting_value) : r.setting_value,
        category: r.category,
        updatedBy: r.updated_by,
        updatedAt: r.updated_at,
      };
    });
    settingsCache = result;
    lastCacheTime = Date.now();
    return result;
  },

  async getSettingValue(key, defaultValue = null) {
    if (settingsCache && Date.now() - lastCacheTime < CACHE_TTL_MS) {
      if (settingsCache[key]) return settingsCache[key].value;
    }
    const all = await this.getSettings();
    return all[key]?.value ?? defaultValue;
  },

  async updateSetting(key, value, adminEmail) {
    await db.execute(
      `INSERT INTO admin_settings (setting_key, setting_value, updated_by, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by), updated_at = NOW()`,
      [key, JSON.stringify(value), adminEmail]
    );
    settingsCache = null; // Invalidate cache
  },

  async updateMultipleSettings(settingsMap, adminEmail) {
    for (const [key, value] of Object.entries(settingsMap)) {
      await db.execute(
        `INSERT INTO admin_settings (setting_key, setting_value, updated_by, updated_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by), updated_at = NOW()`,
        [key, JSON.stringify(value), adminEmail]
      );
    }
    settingsCache = null;
  },
};

export const adminSettingsController = {
  async get(req, res, next) {
    try {
      const data = await adminSettingsRepository.getSettings();
      res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  },

  async update(req, res, next) {
    try {
      const key = req.params.settingKey;
      const { value } = req.body;

      // Disallow misleading transaction parameter fields
      if (key === "platform_fee_percent" || key === "max_daily_tx_limit") {
        return res.status(400).json({
          success: false,
          message: "Transaction and payment settlement fee fields are not applicable to BanglaQR onboarding platform.",
        });
      }

      await adminSettingsRepository.updateSetting(key, value, req.user.email);
      await logAdminAudit({
        userId: req.user.id,
        adminEmail: req.user.email,
        action: "settings_update",
        resourceType: "settings",
        resourceId: key,
        details: { settingKey: key, value },
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });
      res.json({ success: true, message: `Setting '${key}' updated successfully` });
    } catch (err) {
      next(err);
    }
  },

  async updateBatch(req, res, next) {
    try {
      const { settings } = req.body; // e.g. { platform_general: {...}, onboarding_kyc_policy: {...} }
      if (!settings || typeof settings !== "object") {
        return res.status(400).json({ success: false, message: "Invalid settings object provided" });
      }

      // Filter out transaction fee keys
      delete settings.platform_fee_percent;
      delete settings.max_daily_tx_limit;

      await adminSettingsRepository.updateMultipleSettings(settings, req.user.email);

      await logAdminAudit({
        userId: req.user.id,
        adminEmail: req.user.email,
        action: "settings_batch_update",
        resourceType: "settings",
        resourceId: Object.keys(settings).join(","),
        details: { updatedKeys: Object.keys(settings) },
        ip: req.ip,
        userAgent: req.get("user-agent"),
      });

      const updated = await adminSettingsRepository.getSettings();
      res.json({ success: true, message: "All platform settings saved successfully!", data: updated });
    } catch (err) {
      next(err);
    }
  },

  async getPublicConfig(req, res, next) {
    try {
      const general = await adminSettingsRepository.getSettingValue("platform_general", {});
      const maintenance = await adminSettingsRepository.getSettingValue("maintenance_status", {});
      const uploadPolicy = await adminSettingsRepository.getSettingValue("document_upload_policy", {});

      res.json({
        success: true,
        data: {
          platformName: general.platformName || "BanglaQR Platform",
          supportEmail: general.supportEmail || "support@banglaqr.com.bd",
          supportPhone: general.supportPhone || "+880 9612 000 000",
          timezone: general.timezone || "Asia/Dhaka",
          dateFormat: general.dateFormat || "DD/MM/YYYY",
          maintenanceMode: !!maintenance.maintenanceMode,
          maintenanceMessage: maintenance.maintenanceMessage || "Platform is under scheduled maintenance.",
          registrationEnabled: maintenance.registrationEnabled !== false,
          maxUploadSizeMb: uploadPolicy.maxFileSizeMb || 10,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};

