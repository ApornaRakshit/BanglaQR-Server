import { db } from "../../../config/db.js";
import { logAdminAudit } from "../../../utils/auditLogger.js";

export const adminSettingsRepository = {
  async getSettings() {
    const [rows] = await db.execute("SELECT * FROM admin_settings");
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
    return result;
  },

  async updateSetting(key, value, adminEmail) {
    await db.execute(
      `INSERT INTO admin_settings (setting_key, setting_value, updated_by, updated_at)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by), updated_at = NOW()`,
      [key, JSON.stringify(value), adminEmail]
    );
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
};

