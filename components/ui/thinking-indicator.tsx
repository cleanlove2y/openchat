import { cn } from "@/lib/utils";

type ThinkingIndicatorProps = {
  className?: string;
  dotClassName?: string;
};

export function ThinkingIndicator({
  className,
  dotClassName,
}: ThinkingIndicatorProps) {
  const pulseAnimation = "thinking-dot-pulse 1.2s ease-in-out infinite";

  return (
    <span
      aria-label="Thinking"
      className={cn("inline-flex items-center gap-1", className)}
      role="status"
    >
      <span
        className={cn(
          "thinking-dot inline-block size-2 rounded-full bg-current",
          dotClassName
        )}
        style={{ animation: pulseAnimation, animationDelay: "0ms" }}
      />
      <span
        className={cn(
          "thinking-dot inline-block size-2 rounded-full bg-current",
          dotClassName
        )}
        style={{ animation: pulseAnimation, animationDelay: "150ms" }}
      />
      <span
        className={cn(
          "thinking-dot inline-block size-2 rounded-full bg-current",
          dotClassName
        )}
        style={{ animation: pulseAnimation, animationDelay: "300ms" }}
      />
    </span>
  );
}
