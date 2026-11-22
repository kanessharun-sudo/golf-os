import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/** Paths that need a signed-in user. Role checks happen in the route-group layouts. */
const PROTECTED_PREFIXES = ["/caddy", "/admin", "/rounds", "/account", "/bookings", "/checkout"] as const;

export async function middleware(request: NextRequest) {
  // The front page is a static file and needs no session.
  if (request.nextUrl.pathname === "/") return NextResponse.next();

  const { response, user } = await updateSession(request);
  const { pathname, search } = request.nextUrl;

  const needsAuth = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (needsAuth && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|images/|landing/|api/webhooks/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif)$).*)"],
};
