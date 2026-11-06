import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * First line of defence only: a visitor with no session cookie is sent to the sign-in page before
 * any screen renders. The API is the real gate (it checks the cookie's signature, the user and
 * their permissions on every request), so a forged cookie gets a login page, not data.
 *
 * Signed-in visitors are NOT redirected away from /login here: an expired cookie would loop.
 * The sign-in page checks the session itself and forwards valid ones.
 */
const SESSION_COOKIE = "cq_session";
const PUBLIC_PATHS = ["/login", "/gallery", "/status"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the API rewrite, Next's own files and public assets.
  matcher: [
    "/((?!api|_next/static|_next/image|brand|hero|favicon.ico|.*\\.(?:svg|png|jpg|webp|ico)$).*)",
  ],
};
