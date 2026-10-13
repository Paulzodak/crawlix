import {
  assertPublicHttpUrl,
  registrableDomain,
  UrlRejectedError,
} from "../../utils/ssrf.js";
import { canonicalizeUrl } from "./urlHelpers.js";
import { WebsitePageError } from "./types.js";

export type ValidatedWebsiteUrl = {
  homeUrl: string;
  siteKey: string;
  url: URL;
};

/** Validate and normalize a caller-supplied website URL. */
export async function validateWebsiteUrl(raw: string): Promise<ValidatedWebsiteUrl> {
  try {
    const url = await assertPublicHttpUrl(raw.trim());
    url.hash = "";
    return {
      homeUrl: `${url.origin}/`,
      siteKey: registrableDomain(url),
      url,
    };
  } catch (error) {
    throw toWebsitePageError(error);
  }
}

/** Navigation/redirect target must be a public http(s) URL. External domains are allowed. */
export async function validateNavigationUrl(
  raw: string,
  website: ValidatedWebsiteUrl,
): Promise<URL> {
  const candidate = parseHttpUrl(raw, website, { soft: false });
  try {
    const url = await assertPublicHttpUrl(candidate);
    url.hash = "";
    return url;
  } catch (error) {
    throw toWebsitePageError(error);
  }
}

/** Resolve href to an absolute http(s) URL, or null if invalid / non-http(s). */
export function resolveHttpUrl(
  href: string,
  website: ValidatedWebsiteUrl,
): string | null {
  const candidate = parseHttpUrl(href, website, { soft: true });
  return candidate ? canonicalizeUrl(candidate) : null;
}

/** Map SSRF/URL rejection errors onto stable API error codes. */
export function toWebsitePageError(error: unknown): WebsitePageError {
  if (error instanceof WebsitePageError) return error;
  if (error instanceof UrlRejectedError) {
    if (error.reason === "protocol") {
      return new WebsitePageError("UNSUPPORTED_PROTOCOL", error.message);
    }
    if (error.reason === "invalid" || error.reason === "credentials") {
      return new WebsitePageError("INVALID_URL", error.message);
    }
    if (error.reason === "dns") {
      return new WebsitePageError("WEBSITE_UNREACHABLE", error.message);
    }
    return new WebsitePageError("SSRF_BLOCKED", error.message);
  }
  return new WebsitePageError("INVALID_URL", "websiteUrl is not allowed");
}

function parseHttpUrl(
  href: string,
  website: ValidatedWebsiteUrl,
  options: { soft: true },
): URL | null;
function parseHttpUrl(
  href: string,
  website: ValidatedWebsiteUrl,
  options: { soft: false },
): URL;
function parseHttpUrl(
  href: string,
  website: ValidatedWebsiteUrl,
  options: { soft: boolean },
): URL | null {
  let candidate: URL;
  try {
    candidate = new URL(href, website.homeUrl);
  } catch {
    if (options.soft) return null;
    throw new WebsitePageError("INVALID_URL", "Navigation URL is not valid");
  }

  if (candidate.protocol !== "http:" && candidate.protocol !== "https:") {
    if (options.soft) return null;
    throw new WebsitePageError(
      "UNSUPPORTED_PROTOCOL",
      "Only http and https URLs are allowed",
    );
  }

  candidate.hash = "";
  return candidate;
}
