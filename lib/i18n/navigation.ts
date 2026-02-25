import { type AppLocale, FALLBACK_LOCALE } from "./config";
import { getLocaleFromPathname, withLocalePath } from "./routing";

export function localeFromPathname(pathname: string | null): AppLocale {
  return getLocaleFromPathname(pathname) ?? FALLBACK_LOCALE;
}

export function localizePathFromPathname(
  pathname: string | null,
  path: string
): string {
  return withLocalePath(localeFromPathname(pathname), path);
}
