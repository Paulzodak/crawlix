import { describe, expect, it } from "vitest";
import { generateCandidateUrls } from "../src/services/website/candidateUrl.service.js";
import { classifyPageRequest } from "../src/services/website/pageRequest.service.js";
import type { ValidatedWebsiteUrl } from "../src/services/website/urlValidation.service.js";

const website: ValidatedWebsiteUrl = {
  homeUrl: "https://example.com/",
  siteKey: "example.com",
  url: new URL("https://example.com/"),
};

describe("generateCandidateUrls", () => {
  it("emits catalog path patterns for known types", () => {
    const classified = classifyPageRequest("privacy policy");
    const candidates = generateCandidateUrls(website, classified);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.source === "path_pattern")).toBe(true);
    expect(candidates.some((c) => c.path === "/privacy-policy")).toBe(true);
    expect(candidates.every((c) => c.url.startsWith("https://example.com/"))).toBe(
      true,
    );
  });

  it("emits slug paths for custom requests", () => {
    const classified = classifyPageRequest("retention policies");
    const candidates = generateCandidateUrls(website, classified);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.source === "request_slug")).toBe(true);
    expect(candidates.some((c) => c.path === "/retention-policies")).toBe(true);
    expect(candidates.some((c) => c.path === "/legal/retention-policies")).toBe(
      true,
    );
  });

  it("deduplicates and stays under the candidate cap", () => {
    const classified = classifyPageRequest("privacy");
    const candidates = generateCandidateUrls(website, classified);
    const urls = candidates.map((c) => c.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
