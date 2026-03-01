"use client";

import { Menu } from "lucide-react";
import type { ComponentProps } from "react";
import { type SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { SidebarLeftIcon } from "./icons";
import { Button } from "./ui/button";

export function SidebarToggle({
  className,
}: ComponentProps<typeof SidebarTrigger>) {
  const { toggleSidebar } = useSidebar();
  const isMobile = useIsMobile();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          className={cn("h-8 w-8 p-0", className)}
          data-testid="sidebar-toggle-button"
          onClick={toggleSidebar}
          variant="ghost"
        >
          {isMobile ? (
            <Menu className="size-5" />
          ) : (
            <SidebarLeftIcon size={16} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent align="center" className="hidden md:block" side="right">
        Toggle Sidebar
      </TooltipContent>
    </Tooltip>
  );
}
