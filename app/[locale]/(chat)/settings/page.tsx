import { redirect } from "next/navigation";
import { ConnectionsManagementCard } from "@/components/settings/connections-management-card";
import { isSupportedLocale, withLocalePath } from "@/lib/i18n/routing";
import { auth } from "@/lib/server/auth/core";

type PageProps = {
  params: Promise<{ locale?: string }>;
};

function localizedPath(locale: string | undefined, path: string): string {
  if (locale && isSupportedLocale(locale)) {
    return withLocalePath(locale, path);
  }

  return path;
}

export default async function SettingsPage({ params }: PageProps) {
  const { locale } = await params;
  const session = await auth();

  if (!session?.user || session.user.type !== "regular") {
    redirect(localizedPath(locale, "/"));
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 md:px-6">
      <ConnectionsManagementCard />
    </div>
  );
}
