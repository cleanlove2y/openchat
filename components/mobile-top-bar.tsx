"use client";

import { SidebarToggle } from "@/components/sidebar-toggle";
import { cn } from "@/lib/utils";

export const mobileTopBarClassName =
  "sticky top-0 z-20 flex h-14 shrink-0 items-center bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden";

export function MobileTopBar({ className }: { className?: string }) {
  return (
    <header className={cn(mobileTopBarClassName, className)}>
      <div className="-ml-2 flex items-center shrink-0">
        <SidebarToggle />
      </div>
      <span className="ml-2 font-semibold text-[17px] tracking-tight text-sidebar-foreground/90">
        OpenChat
      </span>
    </header>
  );
}
