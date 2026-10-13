import { describe, expect, it } from "vitest";
import { classifyPageRequest } from "../src/services/website/pageRequest.service.js";
import {
  mergeCandidates,
  rankCandidates,
  scoreAgainstRequest,
} from "../src/services/website/relevance.service.js";

describe("scoreAgainstRequest", () => {
  const classified = classifyPageRequest("privacy policy");

  it("scores strong path and anchor matches highly", () => {
    const scored = scoreAgainstRequest({
      url: "https://example.com/privacy-policy",
      classified,
      source: "homepage_link",
      anchorText: "Privacy Policy",
      context: "footer",
    });
    expect(scored.score).toBeGreaterThanOrEqual(80);
  });

  it("penalizes noise paths", () => {
    const scored = scoreAgainstRequest({
      url: "https://example.com/login",
      classified,
      source: "homepage_link",
      anchorText: "Sign in",
      context: "nav",
    });
    expect(scored.score).toBeLessThan(40);
  });

  it("boosts live path probes", () => {
    const cold = scoreAgainstRequest({
      url: "https://example.com/privacy",
      classified,
      source: "path_pattern",
    });
    const live = scoreAgainstRequest({
      url: "https://example.com/privacy",
      classified,
      source: "path_pattern",
      live: true,
    });
    expect(live.score).toBe(cold.score + 15);
  });
});

describe("mergeCandidates / rankCandidates", () => {
  const classified = classifyPageRequest("privacy policy");

  it("keeps the higher score when URLs collide", () => {
    const low = scoreAgainstRequest({
      url: "https://example.com/privacy",
      classified,
      source: "sitemap",
    });
    const high = scoreAgainstRequest({
      url: "https://example.com/privacy",
      classified,
      source: "path_pattern",
      live: true,
      anchorText: "Privacy Policy",
      context: "footer",
    });
    const merged = mergeCandidates([low], [high]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.score).toBe(high.score);
  });

  it("ranks by score descending and respects limit", () => {
    const a = scoreAgainstRequest({
      url: "https://example.com/a",
      classified,
      source: "sitemap",
      anchorText: "Privacy Policy",
    });
    const b = scoreAgainstRequest({
      url: "https://example.com/login",
      classified,
      source: "homepage_link",
    });
    const ranked = rankCandidates([b, a], 1);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.url).toContain("/a");
  });
});
