import { type AppLocale, FALLBACK_LOCALE, SUPPORTED_LOCALES } from "./config";

const localeSet = new Set<string>(SUPPORTED_LOCALES);

export function isSupportedLocale(value: string): value is AppLocale {
  return localeSet.has(value);
}

export function getLocaleFromPathname(
  pathname: string | null | undefined
): AppLocale | null {
  if (!pathname) {
    return null;
  }

  const [, maybeLocale] = pathname.split("/");
  if (!maybeLocale) {
    return null;
  }

  return isSupportedLocale(maybeLocale) ? maybeLocale : null;
}

export function getLocaleOrFallback(
  pathname: string | null | undefined
): AppLocale {
  return getLocaleFromPathname(pathname) ?? FALLBACK_LOCALE;
}

export function stripLocalePrefix(pathname: string): string {
  const locale = getLocaleFromPathname(pathname);

  if (!locale) {
    return pathname;
  }

  const stripped = pathname.slice(locale.length + 1);

  if (!stripped) {
    return "/";
  }

  return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

function normalizePath(path: string): string {
  if (!path) {
    return "/";
  }

  return path.startsWith("/") ? path : `/${path}`;
}

export function withLocalePath(locale: AppLocale, path: string): string {
  const normalized = normalizePath(path);

  if (
    normalized.startsWith("/api") ||
    normalized.startsWith("/_next") ||
    normalized === "/favicon.ico" ||
    normalized === "/sitemap.xml" ||
    normalized === "/robots.txt"
  ) {
    return normalized;
  }

  if (getLocaleFromPathname(normalized)) {
    return normalized;
  }

  if (normalized === "/") {
    return `/${locale}`;
  }

  return `/${locale}${normalized}`;
}
