import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UrlRejectedError extends Error {
  readonly reason: "invalid" | "credentials" | "protocol" | "host" | "address" | "dns";

  constructor(message: string, reason: UrlRejectedError["reason"] = "invalid") {
    super(message);
    this.name = "UrlRejectedError";
    this.reason = reason;
  }
}

/**
 * Accept only http(s) URLs whose host resolves to a public address.
 * Rejects loopback, private, link-local, and metadata targets.
 */
export async function assertPublicHttpUrl(raw: string | URL): Promise<URL> {
  let url: URL;
  if (typeof raw === "string") {
    try {
      url = new URL(raw);
    } catch {
      throw new UrlRejectedError("URL is not valid", "invalid");
    }
  } else {
    url = raw;
  }

  if (url.username || url.password) {
    throw new UrlRejectedError("URLs with credentials are not allowed", "credentials");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlRejectedError("Only http and https URLs are allowed", "protocol");
  }

  const hostname = normalizedHostname(url);
  if (!hostname) {
    throw new UrlRejectedError("URL is missing a host", "host");
  }
  if (isBlockedHostname(hostname)) {
    throw new UrlRejectedError("That host is not allowed", "host");
  }

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new UrlRejectedError("That address is not allowed", "address");
    }
    return url;
  }

  if (/^[\d.]+$/.test(hostname) || /^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname)) {
    throw new UrlRejectedError("That address is not allowed", "address");
  }

  let records: { address: string }[];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UrlRejectedError("Could not resolve host", "dns");
  }
  if (records.length === 0) {
    throw new UrlRejectedError("Could not resolve host", "dns");
  }
  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new UrlRejectedError("That host resolves to a non-public address", "address");
    }
  }

  return url;
}

/**
 * Approximate eTLD+1 (registrable domain).
 * Handles common multi-part suffixes (co.uk, com.au, …); not a full PSL.
 */
export function registrableDomain(raw: string | URL): string {
  const hostname =
    typeof raw === "string" ? normalizedHostname(new URL(raw)) : normalizedHostname(raw);
  if (!hostname) return "";
  if (isIP(hostname)) return hostname;

  const parts = hostname.split(".").filter(Boolean);
  if (parts.length <= 1) return hostname;

  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_TLDS.includes(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/** Common multi-part public suffixes used for registrable-domain checks. */
const MULTI_PART_TLDS = [
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "co.jp",
  "co.kr",
  "com.br",
  "com.mx",
  "co.in",
  "com.sg",
  "com.hk",
  "com.ng",
  "com.gh",
  "com.ke",
  "co.za",
  "com.eg",
];

export function normalizedHostname(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

export function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  );
}

function isBlockedIp(address: string): boolean {
  const normalized = address.toLowerCase();

  if (normalized.startsWith("::ffff:")) {
    const tail = normalized.slice("::ffff:".length);
    if (isIP(tail) === 4) return isBlockedIPv4(tail);
    const mapped = hexMappedToIpv4(tail);
    if (mapped) return isBlockedIPv4(mapped);
    return true;
  }

  if (isIP(normalized) === 4) return isBlockedIPv4(normalized);
  if (normalized.includes(".")) return true;
  return isBlockedIPv6(normalized);
}

function hexMappedToIpv4(tail: string): string | null {
  const match = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!match?.[1] || !match[2]) return null;
  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  if (ip === "::" || ip === "::1") return true;
  const hextets = expandHextets(ip);
  if (!hextets) return true;
  const first = hextets[0] ?? 0;
  const second = hextets[1] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xffc0) === 0xfec0) return true;
  if ((first & 0xff00) === 0xff00) return true;
  if (first === 0x2001 && second === 0x0db8) return true;
  return false;
}

function expandHextets(ip: string): number[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const parse = (value: string): number[] | null => {
    if (!value) return [];
    const parts = value.split(":");
    const numbers: number[] = [];
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
      numbers.push(Number.parseInt(part, 16));
    }
    return numbers;
  };
  const left = parse(halves[0] ?? "");
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const right = parse(halves[1] ?? "");
  if (!right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  return [...left, ...Array.from({ length: missing }, () => 0), ...right];
}
