import { fail, ok, requireTrimmedString, type ParseResult } from "./common.js";

export type WebsitePageRequest = {
  websiteUrl: string;
  pageRequest: string;
};

export function parseWebsitePageBody(body: unknown): ParseResult<WebsitePageRequest> {
  if (!body || typeof body !== "object") {
    return fail(400, {
      success: false,
      error: {
        code: "INVALID_BODY",
        message: "JSON body is required",
      },
    });
  }

  const record = body as Record<string, unknown>;
  const websiteUrl = requireTrimmedString(record.websiteUrl, "websiteUrl");
  if (!websiteUrl.ok) return websiteUrl;
  if (websiteUrl.data.length > 2048) {
    return fail(400, {
      success: false,
      error: {
        code: "INVALID_BODY",
        message: "websiteUrl is too long",
      },
    });
  }

  const pageRequest = requireTrimmedString(record.pageRequest, "pageRequest");
  if (!pageRequest.ok) return pageRequest;
  if (pageRequest.data.length > 500) {
    return fail(400, {
      success: false,
      error: {
        code: "INVALID_BODY",
        message: "pageRequest is too long",
      },
    });
  }

  return ok({
    websiteUrl: websiteUrl.data,
    pageRequest: pageRequest.data,
  });
}
