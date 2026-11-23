import { describe, expect, it } from "vitest";
import { tokenMatches } from "../src/auth.js";

describe("tokenMatches", () => {
  it("accepts the right bearer token", () => {
    expect(tokenMatches("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("rejects a wrong token, a missing header and a non-bearer header", () => {
    expect(tokenMatches("Bearer nope", "s3cret")).toBe(false);
    expect(tokenMatches(undefined, "s3cret")).toBe(false);
    expect(tokenMatches("s3cret", "s3cret")).toBe(false);
  });

  it("rejects an empty token even if the expected one is empty", () => {
    expect(tokenMatches("Bearer ", "")).toBe(false);
  });
});
