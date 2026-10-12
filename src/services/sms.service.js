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
    const provider = (process.env.SMS_PROVIDER || "").toLowerCase();
    const apiKey = process.env.SMS_API_KEY;
    const apiUrl = process.env.SMS_API_URL;

    if (!provider && !apiKey && !apiUrl) {
      return false;
    }

    if (provider === "bulksmsbd" || provider === "elitbuzz" || provider === "greenweb") {
      return Boolean(apiKey || process.env.SMS_API_TOKEN);
    }

    if (provider === "twilio") {
      return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    }

    if (provider === "generic_http") {
      return Boolean(apiUrl);
    }

    return Boolean(apiKey || apiUrl);
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

    const provider = (process.env.SMS_PROVIDER || "bulksmsbd").toLowerCase();
    const apiKey = process.env.SMS_API_KEY || process.env.SMS_API_TOKEN;
    const senderId = process.env.SMS_SENDER_ID || "BanglaQR";

    try {
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
      const error = new Error(
        "Failed to deliver SMS verification code. Please check your phone number or try Email verification."
      );
      error.statusCode = 502;
      throw error;
    }
  },
};

