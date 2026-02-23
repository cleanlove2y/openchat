import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { signIn } from "@/app/(auth)/auth";
import { isDevelopmentEnvironment } from "@/lib/constants";
import { createApiRoute } from "@/lib/logging/route-factory";

const getHandler = async ({ request }: { request: Request }) => {
  const { searchParams } = new URL(request.url);
  const redirectUrl = searchParams.get("redirectUrl") || "/";

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  if (token) {
    return NextResponse.redirect(new URL("/", request.url));
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
