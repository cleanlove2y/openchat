import authEn from "@/locales/en/auth.json";
import chatEn from "@/locales/en/chat.json";
import commonEn from "@/locales/en/common.json";
import sidebarEn from "@/locales/en/sidebar.json";
import authZh from "@/locales/zh/auth.json";
import chatZh from "@/locales/zh/chat.json";
import commonZh from "@/locales/zh/common.json";
import sidebarZh from "@/locales/zh/sidebar.json";

export const i18nResources = {
  en: {
    auth: authEn,
    chat: chatEn,
    common: commonEn,
    sidebar: sidebarEn,
  },
  zh: {
    auth: authZh,
    chat: chatZh,
    common: commonZh,
    sidebar: sidebarZh,
  },
} as const;

export const i18nNamespaces = ["common", "auth", "chat", "sidebar"] as const;

export type I18nNamespace = (typeof i18nNamespaces)[number];
