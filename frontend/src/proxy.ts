import { NextResponse, type NextRequest } from "next/server"

const SESSION_COOKIE = "sentra_session"

/**
 * Pages inside the app need a session cookie; without one the browser goes to the login
 * page. This is only a quick first check: the API verifies every session (NFR-3.3).
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next()

  const login = new URL("/login", request.url)
  const next = request.nextUrl.pathname + request.nextUrl.search
  if (next !== "/") login.searchParams.set("next", next)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: [
    "/((?!login|register|verify-email|forgot-password|reset-password|invitations|_next/static|_next/image|icon.svg|robots.txt).*)",
  ],
}
