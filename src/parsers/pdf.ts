import { DEFAULT_PDF_VIEWPORT, PDF_WAIT_UNTIL } from "../constants/pdf.js";
import { fail, ok, type ParseResult } from "./common.js";

export type PdfRenderInput = {
  html: string;
  output: "pdf" | "png" | "jpeg";
  filename: string;
  waitUntil: (typeof PDF_WAIT_UNTIL)[number];
  viewportWidth: number;
  viewportHeight: number;
  fullPage: boolean;
  scale: number;
  outFilename: string;
};

function sanitizeFilename(filename: string): string {
  const trimmed = (filename || "").trim();
  if (!trimmed) return "page";
  const cleaned = trimmed.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 120);
  return cleaned.replace(/\.[a-zA-Z0-9]+$/, "");
}

export function parseRenderBody(body: unknown): ParseResult<PdfRenderInput> {
  const b = (body ?? {}) as Record<string, unknown>;
  const html = b.html;
  const requestedOutput = (b.output ?? "pdf").toString().toLowerCase();
  const normalizedOutput =
    requestedOutput === "jpg"
      ? "jpeg"
      : requestedOutput === "png"
        ? "png"
        : requestedOutput;

  if (!html || typeof html !== "string" || !html.trim()) {
    return fail(400, { error: "Provide `html` as a non-empty string." });
  }

  if (
    normalizedOutput !== "pdf" &&
    normalizedOutput !== "png" &&
    normalizedOutput !== "jpeg"
  ) {
    return fail(400, {
      error: "Invalid `output`. Use `pdf`, `png`, or `jpeg`.",
    });
  }

  const safeBase = sanitizeFilename(typeof b.filename === "string" ? b.filename : "");
  const outFilename = `${safeBase}.${normalizedOutput === "jpeg" ? "jpg" : normalizedOutput}`;

  const waitUntilValue = (b.waitUntil ?? "networkidle0").toString();
  const waitUntil = (PDF_WAIT_UNTIL as readonly string[]).includes(waitUntilValue)
    ? (waitUntilValue as (typeof PDF_WAIT_UNTIL)[number])
    : "networkidle0";

  const requestedScale = typeof b.scale === "number" ? b.scale : DEFAULT_PDF_VIEWPORT.scale;
  const scale = Math.min(
    DEFAULT_PDF_VIEWPORT.maxScale,
    Math.max(DEFAULT_PDF_VIEWPORT.minScale, requestedScale),
  );

  const viewportWidth =
    typeof b.viewportWidth === "number" ? b.viewportWidth : DEFAULT_PDF_VIEWPORT.width;
  const viewportHeight =
    typeof b.viewportHeight === "number" ? b.viewportHeight : DEFAULT_PDF_VIEWPORT.height;

  const fullPage = b.fullPage !== undefined ? Boolean(b.fullPage) : true;

  return ok({
    html,
    output: normalizedOutput,
    filename: safeBase,
    waitUntil,
    viewportWidth,
    viewportHeight,
    fullPage,
    scale,
    outFilename,
  });
}
