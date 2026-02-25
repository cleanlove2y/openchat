import { notFound } from "next/navigation";
import { I18nProvider } from "@/components/providers/i18n-provider";
import { SUPPORTED_LOCALES } from "@/lib/i18n/config";
import { isSupportedLocale } from "@/lib/i18n/routing";

export function generateStaticParams() {
  return SUPPORTED_LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) {
    notFound();
  }

  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}
