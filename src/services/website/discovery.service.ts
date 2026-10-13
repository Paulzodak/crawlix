import { config } from "../../config/index.js";
import { loadWebsitePage } from "./browser.service.js";
import type { CandidateUrl } from "./candidateUrl.service.js";
import { fetchHttp, probeHtmlPage } from "./httpFetch.service.js";
import { getOpenAIClient } from "./openai.client.js";
import type { ClassifiedPageRequest } from "./pageRequest.service.js";
import {
  HIGH_SCORE_THRESHOLD,
  LOW_SCORE_THRESHOLD,
  mergeCandidates,
  rankCandidates,
  scoreAgainstRequest,
  type ScoredCandidate,
} from "./relevance.service.js";
import { canonicalizeUrl } from "./urlHelpers.js";
import {
  resolveHttpUrl,
  type ValidatedWebsiteUrl,
} from "./urlValidation.service.js";

export type DiscoveryResult = {
  candidates: ScoredCandidate[];
  stages: {
    probedLive: number;
    homepageLinks: number;
    sitemapCandidates: number;
    usedLlmRank: boolean;
  };
};

const SITEMAP_PATHS = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/sitemap-index.xml",
  "/sitemaps.xml",
];

/**
 * Discover likely page URLs without a full crawl:
 * probe paths → homepage links → sitemap fallback → optional LLM rank.
 */
export async function discoverPageCandidates(
  website: ValidatedWebsiteUrl,
  classified: ClassifiedPageRequest,
  pathCandidates: CandidateUrl[],
): Promise<DiscoveryResult> {
  const probed: ScoredCandidate[] = [];
  for (const candidate of pathCandidates) {
    const probe = await probeHtmlPage(candidate.url, website);
    if (!probe.live) continue;
    probed.push(
      scoreAgainstRequest({
        url: probe.url,
        classified,
        source: candidate.source,
        live: true,
      }),
    );
  }

  let candidates = mergeCandidates(probed);
  let homepageLinks = 0;
  if (needsMore(candidates, HIGH_SCORE_THRESHOLD)) {
    try {
      const snapshot = await loadWebsitePage(website.homeUrl, website);
      const fromHome = snapshot.links.map((link) =>
        scoreAgainstRequest({
          url: link.url,
          classified,
          source: "homepage_link",
          anchorText: link.text,
          context: link.context,
        }),
      );
      homepageLinks = fromHome.length;
      candidates = mergeCandidates(candidates, fromHome);
    } catch (error) {
      if (candidates.length === 0) throw error;
      console.warn(
        `Homepage discovery failed for ${website.siteKey}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  let sitemapCandidates = 0;
  const best = candidates[0]?.score ?? 0;
  if (
    needsMore(candidates, LOW_SCORE_THRESHOLD) ||
    (classified.type === "custom" && best < HIGH_SCORE_THRESHOLD)
  ) {
    try {
      const fromSitemap = await discoverFromSitemaps(website, classified);
      sitemapCandidates = fromSitemap.length;
      candidates = mergeCandidates(candidates, fromSitemap);
    } catch (error) {
      console.warn(
        `Sitemap discovery failed for ${website.siteKey}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  candidates = rankCandidates(
    candidates,
    Math.max(config.websitePage.maxCandidates, 8),
  );
  let usedLlmRank = false;
  const top = candidates[0]?.score ?? 0;
  if (
    candidates.length > 0 &&
    (classified.type === "custom" || top < LOW_SCORE_THRESHOLD)
  ) {
    const ranked = await maybeRankWithLlm(classified, candidates);
    candidates = ranked.candidates;
    usedLlmRank = ranked.usedLlmRank;
  }

  return {
    candidates: rankCandidates(candidates, config.websitePage.maxCandidates),
    stages: {
      probedLive: probed.length,
      homepageLinks,
      sitemapCandidates,
      usedLlmRank,
    },
  };
}

async function discoverFromSitemaps(
  website: ValidatedWebsiteUrl,
  classified: ClassifiedPageRequest,
): Promise<ScoredCandidate[]> {
  const sitemapDocs: string[] = [];

  try {
    const robots = await fetchHttp(
      new URL("/robots.txt", website.homeUrl).toString(),
      website,
      { accept: "text/plain,*/*;q=0.8", maxBytes: 200_000 },
    );
    if (robots.status >= 200 && robots.status < 300) {
      for (const line of robots.body.split(/\r?\n/)) {
        const match = line.match(/^\s*sitemap:\s*(\S+)/i);
        const absolute = match?.[1] ? resolveHttpUrl(match[1], website) : null;
        if (absolute && !sitemapDocs.includes(absolute)) {
          sitemapDocs.push(absolute);
        }
      }
    }
  } catch {
    // robots.txt is optional
  }

  for (const path of SITEMAP_PATHS) {
    const absolute = resolveHttpUrl(path, website);
    if (absolute && !sitemapDocs.includes(absolute)) {
      sitemapDocs.push(absolute);
    }
  }

  const pageUrls: string[] = [];
  for (const sitemapUrl of sitemapDocs) {
    if (pageUrls.length >= config.websitePage.maxSitemapUrls) break;
    for (const loc of await parseSitemapLocs(sitemapUrl, website)) {
      const absolute = resolveHttpUrl(loc, website);
      if (!absolute || pageUrls.includes(absolute)) continue;
      pageUrls.push(absolute);
      if (pageUrls.length >= config.websitePage.maxSitemapUrls) break;
    }
  }

  return rankCandidates(
    pageUrls
      .map((url) => scoreAgainstRequest({ url, classified, source: "sitemap" }))
      .filter((candidate) => candidate.score >= 20),
    config.websitePage.maxCandidates,
  );
}

async function maybeRankWithLlm(
  classified: ClassifiedPageRequest,
  candidates: ScoredCandidate[],
): Promise<{ candidates: ScoredCandidate[]; usedLlmRank: boolean }> {
  const limit = Math.min(5, config.websitePage.maxCandidates);
  const shortlist = candidates.slice(0, 15);
  let rankedUrls = shortlist.slice(0, limit).map((c) => c.url);
  let usedLlmRank = false;
  const client = getOpenAIClient();

  if (shortlist.length > 0 && client) {
    const allowedUrls = shortlist.map((c) => c.url);
    try {
      const completion = await client.chat.completions.create({
        model: config.openai.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Rank website URLs for page discovery. Only choose from provided candidates. " +
              `Never invent URLs. Return JSON {"rankedUrls": string[]} with at most ${limit} urls.`,
          },
          {
            role: "user",
            content: JSON.stringify({
              request: classified.raw,
              pageType: classified.type,
              candidates: shortlist.map((c) => ({
                url: c.url,
                anchorText: c.anchorText,
                path: c.path,
                score: c.score,
              })),
            }),
          },
        ],
      });

      const parsed = JSON.parse(
        completion.choices[0]?.message?.content ?? "{}",
      ) as { rankedUrls?: unknown };

      const ranked = Array.isArray(parsed.rankedUrls)
        ? parsed.rankedUrls
            .filter((value): value is string => typeof value === "string")
            .map((value) => canonicalizeUrl(value))
            .filter((value) => allowedUrls.includes(value))
        : [];

      rankedUrls = [];
      for (const url of [...ranked, ...allowedUrls]) {
        if (rankedUrls.includes(url)) continue;
        rankedUrls.push(url);
        if (rankedUrls.length >= limit) break;
      }
      usedLlmRank = true;
    } catch (error) {
      console.warn(
        "LLM URL ranking failed; using heuristic order:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const ordered: ScoredCandidate[] = [];
  rankedUrls.forEach((url, index) => {
    const key = canonicalizeUrl(url);
    const candidate =
      candidates.find((entry) => entry.url === key) ??
      candidates.find((entry) => entry.url === url);
    if (!candidate || ordered.some((entry) => entry.url === candidate.url)) {
      return;
    }
    ordered.push({
      ...candidate,
      source: usedLlmRank && index === 0 ? "llm_rank" : candidate.source,
      score: Math.max(candidate.score, HIGH_SCORE_THRESHOLD - index * 5),
    });
  });
  for (const candidate of candidates) {
    if (!ordered.some((entry) => entry.url === candidate.url)) {
      ordered.push(candidate);
    }
  }
  return { candidates: ordered, usedLlmRank };
}

/** Recursive because sitemap indexes nest child sitemaps. */
async function parseSitemapLocs(
  sitemapUrl: string,
  website: ValidatedWebsiteUrl,
): Promise<string[]> {
  try {
    const response = await fetchHttp(sitemapUrl, website, {
      accept: "application/xml,text/xml,*/*;q=0.8",
      maxBytes: 2_000_000,
    });
    if (response.status < 200 || response.status >= 300) return [];
    if (!response.body.includes("<")) return [];

    const locs = [...response.body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)]
      .map((match) =>
        (match[1] ?? "")
          .trim()
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'"),
      )
      .filter(Boolean);

    if (!/<sitemapindex[\s>]/i.test(response.body)) {
      return locs.slice(0, config.websitePage.maxSitemapUrls);
    }

    const nested: string[] = [];
    const children = locs
      .map((loc) => resolveHttpUrl(loc, website))
      .filter((loc): loc is string => Boolean(loc))
      .slice(0, 10);

    for (const child of children) {
      if (nested.length >= config.websitePage.maxSitemapUrls) break;
      nested.push(...(await parseSitemapLocs(child, website)));
    }
    return nested.slice(0, config.websitePage.maxSitemapUrls);
  } catch {
    return [];
  }
}

function needsMore(candidates: ScoredCandidate[], threshold: number): boolean {
  return candidates.length === 0 || (candidates[0]?.score ?? 0) < threshold;
}
