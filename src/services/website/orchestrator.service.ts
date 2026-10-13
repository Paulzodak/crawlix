import type { WebsitePageRequest } from "../../parsers/websitePage.js";
import { getOrLoadWebsitePage } from "./cache.service.js";
import { generateCandidateUrls } from "./candidateUrl.service.js";
import { extractCandidatePages } from "./contentExtraction.service.js";
import { discoverPageCandidates } from "./discovery.service.js";
import { verifyExtractedPages } from "./llmVerify.service.js";
import {
  classifyPageRequest,
  type ClassifiedPageRequest,
} from "./pageRequest.service.js";
import type { NormalizedWebsitePage, WebsitePageResult } from "./types.js";
import { toApiFailure, toApiSuccess, WebsitePageError } from "./types.js";
import {
  type ValidatedWebsiteUrl,
  validateWebsiteUrl,
} from "./urlValidation.service.js";

/**
 * Full pipeline: cache → classify → discover → extract → verify → cache store.
 * Concurrent identical requests coalesce via cache single-flight.
 */
export async function findWebsitePage(
  request: WebsitePageRequest,
): Promise<WebsitePageResult> {
  try {
    const website = await validateWebsiteUrl(request.websiteUrl);
    const classified = classifyPageRequest(request.pageRequest);

    const { page, cache } = await getOrLoadWebsitePage(
      website.siteKey,
      classified,
      () => resolveWebsitePage(website, classified),
    );

    // Fresh resolves already logged stage metrics; only note cache reuse here.
    if (cache !== "miss") {
      console.log(
        formatPipelineLog({
          siteKey: website.siteKey,
          type: classified.type,
          cache,
          verified: "yes",
          topUrl: page.url,
          topChars: page.content.length,
        }),
      );
    }
    return toApiSuccess(page);
  } catch (error) {
    if (error instanceof WebsitePageError) {
      return toApiFailure(error.code, error.message);
    }
    throw error;
  }
}

async function resolveWebsitePage(
  website: ValidatedWebsiteUrl,
  classified: ClassifiedPageRequest,
): Promise<NormalizedWebsitePage> {
  const pathCandidates = generateCandidateUrls(website, classified);
  const discovery = await discoverPageCandidates(
    website,
    classified,
    pathCandidates,
  );

  if (discovery.candidates.length === 0) {
    console.log(
      formatPipelineLog({
        siteKey: website.siteKey,
        type: classified.type,
        cache: "miss",
        paths: pathCandidates.length,
        ...discovery.stages,
        shortlist: 0,
        extracted: 0,
        verified: "no",
      }),
    );
    throw new WebsitePageError(
      "PAGE_NOT_FOUND",
      "Could not find a page matching the requested content.",
    );
  }

  const extracted = await extractCandidatePages(
    website,
    classified,
    discovery.candidates,
  );

  if (extracted.length === 0) {
    console.log(
      formatPipelineLog({
        siteKey: website.siteKey,
        type: classified.type,
        cache: "miss",
        paths: pathCandidates.length,
        ...discovery.stages,
        shortlist: discovery.candidates.length,
        extracted: 0,
        verified: "no",
      }),
    );
    throw new WebsitePageError(
      "PAGE_NOT_FOUND",
      "Could not extract content from candidate pages.",
    );
  }

  const verified = await verifyExtractedPages(classified, extracted);
  if (!verified) {
    console.log(
      formatPipelineLog({
        siteKey: website.siteKey,
        type: classified.type,
        cache: "miss",
        paths: pathCandidates.length,
        ...discovery.stages,
        shortlist: discovery.candidates.length,
        extracted: extracted.length,
        verified: "no",
        topUrl: extracted[0]?.document.url,
        topChars: extracted[0]?.document.content.length,
      }),
    );
    throw new WebsitePageError(
      "PAGE_NOT_RELEVANT",
      "Found pages, but none matched the requested content.",
    );
  }

  console.log(
    formatPipelineLog({
      siteKey: website.siteKey,
      type: classified.type,
      cache: "miss",
      paths: pathCandidates.length,
      ...discovery.stages,
      shortlist: discovery.candidates.length,
      extracted: extracted.length,
      verified: "yes",
      topUrl: verified.url,
      topChars: verified.content.length,
    }),
  );

  return verified;
}

function formatPipelineLog(fields: {
  siteKey: string;
  type: string;
  cache: string;
  paths?: number;
  probedLive?: number;
  homepageLinks?: number;
  sitemapCandidates?: number;
  usedLlmRank?: boolean;
  shortlist?: number;
  extracted?: number;
  verified?: string;
  topUrl?: string;
  topChars?: number;
}): string {
  const parts = [
    `website-page ${fields.siteKey}`,
    `type=${fields.type}`,
    `cache=${fields.cache}`,
  ];
  if (fields.paths !== undefined) parts.push(`paths=${fields.paths}`);
  if (fields.probedLive !== undefined) parts.push(`live=${fields.probedLive}`);
  if (fields.homepageLinks !== undefined) {
    parts.push(`home=${fields.homepageLinks}`);
  }
  if (fields.sitemapCandidates !== undefined) {
    parts.push(`sitemap=${fields.sitemapCandidates}`);
  }
  if (fields.usedLlmRank !== undefined) parts.push(`llm=${fields.usedLlmRank}`);
  if (fields.shortlist !== undefined) parts.push(`shortlist=${fields.shortlist}`);
  if (fields.extracted !== undefined) parts.push(`extracted=${fields.extracted}`);
  if (fields.verified !== undefined) parts.push(`verified=${fields.verified}`);
  if (fields.topUrl) {
    parts.push(`top=${fields.topUrl}`);
    if (fields.topChars !== undefined) parts.push(`chars=${fields.topChars}`);
  }
  return parts.join(" ");
}
