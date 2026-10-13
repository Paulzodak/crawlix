import {
  containsNormalizedPhrase,
  normalizePageRequestText,
} from "../../constants/pageTypes.js";
import type { ClassifiedPageRequest } from "./pageRequest.service.js";
import { canonicalizeUrl } from "./urlHelpers.js";

export type DiscoverySource =
  | "path_pattern"
  | "request_slug"
  | "homepage_link"
  | "sitemap"
  | "llm_rank";

export type LinkContext = "nav" | "footer" | "body" | "other";

export type ScoredCandidate = {
  url: string;
  score: number;
  source: DiscoverySource;
  path: string;
  anchorText: string | null;
  context: LinkContext | null;
};

export const HIGH_SCORE_THRESHOLD = 80;
export const LOW_SCORE_THRESHOLD = 45;

const NOISE_PATH_RE =
  /\/(cart|checkout|login|signin|signup|register|account|wishlist|search|cdn-cgi|wp-admin|wp-login)(\/|$)/i;

const SOURCE_BONUS: Partial<Record<DiscoverySource, number>> = {
  path_pattern: 20,
  request_slug: 10,
};

const CONTEXT_BONUS: Partial<Record<LinkContext, number>> = {
  nav: 15,
  footer: 15,
  body: 5,
};

/** Score a URL (and optional anchor) against the classified request. */
export function scoreAgainstRequest(input: {
  url: string;
  classified: ClassifiedPageRequest;
  source: DiscoverySource;
  anchorText?: string | null;
  context?: LinkContext | null;
  live?: boolean;
}): ScoredCandidate {
  const url = canonicalizeUrl(input.url);
  const path = new URL(url).pathname;
  const pathNorm = normalizePageRequestText(path.replace(/\//g, " "));
  const anchorNorm = normalizePageRequestText(input.anchorText ?? "");

  const aliases = [input.classified.normalized];
  if (input.classified.matchedAlias) {
    const alias = normalizePageRequestText(input.classified.matchedAlias);
    if (!aliases.includes(alias)) aliases.push(alias);
  }
  for (const alias of input.classified.definition?.aliases ?? []) {
    const normalized = normalizePageRequestText(alias);
    if (!aliases.includes(normalized)) aliases.push(normalized);
  }
  aliases.sort((a, b) => b.length - a.length);

  const keywords: string[] = [];
  for (const keyword of input.classified.definition?.keywords ?? []) {
    const normalized = normalizePageRequestText(keyword);
    if (!keywords.includes(normalized)) keywords.push(normalized);
  }
  for (const token of tokens(input.classified.normalized)) {
    if (token.length >= 4 && !keywords.includes(token)) keywords.push(token);
  }
  keywords.sort((a, b) => b.length - a.length);

  let textScore = 0;
  for (const phrase of aliases) {
    if (!phrase || !anchorNorm) continue;
    if (!containsNormalizedPhrase(anchorNorm, phrase)) continue;
    textScore = anchorNorm === phrase ? 100 : 70;
    break;
  }

  let pathScore = 0;
  for (const alias of aliases) {
    if (!alias) continue;
    const slug = alias.replace(/\s+/g, "-");
    const compact = alias.replace(/\s+/g, "");
    if (
      path === `/${slug}` ||
      path.endsWith(`/${slug}`) ||
      pathNorm === alias ||
      path.includes(slug) ||
      path.replace(/[-_]/g, "").includes(compact)
    ) {
      pathScore = 90;
      break;
    }
  }

  let keywordScore = 0;
  for (const keyword of keywords) {
    if (!keyword) continue;
    if (containsNormalizedPhrase(anchorNorm, keyword)) {
      keywordScore = 25;
      break;
    }
    if (
      pathNorm.includes(keyword) ||
      path.includes(keyword.replace(/\s+/g, "-"))
    ) {
      keywordScore = 35;
      break;
    }
  }

  const requestTokens = tokens(input.classified.normalized);
  const hayTokens = tokens(`${pathNorm} ${anchorNorm}`);
  const overlapHits = requestTokens.filter((token) =>
    hayTokens.includes(token),
  ).length;
  const overlapScore =
    overlapHits === 0 ? 0 : Math.min(50, overlapHits * 12);

  let score =
    textScore +
    pathScore +
    keywordScore +
    overlapScore +
    (CONTEXT_BONUS[input.context ?? "other"] ?? 0) +
    (SOURCE_BONUS[input.source] ?? 0) +
    (input.live ? 15 : 0);

  if (NOISE_PATH_RE.test(path)) score -= 40;
  if (path === "/") score -= 30;

  return {
    url,
    score: Math.max(0, score),
    source: input.source,
    path,
    anchorText: input.anchorText?.trim() || null,
    context: input.context ?? null,
  };
}

export function mergeCandidates(...groups: ScoredCandidate[][]): ScoredCandidate[] {
  const merged: ScoredCandidate[] = [];
  for (const group of groups) {
    for (const candidate of group) {
      const index = merged.findIndex((entry) => entry.url === candidate.url);
      if (index === -1) merged.push(candidate);
      else if (candidate.score > (merged[index]?.score ?? 0)) {
        merged[index] = candidate;
      }
    }
  }
  return rankCandidates(merged);
}

export function rankCandidates(
  candidates: ScoredCandidate[],
  limit = candidates.length,
): ScoredCandidate[] {
  return [...candidates].sort((a, b) => b.score - a.score).slice(0, limit);
}

function tokens(value: string): string[] {
  return value.split(" ").filter((part) => part.length >= 3);
}
