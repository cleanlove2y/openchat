const DEFAULT_REDIRECT_TO = "/";

export function resolveAuthRedirectTo(formData: FormData): string {
  const redirectTo = formData.get("redirectTo");

  if (typeof redirectTo !== "string") {
    return DEFAULT_REDIRECT_TO;
  }

  if (!redirectTo.startsWith("/") || redirectTo.startsWith("//")) {
    return DEFAULT_REDIRECT_TO;
  }

  return redirectTo;
}
