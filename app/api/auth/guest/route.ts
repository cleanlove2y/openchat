import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { signIn } from "@/lib/server/auth/core";
import { isDevelopmentEnvironment } from "@/lib/constants";
import { FALLBACK_LOCALE } from "@/lib/i18n/config";
import { getLocaleFromPathname, withLocalePath } from "@/lib/i18n/routing";
import { createApiRoute } from "@/lib/logging/route-factory";

function resolveLocalizedHome(
  redirectUrl: string | null,
  requestUrl: string
): string {
  if (!redirectUrl) {
    return withLocalePath(FALLBACK_LOCALE, "/");
  }

  try {
    const parsedRedirect = new URL(redirectUrl, requestUrl);
    const localeFromRedirect = getLocaleFromPathname(parsedRedirect.pathname);

    return withLocalePath(localeFromRedirect ?? FALLBACK_LOCALE, "/");
  } catch {
    return withLocalePath(FALLBACK_LOCALE, "/");
  }
}

const getHandler = async ({ request }: { request: Request }) => {
  const { searchParams } = new URL(request.url);
  const redirectUrl = searchParams.get("redirectUrl") || "/";

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  if (token) {
    const homePath = resolveLocalizedHome(redirectUrl, request.url);
    return NextResponse.redirect(new URL(homePath, request.url));
  }

  return signIn("guest", { redirect: true, redirectTo: redirectUrl });
};

export const GET = createApiRoute({
  route: "/api/auth/guest",
  method: "GET",
  audit: {
    action: "auth.guest_signin",
    resourceType: "session",
    getMetadata: (requestForAudit) => {
      const redirectUrl =
        new URL(requestForAudit.url).searchParams.get("redirectUrl") ?? "/";
      return {
        redirectUrlLength: redirectUrl.length,
      };
    },
  },
  handler: getHandler,
});

