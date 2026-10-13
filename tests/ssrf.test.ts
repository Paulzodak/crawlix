import { describe, expect, it } from "vitest";
import {
  assertPublicHttpUrl,
  isBlockedHostname,
  registrableDomain,
  UrlRejectedError,
} from "../src/utils/ssrf.js";

describe("registrableDomain", () => {
  it("collapses subdomains to eTLD+1", () => {
    expect(registrableDomain("https://help.netflix.com/en")).toBe("netflix.com");
    expect(registrableDomain("https://www.jumia.com.ng/sp-privacy")).toBe(
      "jumia.com.ng",
    );
  });

  it("handles common multi-part public suffixes", () => {
    expect(registrableDomain("https://shop.example.co.uk/a")).toBe(
      "example.co.uk",
    );
  });
});

describe("isBlockedHostname", () => {
  it("blocks localhost and internal names", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("app.localhost")).toBe(true);
    expect(isBlockedHostname("printer.local")).toBe(true);
    expect(isBlockedHostname("svc.internal")).toBe(true);
    expect(isBlockedHostname("metadata.google.internal")).toBe(true);
    expect(isBlockedHostname("example.com")).toBe(false);
  });
});

describe("assertPublicHttpUrl", () => {
  it("rejects non-http protocols and credentials", async () => {
    await expect(assertPublicHttpUrl("ftp://example.com")).rejects.toMatchObject({
      reason: "protocol",
    } satisfies Partial<UrlRejectedError>);

    await expect(
      assertPublicHttpUrl("https://user:pass@example.com"),
    ).rejects.toMatchObject({ reason: "credentials" });
  });

  it("rejects private and loopback IPs without DNS", async () => {
    await expect(assertPublicHttpUrl("http://127.0.0.1/")).rejects.toMatchObject({
      reason: "address",
    });
    await expect(assertPublicHttpUrl("http://10.0.0.5/")).rejects.toMatchObject({
      reason: "address",
    });
    await expect(
      assertPublicHttpUrl("http://169.254.169.254/"),
    ).rejects.toMatchObject({ reason: "address" });
    await expect(assertPublicHttpUrl("http://[::1]/")).rejects.toMatchObject({
      reason: "address",
    });
  });

  it("rejects blocked hostnames", async () => {
    await expect(assertPublicHttpUrl("http://localhost/")).rejects.toMatchObject({
      reason: "host",
    });
  });

  it("accepts a public literal IP", async () => {
    // 1.1.1.1 is public; avoids DNS flakiness in unit tests.
    const url = await assertPublicHttpUrl("https://1.1.1.1/path");
    expect(url.hostname).toBe("1.1.1.1");
    expect(url.pathname).toBe("/path");
  });
});
