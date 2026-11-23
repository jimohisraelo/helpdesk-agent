import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time check of an "Authorization: Bearer <token>" header.
 * Both sides are hashed first so the comparison never leaks the token's length.
 */
export function tokenMatches(header: string | undefined, expected: string): boolean {
  const given = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!given || !expected) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
