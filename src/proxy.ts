import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createMiddleware(routing);

const PROTECTED_PREFIX = /^\/(th|en)\/app(\/|$)/;

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PROTECTED_PREFIX.test(pathname)) {
    const hasAccess = Boolean(request.cookies.get("ws_access")?.value);
    const hasRefresh = Boolean(request.cookies.get("ws_refresh")?.value);
    if (!hasAccess && !hasRefresh) {
      const locale = pathname.startsWith("/en") ? "en" : "th";
      const loginUrl = new URL(`/${locale}/login`, request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: "/((?!api|_next|_vercel|.*\\..*).*)",
};
