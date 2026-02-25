"use client";

import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { type AppLocale, FALLBACK_LOCALE } from "./config";
import { i18nNamespaces, i18nResources } from "./resources";

export function createI18nInstance(locale: AppLocale) {
  const instance = createInstance();

  instance.use(initReactI18next).init({
    resources: i18nResources,
    lng: locale,
    fallbackLng: FALLBACK_LOCALE,
    defaultNS: "common",
    ns: i18nNamespaces,
    interpolation: {
      escapeValue: false,
    },
    keySeparator: false,
    initImmediate: false,
  });

  return instance;
}
