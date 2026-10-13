import { config } from "../../config/index.js";
import { extractWebsitePage } from "./browser.service.js";
import type { ClassifiedPageRequest } from "./pageRequest.service.js";
import type { ScoredCandidate } from "./relevance.service.js";
import type { NormalizedWebsitePage } from "./types.js";
import type { ValidatedWebsiteUrl } from "./urlValidation.service.js";

export type ExtractedCandidatePage = {
  candidate: ScoredCandidate;
  document: NormalizedWebsitePage;
};

const DEFAULT_EXTRACT_LIMIT = 5;

/**
 * Fetch and normalize content for the top discovery candidates.
 * Confidence is heuristic from discovery score until LLM verification.
 */
export async function extractCandidatePages(
  website: ValidatedWebsiteUrl,
  classified: ClassifiedPageRequest,
  candidates: ScoredCandidate[],
  limit = DEFAULT_EXTRACT_LIMIT,
): Promise<ExtractedCandidatePage[]> {
  const shortlist = candidates.slice(
    0,
    Math.min(limit, config.websitePage.maxCandidates),
  );
  const extracted: ExtractedCandidatePage[] = [];

  for (const candidate of shortlist) {
    try {
      const page = await extractWebsitePage(candidate.url, website);
      extracted.push({
        candidate,
        document: {
          title: page.title || candidate.anchorText || candidate.path,
          url: page.finalUrl,
          sourceUrl: candidate.url,
          type: classified.type,
          content: page.content,
          confidence: heuristicConfidence(candidate.score),
          metadata: { lastUpdated: page.lastUpdated },
        },
      });
    } catch (error) {
      console.warn(
        `Content extraction failed for ${candidate.url}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return extracted;
}

function heuristicConfidence(score: number): number {
  return Math.max(0.05, Math.min(0.95, Number((score / 100).toFixed(2))));
}
