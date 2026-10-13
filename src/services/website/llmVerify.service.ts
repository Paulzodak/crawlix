import type OpenAI from "openai";
import { WEBSITE_PAGE_TYPES } from "../../constants/pageTypes.js";
import { config } from "../../config/index.js";
import type { ExtractedCandidatePage } from "./contentExtraction.service.js";
import { getOpenAIClient } from "./openai.client.js";
import type { ClassifiedPageRequest } from "./pageRequest.service.js";
import {
  WebsitePageError,
  type NormalizedWebsitePage,
  type WebsitePageType,
} from "./types.js";

const CONTENT_SNIPPET_CHARS = 6_000;
const MIN_MATCH_CONFIDENCE = 0.55;

type LlmVerifyVerdict = {
  isMatch: boolean;
  pageType: WebsitePageType;
  confidence: number;
  reason: string;
};

type VerifiedCandidate = {
  document: NormalizedWebsitePage;
  reason: string;
};

/**
 * Ask the LLM which extracted candidates match the user request.
 * Never invents URLs or content — only re-scores pages we already fetched.
 */
export async function verifyExtractedPages(
  classified: ClassifiedPageRequest,
  extracted: ExtractedCandidatePage[],
): Promise<NormalizedWebsitePage | null> {
  if (extracted.length === 0) return null;

  const client = getOpenAIClient();
  if (!client) {
    throw new WebsitePageError(
      "LLM_VERIFICATION_FAILED",
      "OpenAI API key is not configured",
    );
  }

  const matches: VerifiedCandidate[] = [];
  let scored = 0;
  let failed = 0;

  for (const entry of extracted) {
    try {
      const verdict = await verifyOne(client, classified, entry.document);
      scored += 1;
      if (!verdict.isMatch || verdict.confidence < MIN_MATCH_CONFIDENCE) {
        continue;
      }

      matches.push({
        document: {
          ...entry.document,
          type: verdict.pageType,
          confidence: verdict.confidence,
        },
        reason: verdict.reason,
      });
    } catch (error) {
      failed += 1;
      console.warn(
        `LLM verification failed for ${entry.document.url}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (matches.length === 0) {
    if (scored === 0 && failed > 0) {
      throw new WebsitePageError(
        "LLM_VERIFICATION_FAILED",
        "Could not verify candidate pages with the language model",
      );
    }
    return null;
  }

  matches.sort((a, b) => b.document.confidence - a.document.confidence);
  const winner = matches[0];
  if (!winner) return null;

  console.log(
    `llm-verify match url=${winner.document.url}` +
      ` type=${winner.document.type}` +
      ` confidence=${winner.document.confidence}` +
      ` reason=${winner.reason}`,
  );

  return winner.document;
}

async function verifyOne(
  client: OpenAI,
  classified: ClassifiedPageRequest,
  document: NormalizedWebsitePage,
): Promise<LlmVerifyVerdict> {
  const completion = await client.chat.completions.create({
    model: config.openai.model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You verify whether a fetched web page satisfies a user page request. " +
          "Use only the provided title, url, and content snippet. " +
          "Never invent URLs or claim content that is not present. " +
          "Reject cookie banners, login walls, homepages, unrelated policies, and challenge/interstitial pages. " +
          "Return strict JSON: " +
          '{"isMatch":boolean,"pageType":string,"confidence":number,"reason":string}. ' +
          `pageType must be one of: ${WEBSITE_PAGE_TYPES.join(", ")}. ` +
          "confidence must be between 0 and 1.",
      },
      {
        role: "user",
        content: JSON.stringify({
          request: classified.raw,
          expectedType: classified.type,
          page: {
            title: document.title,
            url: document.url,
            sourceUrl: document.sourceUrl,
            contentSnippet: document.content.slice(0, CONTENT_SNIPPET_CHARS),
            contentTruncated: document.content.length > CONTENT_SNIPPET_CHARS,
            lastUpdated: document.metadata.lastUpdated,
          },
        }),
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  return parseLlmVerifyVerdict(raw, classified.type);
}

/** Parse and validate the LLM verification JSON payload. */
export function parseLlmVerifyVerdict(
  raw: string,
  fallbackType: WebsitePageType,
): LlmVerifyVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WebsitePageError(
      "LLM_VERIFICATION_FAILED",
      "LLM returned invalid JSON",
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new WebsitePageError(
      "LLM_VERIFICATION_FAILED",
      "LLM returned an invalid verification payload",
    );
  }

  const obj = parsed as Record<string, unknown>;
  const isMatch = obj.isMatch === true;
  const reason =
    typeof obj.reason === "string" && obj.reason.trim()
      ? obj.reason.trim().slice(0, 500)
      : isMatch
        ? "Matched requested page"
        : "Not a match";

  return {
    isMatch,
    pageType: normalizePageType(obj.pageType, fallbackType),
    confidence: normalizeConfidence(obj.confidence, isMatch),
    reason,
  };
}

function normalizePageType(
  value: unknown,
  fallback: WebsitePageType,
): WebsitePageType {
  if (typeof value !== "string") return fallback;
  return WEBSITE_PAGE_TYPES.includes(value as WebsitePageType)
    ? (value as WebsitePageType)
    : fallback;
}

function normalizeConfidence(value: unknown, isMatch: boolean): number {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(raw)) {
    return isMatch ? MIN_MATCH_CONFIDENCE : 0;
  }

  const scaled = raw > 1 ? raw / 100 : raw;
  return Math.max(0, Math.min(1, Number(scaled.toFixed(2))));
}
