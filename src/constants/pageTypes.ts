import type { WebsitePageType } from "../services/website/types.js";

export type PageTypeDefinition = {
  type: Exclude<WebsitePageType, "custom">;
  /** Human-readable labels and synonyms used to classify pageRequest text. */
  aliases: string[];
  /** Likely pathnames relative to the website origin. */
  pathPatterns: string[];
  /** Extra keywords that strengthen link scoring later. */
  keywords: string[];
};

/**
 * Catalog of known legal/policy page types.
 * Aliases and URL patterns live here so discovery code does not hard-code them.
 */
export const PAGE_TYPE_CATALOG: PageTypeDefinition[] = [
  {
    type: "privacy_policy",
    aliases: [
      "privacy policy",
      "privacy notice",
      "privacy statement",
      "privacy",
      "data privacy",
      "data protection",
      "gdpr",
    ],
    pathPatterns: [
      "/privacy",
      "/privacy-policy",
      "/privacy_policy",
      "/privacy-notice",
      "/privacy-statement",
      "/legal/privacy",
      "/legal/privacy-policy",
      "/policies/privacy",
      "/en/privacy",
      "/en/privacy-policy",
    ],
    keywords: ["privacy", "personal data", "data protection", "gdpr"],
  },
  {
    type: "terms_of_service",
    aliases: [
      "terms of service",
      "tos",
      "terms of use",
      "user agreement",
      "service terms",
    ],
    pathPatterns: [
      "/terms-of-service",
      "/terms_of_service",
      "/terms-of-use",
      "/tos",
      "/legal/terms-of-service",
      "/legal/terms-of-use",
      "/en/terms-of-service",
    ],
    keywords: ["terms of service", "tos", "terms of use"],
  },
  {
    type: "terms_and_conditions",
    aliases: [
      "terms and conditions",
      "terms & conditions",
      "terms and condition",
      "t&c",
      "tnc",
      "terms",
    ],
    pathPatterns: [
      "/terms",
      "/terms-and-conditions",
      "/terms_and_conditions",
      "/legal/terms",
      "/legal/terms-and-conditions",
      "/policies/terms",
      "/en/terms",
      "/en/terms-and-conditions",
    ],
    keywords: ["terms", "conditions", "agreement"],
  },
  {
    type: "cookie_policy",
    aliases: [
      "cookie policy",
      "cookies policy",
      "cookie notice",
      "cookies",
      "cookie preferences",
    ],
    pathPatterns: [
      "/cookies",
      "/cookie-policy",
      "/cookie_policy",
      "/cookies-policy",
      "/legal/cookies",
      "/legal/cookie-policy",
      "/policies/cookies",
    ],
    keywords: ["cookie", "cookies", "tracking"],
  },
  {
    type: "refund_policy",
    aliases: ["refund policy", "refunds", "money back", "money-back"],
    pathPatterns: [
      "/refund",
      "/refunds",
      "/refund-policy",
      "/refund_policy",
      "/legal/refund",
      "/policies/refund",
    ],
    keywords: ["refund", "refunds", "money back"],
  },
  {
    type: "return_policy",
    aliases: ["return policy", "returns", "returns policy", "exchange policy"],
    pathPatterns: [
      "/returns",
      "/return-policy",
      "/return_policy",
      "/returns-policy",
      "/legal/returns",
      "/policies/returns",
    ],
    keywords: ["return", "returns", "exchange"],
  },
  {
    type: "shipping_policy",
    aliases: [
      "shipping policy",
      "shipping",
      "delivery policy",
      "shipping and delivery",
    ],
    pathPatterns: [
      "/shipping",
      "/shipping-policy",
      "/shipping_policy",
      "/delivery",
      "/delivery-policy",
      "/legal/shipping",
      "/policies/shipping",
    ],
    keywords: ["shipping", "delivery", "fulfillment"],
  },
  {
    type: "security_policy",
    aliases: [
      "security policy",
      "security",
      "information security",
      "security practices",
    ],
    pathPatterns: [
      "/security",
      "/security-policy",
      "/security_policy",
      "/legal/security",
      "/policies/security",
      "/trust",
      "/trust-center",
    ],
    keywords: ["security", "encryption", "trust"],
  },
  {
    type: "acceptable_use_policy",
    aliases: [
      "acceptable use policy",
      "acceptable use",
      "aup",
      "use policy",
      "fair use policy",
    ],
    pathPatterns: [
      "/acceptable-use",
      "/acceptable-use-policy",
      "/aup",
      "/legal/acceptable-use",
      "/policies/acceptable-use",
    ],
    keywords: ["acceptable use", "aup", "prohibited"],
  },
  {
    type: "about",
    aliases: ["about", "about us", "about page", "company", "our company"],
    pathPatterns: ["/about", "/about-us", "/about_us", "/company", "/en/about"],
    keywords: ["about", "company", "mission"],
  },
  {
    type: "pricing",
    aliases: ["pricing", "pricing page", "plans", "pricing plans", "cost"],
    pathPatterns: [
      "/pricing",
      "/plans",
      "/price",
      "/pricing-plans",
      "/en/pricing",
    ],
    keywords: ["pricing", "plans", "price"],
  },
  {
    type: "contact",
    aliases: ["contact", "contact us", "contact page", "support contact"],
    pathPatterns: [
      "/contact",
      "/contact-us",
      "/contact_us",
      "/support",
      "/en/contact",
    ],
    keywords: ["contact", "email", "support"],
  },
];

/** All catalog types plus custom — used by LLM allow-lists. */
export const WEBSITE_PAGE_TYPES: WebsitePageType[] = [
  ...PAGE_TYPE_CATALOG.map((entry) => entry.type),
  "custom",
];

/** Normalize free text for alias matching. */
export function normalizePageRequestText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole-phrase match on normalized text (exact or bounded by spaces). */
export function containsNormalizedPhrase(
  haystack: string,
  needle: string,
): boolean {
  if (!haystack || !needle) return false;
  return (
    haystack === needle ||
    haystack.startsWith(`${needle} `) ||
    haystack.endsWith(` ${needle}`) ||
    haystack.includes(` ${needle} `)
  );
}
