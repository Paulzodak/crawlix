import { describe, expect, it } from "vitest";
import { getOrLoadWebsitePage } from "../src/services/website/cache.service.js";
import type { ClassifiedPageRequest } from "../src/services/website/pageRequest.service.js";
import type { NormalizedWebsitePage } from "../src/services/website/types.js";

const classified: ClassifiedPageRequest = {
  raw: "privacy policy",
  normalized: "privacy policy",
  type: "privacy_policy",
  matchedAlias: "privacy policy",
  definition: null,
};

function page(url: string): NormalizedWebsitePage {
  return {
    title: "Privacy",
    url,
    sourceUrl: url,
    type: "privacy_policy",
    content: "body",
    confidence: 0.9,
    metadata: { lastUpdated: null },
  };
}

describe("getOrLoadWebsitePage", () => {
  it("coalesces concurrent loads for the same key", async () => {
    let computeCount = 0;
    const siteKey = `cache-coalesce-${Date.now()}`;

    const compute = async () => {
      computeCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return page(`https://example.com/privacy-${siteKey}`);
    };

    const [a, b] = await Promise.all([
      getOrLoadWebsitePage(siteKey, classified, compute),
      getOrLoadWebsitePage(siteKey, classified, compute),
    ]);

    expect(computeCount).toBe(1);
    expect(a.page.url).toBe(b.page.url);
    expect([a.cache, b.cache].sort()).toEqual(["coalesced", "miss"].sort());
  });

  it("returns cache hits on later calls", async () => {
    const siteKey = `cache-hit-${Date.now()}`;
    let computeCount = 0;

    const first = await getOrLoadWebsitePage(siteKey, classified, async () => {
      computeCount += 1;
      return page(`https://example.com/${siteKey}`);
    });
    const second = await getOrLoadWebsitePage(siteKey, classified, async () => {
      computeCount += 1;
      return page(`https://example.com/should-not-run`);
    });

    expect(first.cache).toBe("miss");
    expect(second.cache).toBe("hit");
    expect(computeCount).toBe(1);
    expect(second.page.url).toBe(first.page.url);
  });
});
