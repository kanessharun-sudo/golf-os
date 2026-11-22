/**
 * Accepts only same-origin relative paths so ?next= cannot become an open
 * redirect ("//evil.com", "/\\evil.com", "https://…").
 */
export function safeNextPath(next: string | null | undefined, fallback = "/courses"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
