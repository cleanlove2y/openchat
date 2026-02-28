"use client";

import {
  ChevronUp,
  Languages,
  LogIn,
  LogOut,
  Moon,
  Settings,
  Sun,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { User } from "next-auth";
import { signOut, useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { guestRegex } from "@/lib/constants";
import { useAppTranslation } from "@/lib/i18n/hooks";
import {
  localeFromPathname,
  localizePathFromPathname,
} from "@/lib/i18n/navigation";
import { stripLocalePrefix, withLocalePath } from "@/lib/i18n/routing";
import { LoaderIcon } from "./icons";
import { toast } from "./toast";

export function SidebarUserNav({ user }: { user: User }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useAppTranslation(["sidebar", "common"]);
  const { data, status } = useSession();
  const { setTheme, resolvedTheme } = useTheme();
  const currentPathname = pathname ?? "/";

  const isGuest = guestRegex.test(data?.user?.email ?? "");
  const currentLocale = localeFromPathname(currentPathname);
  const nextLocale = currentLocale === "zh" ? "en" : "zh";

  const handleLanguageSwitch = () => {
    const normalizedPath = stripLocalePrefix(currentPathname);
    const targetPath = withLocalePath(nextLocale, normalizedPath);
    const query = searchParams.toString();

    router.push(query ? `${targetPath}?${query}` : targetPath);
  };

  return (
    <>
      {user.type === "regular" && (
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link
                href={localizePathFromPathname(currentPathname, "/settings")}
              >
                <Settings className="size-4" />
                <span>{t("nav.settings")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      )}
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {status === "loading" ? (
                <SidebarMenuButton className="h-10 justify-between bg-background data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                  <div className="flex flex-row gap-2">
                    <div className="size-6 animate-pulse rounded-full bg-zinc-500/30" />
                    <span className="animate-pulse rounded-md bg-zinc-500/30 text-transparent">
                      {t("user.loadingAuthStatus")}
                    </span>
                  </div>
                  <div className="animate-spin text-zinc-500">
                    <LoaderIcon />
                  </div>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton
                  className="h-10 bg-background data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  data-testid="user-nav-button"
                >
                  <Image
                    alt={user.email ?? t("user.avatarAlt")}
                    className="rounded-full"
                    height={24}
                    src={`https://avatar.vercel.sh/${user.email}`}
                    width={24}
                  />
                  <span className="truncate" data-testid="user-email">
                    {isGuest ? t("user.guest") : user?.email}
                  </span>
                  <ChevronUp className="ml-auto" />
                </SidebarMenuButton>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-popper-anchor-width)"
              data-testid="user-nav-menu"
              side="top"
            >
              <DropdownMenuItem
                className="flex cursor-pointer gap-2"
                data-testid="user-nav-item-theme"
                onSelect={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
              >
                {resolvedTheme === "light" ? (
                  <Moon className="size-4" />
                ) : (
                  <Sun className="size-4" />
                )}
                {t("user.toggleTheme", {
                  mode:
                    resolvedTheme === "light"
                      ? t("common:theme.dark")
                      : t("common:theme.light"),
                })}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex cursor-pointer gap-2"
                data-testid="user-nav-item-language"
                onSelect={handleLanguageSwitch}
              >
                <Languages className="size-4" />
                {t("common:locale.switchTo", {
                  locale: t(`common:locale.${nextLocale}`),
                })}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild data-testid="user-nav-item-auth">
                <button
                  className="flex w-full cursor-pointer items-center gap-2"
                  onClick={() => {
                    if (status === "loading") {
                      toast({
                        type: "error",
                        description: t("user.authChecking"),
                      });

                      return;
                    }

                    if (isGuest) {
                      router.push(
                        localizePathFromPathname(currentPathname, "/login")
                      );
                    } else {
                      signOut({
                        redirectTo: localizePathFromPathname(
                          currentPathname,
                          "/"
                        ),
                      });
                    }
                  }}
                  type="button"
                >
                  {isGuest ? (
                    <LogIn className="size-4" />
                  ) : (
                    <LogOut className="size-4" />
                  )}
                  {isGuest ? t("user.login") : t("user.signOut")}
                </button>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
