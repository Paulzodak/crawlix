import { config } from "../../config/index.js";
import type { ClassifiedPageRequest } from "./pageRequest.service.js";
import { normalizePathname } from "./urlHelpers.js";
import {
  resolveHttpUrl,
  type ValidatedWebsiteUrl,
} from "./urlValidation.service.js";

export type CandidateUrl = {
  url: string;
  source: "path_pattern" | "request_slug";
  path: string;
};

/** Build likely candidate URLs from catalog paths or request slugs. */
export function generateCandidateUrls(
  website: ValidatedWebsiteUrl,
  classified: ClassifiedPageRequest,
): CandidateUrl[] {
  let entries: Array<{ path: string; source: CandidateUrl["source"] }>;

  if (classified.type !== "custom" && classified.definition) {
    entries = classified.definition.pathPatterns.map((path) => ({
      path,
      source: "path_pattern" as const,
    }));
  } else {
    const slug = classified.normalized
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    if (slug.length < 3) {
      entries = [];
    } else {
      const underscored = slug.replace(/-/g, "_");
      entries = [
        `/${slug}`,
        `/${underscored}`,
        `/legal/${slug}`,
        `/policies/${slug}`,
        `/en/${slug}`,
      ].map((path) => ({ path, source: "request_slug" as const }));
    }
  }

  const candidates: CandidateUrl[] = [];
  for (const entry of entries) {
    const path = normalizePathname(entry.path);
    const absolute = resolveHttpUrl(path, website);
    if (!absolute || candidates.some((c) => c.url === absolute)) continue;
    candidates.push({ url: absolute, source: entry.source, path });
    if (candidates.length >= config.websitePage.maxCandidates) break;
  }
  return candidates;
}
