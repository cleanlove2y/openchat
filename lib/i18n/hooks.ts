"use client";

import { useTranslation } from "react-i18next";
import type { I18nNamespace } from "./resources";

export function useAppTranslation(ns?: I18nNamespace | I18nNamespace[]) {
  return useTranslation(ns);
}
