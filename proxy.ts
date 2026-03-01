import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { guestRegex, isDevelopmentEnvironment } from "./lib/constants";
import { type AppLocale, LOCALE_COOKIE_KEY } from "./lib/i18n/config";
import { detectRequestLocale } from "./lib/i18n/detector";
import {
  getLocaleFromPathname,
  stripLocalePrefix,
  withLocalePath,
} from "./lib/i18n/routing";

const PUBLIC_FILE_REGEX = /\.[^/]+$/;
const SEGMENT_SCOPED_METADATA_FILE_REGEX =
  /^(?:opengraph-image|twitter-image|icon\d*|apple-icon\d*)(?:\.(?:ico|jpg|jpeg|png|gif|svg|txt))?$/i;
const PUBLIC_AUTH_PATHS = new Set(["/login", "/register"]);

function isSegmentScopedMetadataFile(pathname: string): boolean {
  const filename = pathname.split("/").at(-1);

  if (!filename) {
    return false;
  }

  return SEGMENT_SCOPED_METADATA_FILE_REGEX.test(filename);
}

function setLocaleCookie(response: NextResponse, locale: AppLocale) {
  response.cookies.set(LOCALE_COOKIE_KEY, locale, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const localeFromPath = getLocaleFromPathname(pathname);
  const normalizedPathname = localeFromPath
    ? stripLocalePrefix(pathname)
    : pathname;

  /*
   * Playwright starts the dev server and requires a 200 status to
   * begin the tests, so this ensures that the tests can start
   */
  if (normalizedPathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (PUBLIC_FILE_REGEX.test(normalizedPathname)) {
    if (localeFromPath && !isSegmentScopedMetadataFile(pathname)) {
      return NextResponse.redirect(
        new URL(`${normalizedPathname}${search}`, request.url)
      );
    }

    return NextResponse.next();
  }

  if (normalizedPathname.startsWith("/api/")) {
    if (localeFromPath) {
      return NextResponse.redirect(
        new URL(`${normalizedPathname}${search}`, request.url)
      );
    }

    if (normalizedPathname.startsWith("/api/auth")) {
      return NextResponse.next();
    }

    const token = await getToken({
      req: request,
      secret: process.env.AUTH_SECRET,
      secureCookie: !isDevelopmentEnvironment,
    });

    if (!token) {
      const redirectUrl = encodeURIComponent(request.url);

      return NextResponse.redirect(
        new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
      );
    }

    return NextResponse.next();
  }

  const resolvedLocale = localeFromPath ?? detectRequestLocale(request);

  if (!localeFromPath) {
    const localizedPathname = withLocalePath(resolvedLocale, pathname);

    if (localizedPathname === pathname) {
      return NextResponse.next();
    }

    const response = NextResponse.redirect(
      new URL(`${localizedPathname}${search}`, request.url)
    );

    setLocaleCookie(response, resolvedLocale);
    return response;
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  if (!token) {
    if (PUBLIC_AUTH_PATHS.has(normalizedPathname)) {
      const response = NextResponse.next();
      setLocaleCookie(response, resolvedLocale);
      return response;
    }

    const redirectUrl = encodeURIComponent(request.url);

    const response = NextResponse.redirect(
      new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
    );
    setLocaleCookie(response, resolvedLocale);
    return response;
  }

  const isGuest = guestRegex.test(token?.email ?? "");

  if (
    token &&
    !isGuest &&
    ["/login", "/register"].includes(normalizedPathname)
  ) {
    const response = NextResponse.redirect(
      new URL(withLocalePath(resolvedLocale, "/"), request.url)
    );
    setLocaleCookie(response, resolvedLocale);
    return response;
  }

  const response = NextResponse.next();
  setLocaleCookie(response, resolvedLocale);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next (internal assets and HMR endpoints)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!_next|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
