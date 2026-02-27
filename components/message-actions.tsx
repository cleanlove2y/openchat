import type { UseChatHelpers } from "@ai-sdk/react";
import equal from "fast-deep-equal";
import { type ComponentProps, forwardRef, memo } from "react";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { useCopyToClipboard } from "usehooks-ts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Action, Actions } from "./elements/actions";
import {
  CopyIcon,
  DownloadIcon,
  MoreIcon,
  PencilEditIcon,
  RegenerateSparkIcon,
  ThumbDownIcon,
  ThumbUpIcon,
} from "./icons";

const MessageActionButton = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof Button> & { tooltip?: string }
>(({ className, tooltip, children, ...props }, ref) => {
  const button = (
    <Button
      className={cn(
        "relative size-9 p-1.5 text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10",
        className
      )}
      ref={ref}
      type="button"
      variant="ghost"
      {...props}
    >
      {children}
    </Button>
  );

  if (!tooltip) {
    return button;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
});

MessageActionButton.displayName = "MessageActionButton";

export function PureMessageActions({
  chatId,
  message,
  vote,
  isLoading,
  setMode,
  regenerate,
  setIsActionMenuOpen,
  regenerateMessageId,
}: {
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMode?: (mode: "view" | "edit") => void;
  regenerate?: UseChatHelpers<ChatMessage>["regenerate"];
  setIsActionMenuOpen?: (isOpen: boolean) => void;
  regenerateMessageId?: string;
}) {
  const { mutate } = useSWRConfig();
  const [_, copyToClipboard] = useCopyToClipboard();

  if (isLoading) {
    if (message.role === "user") {
      return (
        <Actions
          aria-hidden="true"
          className="-mr-0.5 justify-end opacity-0 pointer-events-none select-none"
        >
          <div className="size-9 shrink-0" />
        </Actions>
      );
    }

    return null;
  }

  const textFromParts = message.parts
    ?.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

  const handleCopy = async () => {
    if (!textFromParts) {
      toast.error("There's no text to copy!");
      return;
    }

    await copyToClipboard(textFromParts);
    toast.success("Copied to clipboard!");
  };

  const handleExport = () => {
    if (!textFromParts) {
      toast.error("There's no text to export!");
      return;
    }

    const url = URL.createObjectURL(
      new Blob([textFromParts], {
        type: "text/markdown;charset=utf-8",
      })
    );

    const link = document.createElement("a");
    link.href = url;
    link.download = `openchat-export-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("Exported markdown!");
  };

  const handleRegenerate = () => {
    if (!regenerate) {
      return;
    }

    const targetId = regenerateMessageId ?? message.id;
    regenerate({ messageId: targetId });
  };

  const upvote = () => {
    const request = fetch("/api/vote", {
      method: "PATCH",
      body: JSON.stringify({
        chatId,
        messageId: message.id,
        type: "up",
      }),
    });

    toast.promise(request, {
      loading: "Upvoting Response...",
      success: () => {
        mutate<Vote[]>(
          `/api/vote?chatId=${chatId}`,
          (currentVotes) => {
            if (!currentVotes) {
              return [];
            }

            const votesWithoutCurrent = currentVotes.filter(
              (currentVote) => currentVote.messageId !== message.id
            );

            return [
              ...votesWithoutCurrent,
              {
                chatId,
                messageId: message.id,
                isUpvoted: true,
              },
            ];
          },
          { revalidate: false }
        );

        return "Upvoted Response!";
      },
      error: "Failed to upvote response.",
    });
  };

  const downvote = () => {
    const request = fetch("/api/vote", {
      method: "PATCH",
      body: JSON.stringify({
        chatId,
        messageId: message.id,
        type: "down",
      }),
    });

    toast.promise(request, {
      loading: "Downvoting Response...",
      success: () => {
        mutate<Vote[]>(
          `/api/vote?chatId=${chatId}`,
          (currentVotes) => {
            if (!currentVotes) {
              return [];
            }

            const votesWithoutCurrent = currentVotes.filter(
              (currentVote) => currentVote.messageId !== message.id
            );

            return [
              ...votesWithoutCurrent,
              {
                chatId,
                messageId: message.id,
                isUpvoted: false,
              },
            ];
          },
          { revalidate: false }
        );

        return "Downvoted Response!";
      },
      error: "Failed to downvote response.",
    });
  };

  // User messages get edit (on hover) and copy actions
  if (message.role === "user") {
    return (
      <Actions className="-mr-0.5 justify-end">
        <div className="relative">
          {setMode && (
            <Action
              className="absolute top-0 -left-10 opacity-0 transition-opacity focus-visible:opacity-100 group-hover/message:opacity-100"
              data-testid="message-edit-button"
              onClick={() => setMode("edit")}
              tooltip="Edit"
            >
              <PencilEditIcon />
            </Action>
          )}
          <Action onClick={handleCopy} tooltip="Copy">
            <CopyIcon />
          </Action>
        </div>
      </Actions>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      {regenerate && (
        <MessageActionButton
          data-testid="message-regenerate"
          onClick={handleRegenerate}
          tooltip="Regenerate"
        >
          <RegenerateSparkIcon/>
        </MessageActionButton>
      )}

      <DropdownMenu onOpenChange={setIsActionMenuOpen}>
        <DropdownMenuTrigger asChild>
          <MessageActionButton tooltip="More">
            <MoreIcon />
          </MessageActionButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenuItem onClick={handleCopy}>
            <span className="flex items-center gap-2">
              <CopyIcon /> Copy
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleExport}>
            <span className="flex items-center gap-2">
              <DownloadIcon /> Export Markdown
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="message-upvote"
            disabled={vote?.isUpvoted}
            onClick={upvote}
          >
            <span className="flex items-center gap-2">
              <ThumbUpIcon /> Upvote
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="message-downvote"
            disabled={vote && !vote.isUpvoted}
            onClick={downvote}
          >
            <span className="flex items-center gap-2">
              <ThumbDownIcon /> Downvote
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export const MessageActions = memo(
  PureMessageActions,
  (prevProps, nextProps) => {
    if (prevProps.message.id !== nextProps.message.id) {
      return false;
    }
    if (!equal(prevProps.message.parts, nextProps.message.parts)) {
      return false;
    }
    if (prevProps.regenerateMessageId !== nextProps.regenerateMessageId) {
      return false;
    }
    if (!equal(prevProps.vote, nextProps.vote)) {
      return false;
    }
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }

    return true;
  }
);
