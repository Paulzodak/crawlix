import { config as dotenvConfig } from "dotenv";

dotenvConfig();

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const config = {
  port: parseInt(process.env.PORT || "8001", 10),
  /** Bind address. Defaults to loopback. Set HOST=0.0.0.0 inside Docker. */
  host: process.env.HOST || "0.0.0.0",
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },
  database: {
    url: process.env.DATABASE_URL || "",
  },
  websitePage: {
    navigationTimeoutMs: intEnv("WEBSITE_NAVIGATION_TIMEOUT_MS", 45_000),
    requestTimeoutMs: intEnv("WEBSITE_REQUEST_TIMEOUT_MS", 30_000),
    maxRedirects: intEnv("WEBSITE_MAX_REDIRECTS", 5),
    maxCandidates: intEnv("WEBSITE_MAX_CANDIDATES", 12),
    maxSitemapUrls: intEnv("WEBSITE_MAX_SITEMAP_URLS", 500),
    maxContentChars: intEnv("WEBSITE_MAX_CONTENT_CHARS", 100_000),
    cacheTtlSeconds: intEnv("WEBSITE_CACHE_TTL_SECONDS", 86_400),
    maxConcurrentPages: intEnv("WEBSITE_MAX_CONCURRENT_PAGES", 2),
  },
} as const;
