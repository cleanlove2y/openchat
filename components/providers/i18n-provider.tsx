"use client";

import { useEffect, useMemo } from "react";
import { I18nextProvider } from "react-i18next";
import type { AppLocale } from "@/lib/i18n/config";
import { createI18nInstance } from "@/lib/i18n/client";

export function I18nProvider({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale: AppLocale;
}) {
  const i18n = useMemo(() => createI18nInstance(locale), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
