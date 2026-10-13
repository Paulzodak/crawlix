import puppeteer, {
  type Browser,
  type Frame,
  type HTTPRequest,
  type HTTPResponse,
  type Page,
} from "puppeteer";
import { config } from "../../config/index.js";
import { getPuppeteerLaunchOptions } from "../../utils/puppeteer-launch.js";
import { isBlockedHostname, normalizedHostname, UrlRejectedError } from "../../utils/ssrf.js";
import type { LinkContext } from "./relevance.service.js";
import { WebsitePageError } from "./types.js";
import { isHtmlContentType, toHttpsUrl } from "./urlHelpers.js";
import {
  resolveHttpUrl,
  toWebsitePageError,
  type ValidatedWebsiteUrl,
  validateNavigationUrl,
} from "./urlValidation.service.js";

type DiscoveredLink = {
  url: string;
  text: string;
  context: LinkContext;
};

type LoadedPageSnapshot = {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  httpStatus: number;
  links: DiscoveredLink[];
  content: string;
  contentTruncated: boolean;
};

type ExtractedPageContent = {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  httpStatus: number;
  content: string;
  contentTruncated: boolean;
  lastUpdated: string | null;
};

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const BLOCKED_RESOURCE_TYPES = [
  "image",
  "media",
  "font",
  "texttrack",
  "eventsource",
  "websocket",
  "manifest",
  "ping",
];

const BLOCKED_TRACKERS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "facebook.net",
  "hotjar.com",
  "segment.io",
  "segment.com",
  "mixpanel.com",
  "amplitude.com",
];

const STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "nav",
  "header",
  "footer",
  "aside",
  "[role='navigation']",
  "[role='banner']",
  "[aria-hidden='true']",
].join(",");

let browserPromise: Promise<Browser> | null = null;
let activePages = 0;
const pageWaiters: Array<() => void> = [];

/** Run work on a fresh page from the shared browser. Always closes the page. */
async function withBrowserPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  if (activePages < config.websitePage.maxConcurrentPages) {
    activePages += 1;
  } else {
    await new Promise<void>((resolve) => {
      pageWaiters.push(() => {
        activePages += 1;
        resolve();
      });
    });
  }

  let page: Page | null = null;
  try {
    if (!browserPromise) {
      browserPromise = puppeteer
        .launch(getPuppeteerLaunchOptions())
        .then((browser) => {
          browser.on("disconnected", () => {
            browserPromise = null;
          });
          return browser;
        })
        .catch((error) => {
          browserPromise = null;
          throw error;
        });
    }
    const browser = await browserPromise;
    page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 800 });
    page.setDefaultNavigationTimeout(config.websitePage.navigationTimeoutMs);
    page.setDefaultTimeout(config.websitePage.requestTimeoutMs);
    return await fn(page);
  } catch (error) {
    throw mapBrowserError(error);
  } finally {
    await page?.close().catch(() => undefined);
    activePages = Math.max(0, activePages - 1);
    pageWaiters.shift()?.();
  }
}

/** Navigate with SSRF checks. Request interception stays sync to avoid Puppeteer races. */
async function gotoWebsitePage(
  page: Page,
  targetUrl: string,
  website: ValidatedWebsiteUrl,
): Promise<HTTPResponse> {
  const initial = await validateNavigationUrl(targetUrl, website);
  let blockedNavigation: string | null = null;

  await page.setRequestInterception(true);
  const onRequest = (request: HTTPRequest) => {
    if (request.isInterceptResolutionHandled()) return;

    const url = request.url();
    try {
      if (
        url === "about:blank" ||
        url.startsWith("data:") ||
        url.startsWith("blob:")
      ) {
        void request.continue();
        return;
      }

      if (
        BLOCKED_RESOURCE_TYPES.includes(request.resourceType()) ||
        isTrackerHost(url)
      ) {
        void request.abort();
        return;
      }

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        void request.abort();
        return;
      }

      const hostname = normalizedHostname(new URL(url));
      if (isBlockedHostname(hostname)) {
        if (request.isNavigationRequest()) {
          blockedNavigation ??= "That host is not allowed";
        }
        void request.abort();
        return;
      }

      void request.continue();
    } catch (error) {
      if (request.isNavigationRequest()) {
        blockedNavigation ??=
          error instanceof Error ? error.message : "URL is not allowed";
      }
      void request.abort().catch(() => undefined);
    }
  };
  page.on("request", onRequest);

  try {
    let response: HTTPResponse | null;
    try {
      response = await page.goto(initial.toString(), {
        waitUntil: "domcontentloaded",
        timeout: config.websitePage.navigationTimeoutMs,
      });
    } catch (error) {
      if (blockedNavigation) {
        throw new WebsitePageError("SSRF_BLOCKED", blockedNavigation);
      }
      throw mapBrowserError(error);
    }

    if (blockedNavigation) {
      throw new WebsitePageError("SSRF_BLOCKED", blockedNavigation);
    }
    if (!response) {
      throw new WebsitePageError(
        "WEBSITE_UNREACHABLE",
        "The page did not return a document",
      );
    }

    const chain = response.request().redirectChain();
    if (chain.length > config.websitePage.maxRedirects) {
      throw new WebsitePageError(
        "SSRF_BLOCKED",
        `Too many redirects (max ${config.websitePage.maxRedirects})`,
      );
    }

    // Full SSRF check on the settled URL (DNS / private IP).
    await validateNavigationUrl(page.url(), website);
    await page
      .waitForNetworkIdle({ idleTime: 750, timeout: 8_000 })
      .catch(() => undefined);

    return response;
  } finally {
    page.off("request", onRequest);
    await page.setRequestInterception(false).catch(() => undefined);
  }
}

/** Load a page and return title, links, and main content. */
export async function loadWebsitePage(
  targetUrl: string,
  website: ValidatedWebsiteUrl,
): Promise<LoadedPageSnapshot> {
  return withBrowserPage(async (page) => {
    const response = await gotoWebsitePage(page, targetUrl, website);
    assertHtmlResponse(response);

    const snapshot = await page.evaluate(
      (maxChars, stripSelectors) => {
        const title = document.title ?? "";
        const links = Array.from(document.querySelectorAll("a[href]")).map((anchor) => {
          const el = anchor as HTMLAnchorElement;
          const text = (
            el.textContent ||
            el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            ""
          )
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 180);

          let context: "nav" | "footer" | "body" | "other" = "other";
          if (el.closest("nav, [role='navigation'], header")) context = "nav";
          else if (el.closest("footer, [role='contentinfo']")) context = "footer";
          else if (el.closest("main, article, [role='main']")) context = "body";

          return { url: el.href, text, context };
        });

        const root =
          document.querySelector("main") ||
          document.querySelector("article") ||
          document.querySelector('[role="main"]') ||
          document.body;

        const clone = root ? (root.cloneNode(true) as HTMLElement) : null;
        clone?.querySelectorAll(stripSelectors).forEach((node) => node.remove());

        const content = (clone?.innerText || document.body?.innerText || "")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();

        return {
          title,
          links,
          content: content.slice(0, maxChars),
          contentTruncated: content.length > maxChars,
        };
      },
      config.websitePage.maxContentChars,
      STRIP_SELECTORS,
    );
    const links: DiscoveredLink[] = [];
    for (const link of snapshot.links) {
      const absolute = resolveHttpUrl(link.url, website);
      if (!absolute) continue;
      const httpsUrl = toHttpsUrl(absolute);
      if (links.some((entry) => entry.url === httpsUrl)) continue;
      links.push({ url: httpsUrl, text: link.text, context: link.context });
    }

    return {
      requestedUrl: targetUrl,
      finalUrl: page.url(),
      title: snapshot.title.trim(),
      httpStatus: response.status(),
      links,
      content: snapshot.content,
      contentTruncated: snapshot.contentTruncated,
    };
  });
}

/**
 * Load a page and extract normalized main content (headings, paragraphs, lists, tables).
 * Used after discovery when preparing documents for verification.
 * Also reads same-origin iframes (CMS shells like Jumia /sp-* pages).
 */
export async function extractWebsitePage(
  targetUrl: string,
  website: ValidatedWebsiteUrl,
): Promise<ExtractedPageContent> {
  return withBrowserPage(async (page) => {
    const response = await gotoWebsitePage(page, targetUrl, website);
    assertHtmlResponse(response);
    await settleChildFrames(page);

    const mainSnap = await extractNormalizedFromFrame(
      page.mainFrame(),
      config.websitePage.maxContentChars,
    );
    let snapshot = mainSnap;

    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const frameSnap = await extractNormalizedFromFrame(
          frame,
          config.websitePage.maxContentChars,
        );
        if (frameSnap.content.length > snapshot.content.length) {
          snapshot = {
            ...frameSnap,
            // Prefer the shell page title when the iframe has none.
            title: mainSnap.title || frameSnap.title,
          };
        }
      } catch {
        // Cross-origin or detached frames are skipped.
      }
    }

    if (!snapshot.content) {
      throw new WebsitePageError(
        "CONTENT_EXTRACTION_FAILED",
        "Could not extract meaningful page content",
      );
    }

    return {
      requestedUrl: targetUrl,
      finalUrl: page.url(),
      title: snapshot.title,
      httpStatus: response.status(),
      content: snapshot.content,
      contentTruncated: snapshot.contentTruncated,
      lastUpdated: snapshot.lastUpdated,
    };
  });
}

type FrameContentSnapshot = {
  title: string;
  content: string;
  contentTruncated: boolean;
  lastUpdated: string | null;
};

/** Wait briefly for CMS iframes to attach and paint. */
async function settleChildFrames(page: Page): Promise<void> {
  await page.waitForSelector("iframe", { timeout: 3_000 }).catch(() => undefined);
  await Promise.all(
    page.frames().map(async (frame) => {
      if (frame === page.mainFrame()) return;
      await frame.waitForSelector("body", { timeout: 8_000 }).catch(() => undefined);
    }),
  );
  await page
    .waitForNetworkIdle({ idleTime: 500, timeout: 5_000 })
    .catch(() => undefined);
}

/**
 * Normalize readable content from one frame.
 * Keep the evaluate callback free of named function bindings: tsx/esbuild injects
 * `__name(...)` for keepNames, which breaks when Puppeteer runs it in-page.
 */
async function extractNormalizedFromFrame(
  frame: Frame,
  maxChars: number,
): Promise<FrameContentSnapshot> {
  return frame.evaluate(
    (maxChars, stripSelectors) => {
      const title = (document.title ?? "").trim();

      const root =
        document.querySelector("main") ||
        document.querySelector("article") ||
        document.querySelector('[role="main"]') ||
        document.body;

      const clone = root ? (root.cloneNode(true) as HTMLElement) : null;
      if (!clone) {
        return {
          title,
          content: "",
          contentTruncated: false,
          lastUpdated: null as string | null,
        };
      }

      clone.querySelectorAll(stripSelectors).forEach((node) => node.remove());

      const parts: string[] = [];
      const stack: Element[] = [clone];
      while (stack.length > 0) {
        const node = stack.pop();
        if (!node) continue;

        const tag = node.tagName.toLowerCase();
        if (
          tag === "script" ||
          tag === "style" ||
          tag === "noscript" ||
          tag === "svg" ||
          tag === "iframe"
        ) {
          continue;
        }

        if (/^h[1-6]$/.test(tag)) {
          const level = Number(tag[1] ?? "1");
          const heading = `${"#".repeat(level)} ${node.textContent ?? ""}`
            .replace(/\s+/g, " ")
            .trim();
          if (heading) parts.push(heading);
          continue;
        }
        if (tag === "p" || tag === "pre" || tag === "blockquote") {
          const block = (node.textContent ?? "").replace(/\s+/g, " ").trim();
          if (block) parts.push(block);
          continue;
        }
        if (tag === "li") {
          const item = `- ${node.textContent ?? ""}`.replace(/\s+/g, " ").trim();
          if (item) parts.push(item);
          continue;
        }
        if (tag === "table") {
          for (const row of Array.from(node.querySelectorAll("tr"))) {
            const cells = Array.from(row.querySelectorAll("th,td"))
              .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim())
              .filter(Boolean)
              .join(" | ");
            if (cells) parts.push(cells);
          }
          continue;
        }

        const children = Array.from(node.children);
        for (let i = children.length - 1; i >= 0; i -= 1) {
          const child = children[i];
          if (child) stack.push(child);
        }
      }

      let content = parts
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      if (!content) {
        content = (clone.innerText || "")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }

      let lastUpdated: string | null = null;
      const timeEl = document.querySelector("time[datetime]");
      if (timeEl) {
        lastUpdated =
          timeEl.getAttribute("datetime")?.trim() ||
          (timeEl.textContent ?? "").replace(/\s+/g, " ").trim() ||
          null;
      }
      if (!lastUpdated) {
        const meta =
          document.querySelector('meta[property="article:modified_time"]') ||
          document.querySelector('meta[name="last-modified"]') ||
          document.querySelector('meta[name="date"]');
        lastUpdated = meta?.getAttribute("content")?.trim() || null;
      }
      if (!lastUpdated) {
        const match = content.match(
          /(?:last\s+(?:updated|modified|revised)|updated\s+on)\s*[:\-]?\s*([A-Za-z0-9,\s\/\-]{4,40})/i,
        );
        lastUpdated = match?.[1]?.trim() || null;
      }

      return {
        title,
        content: content.slice(0, maxChars),
        contentTruncated: content.length > maxChars,
        lastUpdated,
      };
    },
    maxChars,
    STRIP_SELECTORS,
  );
}

/** Close the shared browser. Safe to call more than once. */
export async function closeSharedBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  try {
    await (await pending).close();
  } catch {
    // ignore shutdown races
  }
}

function assertHtmlResponse(response: HTTPResponse): void {
  const contentType = response.headers()["content-type"] ?? "";
  if (contentType && !isHtmlContentType(contentType)) {
    throw new WebsitePageError(
      "CONTENT_EXTRACTION_FAILED",
      `Unsupported content type: ${contentType.split(";")[0]?.trim()}`,
    );
  }
}

function isTrackerHost(raw: string): boolean {
  try {
    const hostname = normalizedHostname(new URL(raw));
    return BLOCKED_TRACKERS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

function mapBrowserError(error: unknown): Error {
  if (error instanceof WebsitePageError || error instanceof UrlRejectedError) {
    return toWebsitePageError(error);
  }
  const message = error instanceof Error ? error.message : "Browser error";
  if (/timeout/i.test(message)) {
    return new WebsitePageError("NAVIGATION_TIMEOUT", "Navigation timed out");
  }
  if (/net::|NS_ERROR|ERR_/i.test(message)) {
    return new WebsitePageError("WEBSITE_UNREACHABLE", message);
  }
  return new WebsitePageError(
    "BROWSER_ERROR",
    `Browser failed while loading the page: ${message}`,
  );
}
