import type { NextRequest } from "next/server";
import { type AppLocale, FALLBACK_LOCALE, LOCALE_COOKIE_KEY } from "./config";

function localeFromAcceptLanguage(header: string | null): AppLocale | null {
  if (!header) {
    return null;
  }

  const weightedCandidates = header
    .split(",")
    .map((candidate, index) => {
      const [rawLanguage, ...params] = candidate.split(";");
      const language = rawLanguage?.trim().toLowerCase();

      if (!language) {
        return null;
      }

      let locale: AppLocale | null = null;

      if (language.startsWith("zh")) {
        locale = "zh";
      } else if (language.startsWith("en")) {
        locale = "en";
      }

      if (!locale) {
        return null;
      }

      let quality = 1;

      for (const param of params) {
        const trimmed = param.trim().toLowerCase();

        if (!trimmed.startsWith("q=")) {
          continue;
        }

        const parsed = Number.parseFloat(trimmed.slice(2));

        if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
          quality = parsed;
        } else {
          quality = 0;
        }

        break;
      }

      return { locale, quality, index };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> =>
      Boolean(candidate)
    )
    .sort((a, b) => {
      if (b.quality !== a.quality) {
        return b.quality - a.quality;
      }

      return a.index - b.index;
    });

  return weightedCandidates[0]?.locale ?? null;
}

export function detectRequestLocale(request: NextRequest): AppLocale {
  const fromCookie = request.cookies.get(LOCALE_COOKIE_KEY)?.value;

  if (fromCookie === "zh" || fromCookie === "en") {
    return fromCookie;
  }

  return (
    localeFromAcceptLanguage(request.headers.get("accept-language")) ??
    FALLBACK_LOCALE
  );
}
