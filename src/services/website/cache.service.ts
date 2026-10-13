import { config } from "../../config/index.js";
import type { ClassifiedPageRequest } from "./pageRequest.service.js";
import type { NormalizedWebsitePage } from "./types.js";

type CacheEntry = {
  page: NormalizedWebsitePage;
  expiresAt: number;
};

const MAX_ENTRIES = 500;

const entries: Record<string, CacheEntry> = Object.create(null) as Record<
  string,
  CacheEntry
>;

/** Coalesce concurrent misses for the same key (single-flight). */
const inflight: Record<string, Promise<NormalizedWebsitePage>> = Object.create(
  null,
) as Record<string, Promise<NormalizedWebsitePage>>;

function cacheKey(siteKey: string, classified: ClassifiedPageRequest): string {
  if (classified.type === "custom") {
    return `${siteKey}:custom:${classified.normalized || classified.raw.toLowerCase()}`;
  }
  return `${siteKey}:${classified.type}`;
}

function read(key: string): NormalizedWebsitePage | null {
  const entry = entries[key];
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    delete entries[key];
    return null;
  }
  return clonePage(entry.page);
}

function write(key: string, page: NormalizedWebsitePage): void {
  pruneExpired();
  const keys = Object.keys(entries);
  if (keys.length >= MAX_ENTRIES && !entries[key]) {
    const oldestKey = keys[0];
    if (oldestKey) delete entries[oldestKey];
  }
  entries[key] = {
    page: clonePage(page),
    expiresAt: Date.now() + Math.max(1, config.websitePage.cacheTtlSeconds) * 1000,
  };
}

/**
 * Return a cached page, or run `compute` once per key while concurrent callers wait.
 * Successful pages are stored; thrown errors reject all waiters and are not cached.
 */
export async function getOrLoadWebsitePage(
  siteKey: string,
  classified: ClassifiedPageRequest,
  compute: () => Promise<NormalizedWebsitePage>,
): Promise<{ page: NormalizedWebsitePage; cache: "hit" | "miss" | "coalesced" }> {
  const key = cacheKey(siteKey, classified);
  const hit = read(key);
  if (hit) return { page: hit, cache: "hit" };

  const pending = inflight[key];
  if (pending) {
    return { page: await pending, cache: "coalesced" };
  }

  const promise = (async () => {
    try {
      const page = await compute();
      write(key, page);
      return page;
    } finally {
      delete inflight[key];
    }
  })();

  inflight[key] = promise;
  return { page: await promise, cache: "miss" };
}

function pruneExpired(): void {
  const now = Date.now();
  for (const key of Object.keys(entries)) {
    const entry = entries[key];
    if (entry && now >= entry.expiresAt) delete entries[key];
  }
}

function clonePage(page: NormalizedWebsitePage): NormalizedWebsitePage {
  return {
    title: page.title,
    url: page.url,
    sourceUrl: page.sourceUrl,
    type: page.type,
    content: page.content,
    confidence: page.confidence,
    metadata: { lastUpdated: page.metadata.lastUpdated },
  };
}
