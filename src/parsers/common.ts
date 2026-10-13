/** Result of parsing request input; controllers map failures to HTTP responses */

export type ParseOk<T> = { ok: true; data: T };
export type ParseFail = { ok: false; status: number; body: object };
export type ParseResult<T> = ParseOk<T> | ParseFail;

export function ok<T>(data: T): ParseOk<T> {
  return { ok: true, data };
}

export function fail(status: number, body: object): ParseFail {
  return { ok: false, status, body };
}

export function requireTrimmedString(value: unknown, fieldLabel: string): ParseResult<string> {
  if (typeof value !== "string" || !value.trim()) {
    return fail(400, {
      success: false,
      error: {
        code: "INVALID_BODY",
        message: `${fieldLabel} is required`,
      },
    });
  }
  return ok(value.trim());
}
