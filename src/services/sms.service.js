import { env } from "../config/env.js";

/**
 * Normalizes a Bangladeshi phone number into standard local (01XXXXXXXXX) and international (8801XXXXXXXXX) formats.
 */
export function normalizeBdPhone(phone) {
  if (!phone || typeof phone !== "string") return null;

  // Remove spaces, dashes, parentheses
  let cleaned = phone.trim().replace(/[\s\-()]/g, "");

  // Remove leading plus
  if (cleaned.startsWith("+")) {
    cleaned = cleaned.substring(1);
  }

  // Handle 880 prefix
  if (cleaned.startsWith("880")) {
    cleaned = "0" + cleaned.substring(3);
  }

  // Handle 88 prefix without zero
  if (cleaned.startsWith("88") && cleaned.length === 13) {
    cleaned = cleaned.substring(2);
  }

  // Must match standard BD mobile: 013, 014, 015, 016, 017, 018, 019 followed by 8 digits
  const bdMobileRegex = /^01[3-9]\d{8}$/;
  if (!bdMobileRegex.test(cleaned)) {
    return null;
  }

  return {
    local: cleaned, // 017XXXXXXXX
    international: `88${cleaned}`, // 88017XXXXXXXX
    e164: `+88${cleaned}`, // +88017XXXXXXXX
  };
}

export const smsService = {
  isConfigured() {
    const provider = (process.env.SMS_PROVIDER || env.sms?.provider || "gennet").toLowerCase();
    const apiKey = (process.env.SMS_API_KEY || process.env.SMS_API_TOKEN || env.sms?.apiKey || "").replace(/^["']|["']$/g, "").trim();
    const apiUrl = process.env.SMS_API_URL || env.sms?.apiUrl;

    if (!provider && !apiKey && !apiUrl) {
      return false;
    }

    if (provider === "gennet") {
      return Boolean(apiKey);
    }

    if (provider === "bulksmsbd" || provider === "elitbuzz" || provider === "greenweb") {
      return Boolean(apiKey);
    }

    if (provider === "twilio") {
      return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    }

    if (provider === "generic_http") {
      return Boolean(apiUrl);
    }

    return Boolean(apiKey || apiUrl);
  },

  /**
   * Check SMS Gateway Balance and Status.
   * Returns { available: boolean, balance: number, provider: string, reason?: string }
   */
  async checkSmsBalance() {
    if (!this.isConfigured()) {
      return {
        available: false,
        balance: 0,
        provider: "none",
        reason: "SMS gateway is not configured.",
      };
    }

    const provider = (process.env.SMS_PROVIDER || env.sms?.provider || "gennet").toLowerCase();
    let rawKey = (process.env.SMS_API_KEY || process.env.SMS_API_TOKEN || env.sms?.apiKey || "").replace(/^["']|["']$/g, "").trim();

    if (rawKey === "JDJ5JDEyJC8wVDkuNkd2UjlkUUh6eXB2RDZlVWV6QjVuTS9xNXI2UkRGbWZjUXpIR2NPRWNIb29rSU9T") {
      rawKey = Buffer.from(rawKey, "base64").toString("utf8");
    } else if (rawKey.startsWith("base64:")) {
      rawKey = Buffer.from(rawKey.substring(7), "base64").toString("utf8");
    }
    const apiKey = rawKey;

    try {
      if (provider === "gennet") {
        const url = `https://isms.gennet.com.bd/api/v3/balance?api_token=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(4000),
        });

        const data = await res.json();
        if (data && (data.status === "SUCCESS" || data.status_code === 200)) {
          const list = data?.smsinfo?.balance_info || [];
          let totalBalance = 0;
          for (const item of list) {
            totalBalance += Number(item.sms_balance || 0);
          }
          return {
            available: totalBalance > 0,
            balance: totalBalance,
            provider: "gennet",
            reason: totalBalance <= 0 ? "SMS gateway balance is exhausted." : undefined,
          };
        }
        return {
          available: false,
          balance: 0,
          provider: "gennet",
          reason: data?.description || data?.error_message || "Failed to retrieve SMS balance.",
        };
      }

      // For other providers or dev environment:
      return {
        available: true,
        balance: 999,
        provider,
      };
    } catch (err) {
      console.warn("[SmsService] checkSmsBalance check failed:", err.message);
      return {
        available: false,
        balance: 0,
        provider,
        reason: "SMS service temporary unreachable.",
      };
    }
  },

  async sendOtpSms({ to, otp, purpose = "phone_verification", expiresMinutes = 5 }) {
    const normalized = normalizeBdPhone(to);
    if (!normalized) {
      const error = new Error("Invalid Bangladesh mobile phone number.");
      error.statusCode = 400;
      throw error;
    }

    const message = `Your BanglaQR verification code is ${otp}. Valid for ${expiresMinutes} minutes. Never share this code with anyone.`;
    const isConfigured = this.isConfigured();

    if (!isConfigured) {
      if (env.nodeEnv === "development") {
        console.warn(
          `[SmsService:DEV] SMS gateway is not configured in .env. OTP for ${normalized.local} is: ${otp}`
        );
        return {
          success: true,
          devSimulated: true,
          destination: normalized.local,
          message: "SMS gateway not configured - simulated in development",
        };
      }

      const error = new Error(
        "SMS delivery is not configured on the server. Please contact support or verify via Email."
      );
      error.statusCode = 503;
      throw error;
    }

    const provider = (process.env.SMS_PROVIDER || env.sms?.provider || "gennet").toLowerCase();
    let rawKey = (process.env.SMS_API_KEY || process.env.SMS_API_TOKEN || env.sms?.apiKey || "").replace(/^["']|["']$/g, "").trim();
    
    // Automatic Base64 Decode support for cPanel: if rawKey is base64 encoded, decode it to restore special chars safely
    if (rawKey === "JDJ5JDEyJC8wVDkuNkd2UjlkUUh6eXB2RDZlVWV6QjVuTS9xNXI2UkRGbWZjUXpIR2NPRWNIb29rSU9T") {
      rawKey = Buffer.from(rawKey, "base64").toString("utf8");
    } else if (rawKey.startsWith("base64:")) {
      rawKey = Buffer.from(rawKey.substring(7), "base64").toString("utf8");
    }
    const apiKey = rawKey;
    const senderId = (process.env.SMS_SENDER_ID || env.sms?.senderId || "BanglaQR").replace(/^["']|["']$/g, "").trim();

    try {
      if (provider === "gennet") {
        // GenNet Push SMS Gateway API v3
        // Endpoint: POST https://isms.gennet.com.bd/api/v3/send-sms
        const endpoint =
          process.env.SMS_API_URL || "https://isms.gennet.com.bd/api/v3/send-sms";

        // Generate an alphanumeric csms_id (must contain only letters and numbers)
        // Format: BQ + timestamp + 4 random alphanumeric chars (e.g. BQ1740000000ABCD)
        const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
        const csmsId = `BQ${Date.now()}${randomSuffix}`.substring(0, 20);

        const payload = {
          api_token: apiKey,
          sid: senderId,
          msisdn: normalized.international, // 8801XXXXXXXXX
          sms: message,
          csms_id: csmsId,
        };

        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        });

        const resText = await res.text();
        let jsonRes;
        try {
          jsonRes = JSON.parse(resText);
        } catch {
          jsonRes = null;
        }

        // GenNet API v3 Success: status === "SUCCESS" && status_code === 200
        const isSuccess =
          (jsonRes && (jsonRes.status === "SUCCESS" || jsonRes.status_code === 200 || jsonRes.code === 200)) ||
          (res.ok && resText.includes('"SUCCESS"'));

        if (isSuccess) {
          const firstInfo = jsonRes?.smsinfo?.[0];
          return {
            success: true,
            provider: "gennet",
            csmsId,
            referenceId: firstInfo?.reference_id || jsonRes?.reference_id || null,
            raw: jsonRes || resText,
          };
        } else {
          const statusCode = Number(jsonRes?.status_code || res.status);
          const rawDescription = jsonRes?.description || jsonRes?.status_meaning || jsonRes?.error_message || jsonRes?.message || "";
          
          let friendlyError = "SMS delivery failed: Service unavailable.";
          let httpStatus = 502;

          if (statusCode === 4001) {
            friendlyError = "SMS delivery failed: Invalid API token or unauthorized gateway access. Please verify SMS_API_KEY in .env.";
            httpStatus = 502;
          } else if (statusCode === 4002) {
            friendlyError = "SMS delivery failed: Sender ID (SID) is not permitted. Please verify SMS_SENDER_ID in .env.";
            httpStatus = 502;
          } else if (statusCode === 4003) {
            friendlyError = "SMS delivery failed: Server IP address is blacklisted or not whitelisted with GenNet.";
            httpStatus = 502;
          } else if (rawDescription) {
            friendlyError = `SMS delivery failed: ${rawDescription}`;
          }

          // Safe, sanitized logging that strictly NEVER leaks secrets, tokens or user OTP
          console.error("[SmsService:GenNet] Gateway failure:", {
            httpStatus: res.status,
            gatewayStatusCode: statusCode,
            statusMeaning: jsonRes?.status_meaning || jsonRes?.status || "FAILED",
            description: rawDescription,
            destination: normalized.local,
            hasApiKey: Boolean(apiKey),
            apiKeyLength: apiKey ? apiKey.length : 0,
            senderId: senderId || "missing",
          });

          const error = new Error(friendlyError);
          error.statusCode = httpStatus;
          error.gatewayStatusCode = statusCode;
          throw error;
        }
      }

      if (provider === "bulksmsbd") {
        // BulkSMSBD API endpoint
        const endpoint =
          process.env.SMS_API_URL || "http://bulksmsbd.net/api/smsapi";
        const url = new URL(endpoint);
        url.searchParams.append("api_key", apiKey);
        url.searchParams.append("type", "text");
        url.searchParams.append("number", normalized.international);
        url.searchParams.append("senderid", senderId);
        url.searchParams.append("message", message);

        const res = await fetch(url.toString(), { method: "GET" });
        const resText = await res.text();

        let jsonRes;
        try {
          jsonRes = JSON.parse(resText);
        } catch {
          jsonRes = null;
        }

        if (jsonRes && jsonRes.response_code === 202) {
          return { success: true, provider: "bulksmsbd", raw: jsonRes };
        } else if (res.ok && resText.includes("1000")) {
          return { success: true, provider: "bulksmsbd", raw: resText };
        } else {
          throw new Error(
            jsonRes?.error_message || `SMS Provider rejected: ${resText}`
          );
        }
      }

      if (provider === "greenweb") {
        // Greenweb Bangladesh API
        const endpoint =
          process.env.SMS_API_URL || "http://api.greenweb.com.bd/api.php";
        const body = new URLSearchParams({
          token: apiKey,
          to: normalized.international,
          message,
        });

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });

        const resText = await res.text();
        if (resText.includes("Ok:") || res.ok) {
          return { success: true, provider: "greenweb", raw: resText };
        } else {
          throw new Error(`Greenweb error: ${resText}`);
        }
      }

      if (provider === "elitbuzz") {
        // Elitbuzz API
        const endpoint =
          process.env.SMS_API_URL || "https://msg.elitbuzz-bd.com/smsapi";
        const url = new URL(endpoint);
        url.searchParams.append("api_key", apiKey);
        url.searchParams.append("type", "text");
        url.searchParams.append("contacts", normalized.international);
        url.searchParams.append("senderid", senderId);
        url.searchParams.append("msg", message);

        const res = await fetch(url.toString(), { method: "GET" });
        const resText = await res.text();

        if (res.ok && !resText.toLowerCase().includes("error")) {
          return { success: true, provider: "elitbuzz", raw: resText };
        } else {
          throw new Error(`Elitbuzz error: ${resText}`);
        }
      }

      if (provider === "generic_http") {
        // Generic HTTP endpoint with interpolation
        let urlStr = process.env.SMS_API_URL || "";
        urlStr = urlStr
          .replace("{number}", encodeURIComponent(normalized.international))
          .replace("{phone}", encodeURIComponent(normalized.local))
          .replace("{message}", encodeURIComponent(message))
          .replace("{apiKey}", encodeURIComponent(apiKey || ""))
          .replace("{senderId}", encodeURIComponent(senderId));

        const res = await fetch(urlStr, { method: "GET" });
        if (res.ok) {
          return { success: true, provider: "generic_http" };
        } else {
          throw new Error(`Generic SMS Gateway returned status ${res.status}`);
        }
      }

      if (provider === "twilio") {
        // Twilio SMS
        const sid = process.env.TWILIO_ACCOUNT_SID;
        const token = process.env.TWILIO_AUTH_TOKEN;
        const twilioNumber = process.env.TWILIO_PHONE_NUMBER;

        if (!sid || !token || !twilioNumber) {
          throw new Error("Twilio credentials missing in configuration.");
        }

        const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
        const body = new URLSearchParams({
          From: twilioNumber,
          To: normalized.e164,
          Body: message,
        });

        const authHeader = "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: authHeader,
          },
          body: body.toString(),
        });

        const json = await res.json();
        if (res.ok && json.sid) {
          return { success: true, provider: "twilio", messageId: json.sid };
        } else {
          throw new Error(json.message || "Twilio delivery failure");
        }
      }

      throw new Error(`Unsupported SMS provider: ${provider}`);
    } catch (err) {
      console.error("[SmsService Error]", err.message);
      const isProduction = env.nodeEnv === "production";
      const message =
        err.statusCode === 503
          ? err.message
          : err.gatewayStatusCode
          ? err.message
          : !isProduction && err.message
          ? `SMS delivery failed: ${err.message}`
          : "Failed to deliver SMS verification code. Please check your phone number or try Email verification.";
      const error = new Error(message);
      error.statusCode = err.statusCode || 502;
      error.gatewayStatusCode = err.gatewayStatusCode;
      error.originalError = err.message;
      throw error;
    }
  },
};

