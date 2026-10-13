/** Shared URL normalization for discovery / scoring. */

/** Drop hash and trailing slash so the same page maps to one key. */
export function canonicalizeUrl(raw: string | URL): string {
  try {
    const url = typeof raw === "string" ? new URL(raw) : new URL(raw.href);
    url.hash = "";
    url.pathname = normalizePathname(url.pathname);
    return url.toString();
  } catch {
    return typeof raw === "string" ? raw.trim() : raw.toString();
  }
}

/** Upgrade http:// to https://; leave other schemes unchanged. */
export function toHttpsUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.toString();
  } catch {
    return raw;
  }
}

/** Normalize a pathname: ensure leading slash, drop trailing slash (except root). */
export function normalizePathname(pathname: string): string {
  const trimmed = pathname.trim() || "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  if (withSlash.length > 1 && withSlash.endsWith("/")) {
    return withSlash.slice(0, -1);
  }
  return withSlash || "/";
}

/** True when content-type looks like HTML (empty counts as maybe-HTML for HEAD). */
export function isHtmlContentType(contentType: string): boolean {
  const type = contentType.toLowerCase();
  if (!type) return true;
  return (
    type.includes("text/html") ||
    type.includes("application/xhtml") ||
    type.includes("text/plain")
  );
}
