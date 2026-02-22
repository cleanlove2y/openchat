"use client";

import { useEffect, useRef } from "react";
import { WrenchIcon } from "lucide-react";
import { SlashCommandItem } from "@/hooks/use-slash-command";
import { cn } from "@/lib/utils";

interface SlashCommandMenuProps {
  isOpen: boolean;
  filteredCommands: SlashCommandItem[];
  selectedIndex: number;
  isLoading: boolean;
  onSelect: (command: SlashCommandItem) => void;
  onHover: (index: number) => void;
  onClose: () => void;
}

export function SlashCommandMenu({
  isOpen,
  filteredCommands,
  selectedIndex,
  isLoading,
  onSelect,
  onHover,
  onClose,
}: SlashCommandMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Click outside to close
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  // Scroll active item into view
  useEffect(() => {
    if (!isOpen || !scrollAreaRef.current) return;
    
    const activeElement = scrollAreaRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    if (activeElement) {
      activeElement.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, isOpen]);

  if (!isOpen) return null;

  return (
    <div 
      ref={containerRef}
      className="absolute bottom-[calc(100%+8px)] left-0 w-64 md:w-80 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg animate-in fade-in-80 slide-in-from-bottom-2 z-[9999] flex flex-col"
    >
      <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border/50 bg-muted/20">
        Agent Skills
      </div>
      
      <div 
        ref={scrollAreaRef}
        className="max-h-[300px] overflow-y-auto overflow-x-hidden p-1"
      >
        {isLoading && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            Loading skills...
          </div>
        )}
        
        {!isLoading && filteredCommands.length === 0 && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            No command found.
          </div>
        )}

        {!isLoading && filteredCommands.map((cmd, index) => {
          const isSelected = index === selectedIndex;
          return (
            <div
              key={cmd.id}
              data-index={index}
              onMouseEnter={() => onHover(index)}
              onClick={() => onSelect(cmd)}
              className={cn(
                "relative flex cursor-pointer select-none items-center gap-3 rounded-md px-2 py-2 text-sm outline-none transition-colors",
                isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
              )}
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-background border shadow-xs">
                <WrenchIcon className="size-4 text-foreground/70" />
              </div>
              <div className="flex flex-col items-start min-w-0">
                <span className="font-medium truncate">{cmd.title}</span>
                <span className="text-xs text-muted-foreground truncate w-full">{cmd.description}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
