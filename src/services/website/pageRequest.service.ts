import {
  containsNormalizedPhrase,
  normalizePageRequestText,
  PAGE_TYPE_CATALOG,
  type PageTypeDefinition,
} from "../../constants/pageTypes.js";
import type { WebsitePageType } from "./types.js";

export type ClassifiedPageRequest = {
  raw: string;
  normalized: string;
  type: WebsitePageType;
  matchedAlias: string | null;
  definition: PageTypeDefinition | null;
};

/** Map free-text pageRequest onto a catalog type, or custom. Longer aliases win. */
export function classifyPageRequest(pageRequest: string): ClassifiedPageRequest {
  const raw = pageRequest.trim();
  const normalized = normalizePageRequestText(raw);

  const ranked = PAGE_TYPE_CATALOG.flatMap((definition) =>
    definition.aliases.map((alias) => ({
      type: definition.type,
      alias,
      needle: normalizePageRequestText(alias),
      definition,
    })),
  ).sort((a, b) => b.needle.length - a.needle.length);

  for (const candidate of ranked) {
    if (candidate.needle && containsNormalizedPhrase(normalized, candidate.needle)) {
      return {
        raw,
        normalized,
        type: candidate.type,
        matchedAlias: candidate.alias,
        definition: candidate.definition,
      };
    }
  }

  return {
    raw,
    normalized,
    type: "custom",
    matchedAlias: null,
    definition: null,
  };
}
