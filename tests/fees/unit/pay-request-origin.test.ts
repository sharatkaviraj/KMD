import { describe, expect, it } from "vitest";

import { originFromHeaders } from "@/app/pay/[code]/request-origin";

const headersOf = (values: Record<string, string>) => new Headers(values);

describe("originFromHeaders", () => {
  it("uses the host the request came in on, over https", () => {
    expect(originFromHeaders(headersOf({ host: "schoolfees-two.vercel.app" }))).toBe(
      "https://schoolfees-two.vercel.app",
    );
  });

  it("prefers the forwarded host and protocol Vercel sets, first value only", () => {
    expect(
      originFromHeaders(
        headersOf({ host: "internal", "x-forwarded-host": "VPPS-One.vercel.app, other", "x-forwarded-proto": "https" }),
      ),
    ).toBe("https://vpps-one.vercel.app");
    expect(originFromHeaders(headersOf({ host: "localhost:3000", "x-forwarded-proto": "http" }))).toBe(
      "http://localhost:3000",
    );
  });

  it("refuses a host that is not a plain host name", () => {
    expect(originFromHeaders(headersOf({}))).toBeNull();
    expect(originFromHeaders(headersOf({ host: "evil.test/path" }))).toBeNull();
    expect(originFromHeaders(headersOf({ host: "a b" }))).toBeNull();
  });
});
