import { describe, expect, it } from "vitest";
import { parseLlmVerifyVerdict } from "../src/services/website/llmVerify.service.js";
import { WebsitePageError } from "../src/services/website/types.js";

describe("parseLlmVerifyVerdict", () => {
  it("parses a valid match payload", () => {
    const verdict = parseLlmVerifyVerdict(
      JSON.stringify({
        isMatch: true,
        pageType: "privacy_policy",
        confidence: 0.91,
        reason: "Full privacy policy document",
      }),
      "privacy_policy",
    );
    expect(verdict).toEqual({
      isMatch: true,
      pageType: "privacy_policy",
      confidence: 0.91,
      reason: "Full privacy policy document",
    });
  });

  it("scales 0–100 confidence and falls back page type", () => {
    const verdict = parseLlmVerifyVerdict(
      JSON.stringify({
        isMatch: true,
        pageType: "not_a_real_type",
        confidence: 88,
        reason: "ok",
      }),
      "privacy_policy",
    );
    expect(verdict.pageType).toBe("privacy_policy");
    expect(verdict.confidence).toBe(0.88);
  });

  it("treats non-true isMatch as false", () => {
    const verdict = parseLlmVerifyVerdict(
      JSON.stringify({ isMatch: "yes", confidence: 1, pageType: "privacy_policy" }),
      "privacy_policy",
    );
    expect(verdict.isMatch).toBe(false);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseLlmVerifyVerdict("{", "privacy_policy")).toThrow(
      WebsitePageError,
    );
  });
});
