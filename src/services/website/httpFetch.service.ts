import { config } from "../../config/index.js";
import { WebsitePageError } from "./types.js";
import { isHtmlContentType } from "./urlHelpers.js";
import {
  type ValidatedWebsiteUrl,
  validateNavigationUrl,
} from "./urlValidation.service.js";

type HttpFetchResult = {
  url: string;
  status: number;
  contentType: string;
  body: string;
};

const HTML_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/** HTTP(S) fetch with manual redirects and SSRF checks on each hop. */
export async function fetchHttp(
  targetUrl: string,
  website: ValidatedWebsiteUrl,
  options: {
    maxBytes?: number;
    method?: "GET" | "HEAD";
    accept?: string;
    timeoutMs?: number;
  } = {},
): Promise<HttpFetchResult> {
  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? config.websitePage.requestTimeoutMs;
  let current = (await validateNavigationUrl(targetUrl, website)).toString();
  let redirects = 0;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(current, {
        method,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: options.accept ?? "*/*",
          "User-Agent":
            "Mozilla/5.0 (compatible; QlaretyWebScraper/1.0; +local)",
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new WebsitePageError("NAVIGATION_TIMEOUT", "Request timed out");
      }
      throw new WebsitePageError("WEBSITE_UNREACHABLE", "Website is unreachable");
    } finally {
      clearTimeout(timer);
    }

    if (REDIRECT_STATUSES.includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new WebsitePageError(
          "SSRF_BLOCKED",
          "Redirect response is missing a Location header",
        );
      }
      redirects += 1;
      if (redirects > config.websitePage.maxRedirects) {
        throw new WebsitePageError(
          "SSRF_BLOCKED",
          `Too many redirects (max ${config.websitePage.maxRedirects})`,
        );
      }
      current = (await validateNavigationUrl(location, website)).toString();
      continue;
    }

    let body = "";
    if (method !== "HEAD") {
      const maxBytes = options.maxBytes ?? 2_000_000;
      if (!response.body || maxBytes <= 0) {
        await response.body?.cancel().catch(() => undefined);
      } else {
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          const remaining = maxBytes - total;
          if (value.byteLength > remaining) {
            chunks.push(value.slice(0, remaining));
            await reader.cancel().catch(() => undefined);
            break;
          }
          chunks.push(value);
          total += value.byteLength;
        }
        body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
          "utf8",
        );
      }
    }

    return {
      url: current,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body,
    };
  }
}

/** Soft probe: true when the URL looks like a live HTML page. Never throws. */
export async function probeHtmlPage(
  targetUrl: string,
  website: ValidatedWebsiteUrl,
): Promise<{ live: boolean; url: string; status: number }> {
  try {
    let result = await fetchHttp(targetUrl, website, {
      method: "HEAD",
      accept: HTML_ACCEPT,
      maxBytes: 0,
    });

    if (result.status === 405 || result.status === 501) {
      result = await fetchHttp(result.url, website, {
        method: "GET",
        accept: HTML_ACCEPT,
        maxBytes: 4_096,
      });
    }

    const live =
      result.status >= 200 &&
      result.status < 400 &&
      (isHtmlContentType(result.contentType) ||
        ((result.contentType.includes("octet-stream") ||
          result.contentType.includes("*/*")) &&
          /^\s*</.test(result.body)));

    return { live, url: result.url, status: result.status };
  } catch {
    return { live: false, url: targetUrl, status: 0 };
  }
}
