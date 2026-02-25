export const SUPPORTED_LOCALES = ["zh", "en"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const FALLBACK_LOCALE: AppLocale = "zh";

export const LOCALE_COOKIE_KEY = "OPENCHAT_LOCALE";
