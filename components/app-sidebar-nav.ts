import { localizePathFromPathname } from "@/lib/i18n/navigation";
import { stripLocalePrefix } from "@/lib/i18n/routing";

export type SidebarPrimaryRoute = {
  href: string;
  isActive: boolean;
  label: string;
  shouldRefresh: boolean;
};

export function getSidebarPrimaryRoutes(
  pathname: string,
  newChatLabel: string
): SidebarPrimaryRoute[] {
  const normalizedPathname = stripLocalePrefix(pathname);

  return [
    {
      href: localizePathFromPathname(pathname, "/"),
      isActive: normalizedPathname === "/",
      label: newChatLabel,
      shouldRefresh: true,
    },
  ];
}
