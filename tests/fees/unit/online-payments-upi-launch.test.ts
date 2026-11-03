import { describe, expect, it } from "vitest";

import {
  UPI_APPS,
  chromeIntentUrl,
  isAndroidUserAgent,
  readRazorpayUpiUri,
  upiAppIntentUrl,
} from "@/modules/payments/domain/online/upi-launch";

// The shape Razorpay's hosted page redirected an Android phone to on
// 2026-10-29, with the VPA and reference replaced.
const RAZORPAY_UPI =
  "upi://pay?am=50.00&cu=INR&mc=8211&mode=22&pa=school123.rzp@rxairtel&pn=VPPS&tn=Payment%20To%20VPPS&tr=TtFakeRef123";

describe("readRazorpayUpiUri", () => {
  it("accepts Razorpay's own redirect for exactly this amount, unchanged", () => {
    expect(readRazorpayUpiUri(RAZORPAY_UPI, 5000)).toBe(RAZORPAY_UPI);
  });

  it("refuses a different amount, to the paisa", () => {
    expect(readRazorpayUpiUri(RAZORPAY_UPI, 5001)).toBeNull();
    expect(readRazorpayUpiUri(RAZORPAY_UPI.replace("am=50.00", "am=500.00"), 5000)).toBeNull();
  });

  it("refuses a payee that is not a Razorpay collection VPA", () => {
    expect(readRazorpayUpiUri(RAZORPAY_UPI.replace("school123.rzp@rxairtel", "someone@okaxis"), 5000)).toBeNull();
  });

  it("refuses anything without Razorpay's reference, in another currency, or not upi://pay", () => {
    expect(readRazorpayUpiUri(RAZORPAY_UPI.replace("&tr=TtFakeRef123", ""), 5000)).toBeNull();
    expect(readRazorpayUpiUri(RAZORPAY_UPI.replace("cu=INR", "cu=USD"), 5000)).toBeNull();
    expect(readRazorpayUpiUri(RAZORPAY_UPI.replace("upi://pay", "upi://mandate"), 5000)).toBeNull();
    expect(readRazorpayUpiUri("https://razorpay.com/payment-link/plink_x", 5000)).toBeNull();
    expect(readRazorpayUpiUri(null, 5000)).toBeNull();
    expect(readRazorpayUpiUri(RAZORPAY_UPI, 0)).toBeNull();
  });
});

describe("upiAppIntentUrl", () => {
  it("names the app's package and keeps Razorpay's parameters as they were", () => {
    const phonePe = UPI_APPS.find((app) => app.key === "phonepe")!;
    const url = upiAppIntentUrl(RAZORPAY_UPI, phonePe, "https://example.test/pay/c?step=open&notice=app_missing");
    expect(url.startsWith("intent://pay?am=50.00&cu=INR&")).toBe(true);
    expect(url).toContain("tr=TtFakeRef123#Intent;scheme=upi;package=com.phonepe.app;");
    expect(url).toContain(
      `S.browser_fallback_url=${encodeURIComponent("https://example.test/pay/c?step=open&notice=app_missing")}`,
    );
    expect(url.endsWith(";end")).toBe(true);
  });
});

describe("chromeIntentUrl", () => {
  it("reopens the same https page in Chrome, with the page itself as the fallback", () => {
    const page = "https://example.test/pay/abc?step=open";
    expect(chromeIntentUrl(page)).toBe(
      `intent://example.test/pay/abc?step=open#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(page)};end`,
    );
  });

  it("refuses anything that is not https", () => {
    expect(chromeIntentUrl("http://example.test/pay/abc")).toBeNull();
    expect(chromeIntentUrl("not a url")).toBeNull();
  });
});

describe("isAndroidUserAgent", () => {
  it("is true for Android browsers, including an in-app WebView", () => {
    expect(
      isAndroidUserAgent(
        "Mozilla/5.0 (Linux; Android 14; SM-A146B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36",
      ),
    ).toBe(true);
  });

  it("is false for an iPhone, a desktop, or nothing", () => {
    expect(isAndroidUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)")).toBe(false);
    expect(isAndroidUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(isAndroidUserAgent(null)).toBe(false);
  });
});
