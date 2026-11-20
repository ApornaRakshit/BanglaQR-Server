import assert from "node:assert";
import { smsService } from "../src/services/sms.service.js";

async function runMockTests() {
  console.log("=== Running GenNet Provider Mock Unit Tests ===");

  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  try {
    process.env.SMS_PROVIDER = "gennet";
    process.env.SMS_API_KEY = "test_token_12345";
    process.env.SMS_SENDER_ID = "TestSender";
    process.env.SMS_API_URL = "https://isms.gennet.com.bd/api/v3/send-sms";

    // Test 1: isConfigured()
    assert.strictEqual(smsService.isConfigured(), true, "Should be configured when API key is set");

    // Test 2: Successful sendOtpSms via GenNet
    let capturedRequest = null;
    globalThis.fetch = async (url, options) => {
      capturedRequest = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        text: async () => JSON.stringify({
          status: "SUCCESS",
          status_code: 200,
          error_message: "Success",
          smsinfo: [{
            sms_status: "SUCCESS",
            status_message: "Success",
            msisdn: "8801712345678",
            sms_type: "EN",
            sms_body: capturedRequest.body.sms,
            csms_id: capturedRequest.body.csms_id,
            reference_id: "REF99999"
          }]
        })
      };
    };

    const successResult = await smsService.sendOtpSms({
      to: "01712345678",
      otp: "123456",
      expiresMinutes: 5,
    });

    assert.strictEqual(successResult.success, true, "Result should be success");
    assert.strictEqual(successResult.provider, "gennet", "Provider should be gennet");
    assert.strictEqual(successResult.referenceId, "REF99999", "Reference ID should match");
    assert.strictEqual(capturedRequest.body.api_token, "test_token_12345", "API token should match");
    assert.strictEqual(capturedRequest.body.sid, "TestSender", "SID should match");
    assert.strictEqual(capturedRequest.body.msisdn, "8801712345678", "MSISDN must be international format");
    assert.match(capturedRequest.body.csms_id, /^[A-Za-z0-9]+$/, "csms_id must be strictly alphanumeric");
    console.log("✓ Test 1: GenNet Success response mapped properly");

    // Test 3: Failure handling (e.g. 4001 Unauthorized)
    globalThis.fetch = async () => ({
      ok: false,
      text: async () => JSON.stringify({
        status: "FAILED",
        status_code: 4001,
        error_message: "Unauthorized",
        description: "Invalid API token or inactive user."
      })
    });

    try {
      await smsService.sendOtpSms({
        to: "01712345678",
        otp: "123456",
      });
      assert.fail("Should have thrown on GenNet failure");
    } catch (err) {
      assert.strictEqual(err.statusCode, 502, "SmsService should wrap in 502 Bad Gateway");
      console.log("✓ Test 2: GenNet Gateway Error properly handled and wrapped with status 502");
    }

    // Test 4: Invalid phone number validation
    try {
      await smsService.sendOtpSms({
        to: "12345",
        otp: "123456",
      });
      assert.fail("Should have thrown on invalid phone");
    } catch (err) {
      assert.strictEqual(err.statusCode, 400, "Should reject invalid BD phone with 400");
      console.log("✓ Test 3: Invalid phone number rejected with 400 before HTTP request");
    }

    console.log("\nAll GenNet SMS tests passed successfully!");
  } finally {
    globalThis.fetch = originalFetch;
    process.env = originalEnv;
  }
}

runMockTests().catch(e => {
  console.error("Test failed:", e);
  process.exit(1);
});

