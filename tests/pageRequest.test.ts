import { describe, expect, it } from "vitest";
import { classifyPageRequest } from "../src/services/website/pageRequest.service.js";

describe("classifyPageRequest", () => {
  it("matches known aliases to catalog types", () => {
    expect(classifyPageRequest("Privacy Policy").type).toBe("privacy_policy");
    expect(classifyPageRequest("terms of service").type).toBe("terms_of_service");
    expect(classifyPageRequest("cookie notice").type).toBe("cookie_policy");
  });

  it("prefers longer aliases over shorter ones", () => {
    const classified = classifyPageRequest("terms and conditions");
    expect(classified.type).toBe("terms_and_conditions");
    expect(classified.matchedAlias).toBe("terms and conditions");
  });

  it("falls back to custom for unknown requests", () => {
    const classified = classifyPageRequest("retention policies");
    expect(classified.type).toBe("custom");
    expect(classified.definition).toBeNull();
    expect(classified.matchedAlias).toBeNull();
  });
});
