"use client";

import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { ChevronDownIcon, SparklesIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { createContext, memo, useContext, useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import { cn } from "@/lib/utils";
import { RegenerateSparkIcon } from "../icons";
import { Response } from "./response";

type ReasoningContextValue = {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number;
};

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

const useReasoning = () => {
  const context = useContext(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
};

const AUTO_CLOSE_DELAY = 500;
const MS_IN_S = 1000;

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen = true,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange,
    });
    const [duration, setDuration] = useControllableState({
      prop: durationProp,
      defaultProp: 0,
    });

    const [hasAutoClosedRef, setHasAutoClosedRef] = useState(false);
    const [startTime, setStartTime] = useState<number | null>(null);

    useEffect(() => {
      if (isStreaming) {
        if (startTime === null) {
          setStartTime(Date.now());
        }
      } else if (startTime !== null) {
        setDuration(Math.round((Date.now() - startTime) / MS_IN_S));
        setStartTime(null);
      }
    }, [isStreaming, startTime, setDuration]);

    useEffect(() => {
      if (defaultOpen && !isStreaming && isOpen && !hasAutoClosedRef) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosedRef(true);
        }, AUTO_CLOSE_DELAY);

        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, defaultOpen, setIsOpen, hasAutoClosedRef]);

    const handleOpenChange = (newOpen: boolean) => {
      setIsOpen(newOpen);
    };

    return (
      <ReasoningContext.Provider
        value={{ isStreaming, isOpen, setIsOpen, duration }}
      >
        <Collapsible
          className={cn(
            "not-prose flex w-full flex-col overflow-hidden rounded-lg border border-border/50 bg-[#121212] text-sm transition-all",
            className
          )}
          onOpenChange={handleOpenChange}
          open={isOpen}
          {...props}
        >
          <CollapsibleTrigger asChild>
            <div className="flex cursor-pointer items-center gap-2 px-3 py-2.5 transition-colors hover:bg-muted/10">
              {isStreaming ? (
                <RegenerateSparkIcon className="size-4 animate-spin text-blue-400" />
              ) : (
                <SparklesIcon className="size-4 text-blue-400" />
              )}
              {isStreaming ? (
                <>
                  <span className="font-medium text-foreground/90">
                    Thinking
                  </span>
                  <ThinkingIndicator
                    className="text-blue-400"
                    dotClassName="bg-blue-400"
                  />
                </>
              ) : (
                <span className="font-medium text-foreground/90">Thoughts</span>
              )}
            </div>
          </CollapsibleTrigger>
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    );
  }
);

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger>;

export const ReasoningTrigger = memo(
  ({ className, children, ...props }: ReasoningTriggerProps) => {
    const { isOpen } = useReasoning();

    return (
      <CollapsibleTrigger
        className={cn(
          "flex w-full items-center justify-between border-t border-border/40 px-3 py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted/10 hover:text-foreground",
          className
        )}
        {...props}
      >
        {children ?? (
          <>
            <div className="flex items-center gap-2">
              {isOpen ? (
                <span>Collapse to hide model thoughts</span>
              ) : (
                <span>Expand to view model thoughts</span>
              )}
            </div>
            <ChevronDownIcon
              className={cn(
                "size-4 transition-transform duration-200",
                isOpen ? "rotate-180" : "rotate-0"
              )}
            />
          </>
        )}
      </CollapsibleTrigger>
    );
  }
);

export type ReasoningContentProps = ComponentProps<
  typeof CollapsibleContent
> & {
  children: string;
};

export const ReasoningContent = memo(
  ({ className, children, ...props }: ReasoningContentProps) => (
    <CollapsibleContent
      className={cn(
        "text-[13px] text-muted-foreground leading-relaxed",
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      {...props}
    >
      <div className="px-3 pb-3">
        <Response className="grid w-full gap-4 text-[13px] **:text-[13px] [&_li]:my-1 [&_ol]:my-1 [&_p]:my-1 [&_ul]:my-1">
          {children}
        </Response>
      </div>
    </CollapsibleContent>
  )
);

Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";
