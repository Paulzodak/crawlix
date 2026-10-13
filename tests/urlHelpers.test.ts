import { describe, expect, it } from "vitest";
import {
  canonicalizeUrl,
  normalizePathname,
  toHttpsUrl,
} from "../src/services/website/urlHelpers.js";
import { resolveHttpUrl } from "../src/services/website/urlValidation.service.js";
import type { ValidatedWebsiteUrl } from "../src/services/website/urlValidation.service.js";

const website: ValidatedWebsiteUrl = {
  homeUrl: "https://example.com/",
  siteKey: "example.com",
  url: new URL("https://example.com/"),
};

describe("urlHelpers", () => {
  it("canonicalizes trailing slashes and hashes", () => {
    expect(canonicalizeUrl("https://example.com/privacy/#top")).toBe(
      "https://example.com/privacy",
    );
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("upgrades http to https", () => {
    expect(toHttpsUrl("http://example.com/privacy")).toBe(
      "https://example.com/privacy",
    );
  });

  it("normalizes pathnames", () => {
    expect(normalizePathname("privacy")).toBe("/privacy");
    expect(normalizePathname("/privacy/")).toBe("/privacy");
  });
});

describe("resolveHttpUrl", () => {
  it("resolves relative http(s) paths", () => {
    expect(resolveHttpUrl("/privacy-policy", website)).toBe(
      "https://example.com/privacy-policy",
    );
  });

  it("allows external http(s) absolute URLs", () => {
    expect(resolveHttpUrl("https://help.example.org/legal", website)).toBe(
      "https://help.example.org/legal",
    );
  });

  it("rejects non-http schemes", () => {
    expect(resolveHttpUrl("mailto:a@example.com", website)).toBeNull();
    expect(resolveHttpUrl("javascript:void(0)", website)).toBeNull();
  });
});
