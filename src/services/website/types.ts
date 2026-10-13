export type WebsitePageType =
  | "privacy_policy"
  | "terms_and_conditions"
  | "terms_of_service"
  | "cookie_policy"
  | "refund_policy"
  | "return_policy"
  | "shipping_policy"
  | "security_policy"
  | "acceptable_use_policy"
  | "about"
  | "pricing"
  | "contact"
  | "custom";

export type NormalizedWebsitePage = {
  title: string;
  url: string;
  sourceUrl: string;
  type: WebsitePageType;
  content: string;
  confidence: number;
  metadata: { lastUpdated: string | null };
};

export type WebsitePageSuccess = {
  success: true;
  page: {
    title: string;
    url: string;
    type: WebsitePageType;
    content: string;
    confidence: number;
  };
};

export type WebsitePageErrorCode =
  | "INVALID_BODY"
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "SSRF_BLOCKED"
  | "WEBSITE_UNREACHABLE"
  | "NAVIGATION_TIMEOUT"
  | "PAGE_NOT_FOUND"
  | "PAGE_NOT_RELEVANT"
  | "CONTENT_EXTRACTION_FAILED"
  | "BROWSER_ERROR"
  | "LLM_VERIFICATION_FAILED"
  | "INTERNAL_ERROR";

export type WebsitePageFailure = {
  success: false;
  error: { code: WebsitePageErrorCode; message: string };
};

export type WebsitePageResult = WebsitePageSuccess | WebsitePageFailure;

const STATUS_BY_CODE: Record<WebsitePageErrorCode, number> = {
  INVALID_BODY: 400,
  INVALID_URL: 400,
  UNSUPPORTED_PROTOCOL: 400,
  SSRF_BLOCKED: 400,
  PAGE_NOT_FOUND: 404,
  PAGE_NOT_RELEVANT: 404,
  WEBSITE_UNREACHABLE: 502,
  NAVIGATION_TIMEOUT: 502,
  CONTENT_EXTRACTION_FAILED: 502,
  BROWSER_ERROR: 502,
  LLM_VERIFICATION_FAILED: 502,
  INTERNAL_ERROR: 500,
};

export function statusForErrorCode(code: WebsitePageErrorCode): number {
  return STATUS_BY_CODE[code] ?? 500;
}

export class WebsitePageError extends Error {
  readonly code: WebsitePageErrorCode;
  readonly statusCode: number;

  constructor(code: WebsitePageErrorCode, message: string) {
    super(message);
    this.name = "WebsitePageError";
    this.code = code;
    this.statusCode = statusForErrorCode(code);
  }
}

export function toApiSuccess(page: NormalizedWebsitePage): WebsitePageSuccess {
  return {
    success: true,
    page: {
      title: page.title,
      url: page.url,
      type: page.type,
      content: page.content,
      confidence: page.confidence,
    },
  };
}

export function toApiFailure(
  code: WebsitePageErrorCode,
  message: string,
): WebsitePageFailure {
  return { success: false, error: { code, message } };
}
