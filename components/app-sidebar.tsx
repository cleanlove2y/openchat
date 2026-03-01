"use client";

import { SquarePen } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { User } from "next-auth";
import { getSidebarPrimaryRoutes } from "@/components/app-sidebar-nav";
import { SidebarHistory } from "@/components/sidebar-history";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { SidebarUserNav } from "@/components/sidebar-user-nav";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAppTranslation } from "@/lib/i18n/hooks";
import { localizePathFromPathname } from "@/lib/i18n/navigation";

export function AppSidebar({ user }: { user: User | undefined }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useAppTranslation(["sidebar", "common"]);
  const { setOpenMobile } = useSidebar();
  const primaryRoutes = getSidebarPrimaryRoutes(pathname, t("tooltip.newChat"));

  return (
    <Sidebar className="group-data-[side=left]:border-r-0" collapsible="icon">
      <SidebarHeader className="bg-sidebar">
        <div className="flex flex-row items-center justify-between h-9 px-1">
          <Link
            className="flex min-w-0 flex-1 flex-row items-center gap-2 group-data-[collapsible=icon]:hidden pl-2"
            href={localizePathFromPathname(pathname, "/")}
            onClick={() => {
              setOpenMobile(false);
            }}
          >
            <span className="truncate font-semibold text-lg hover:text-sidebar-accent-foreground/80 transition-colors">
              OpenChat
            </span>
          </Link>
          <div className="flex items-center justify-center shrink-0 group-data-[collapsible=icon]:w-full transition-all">
            <SidebarToggle />
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-2 pt-2 pb-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {primaryRoutes.map((route) => (
                <SidebarMenuItem key={route.href}>
                  <SidebarMenuButton
                    className="h-9 rounded-lg px-3 font-medium"
                    isActive={route.isActive}
                    onClick={() => {
                      setOpenMobile(false);
                      router.push(route.href);

                      if (route.shouldRefresh) {
                        router.refresh();
                      }
                    }}
                    size="default"
                    tooltip={route.label}
                    type="button"
                    variant="default"
                  >
                    <SquarePen className="size-4" />
                    <span>{route.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarHistory user={user} />
      </SidebarContent>

      <SidebarFooter>{user && <SidebarUserNav user={user} />}</SidebarFooter>
    </Sidebar>
  );
}
