import type { UseChatHelpers } from "@ai-sdk/react";
import { ArrowDownIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "@/hooks/use-messages";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { useDataStream } from "./data-stream-provider";
import { Greeting } from "./greeting";
import { PreviewMessage, ThinkingMessage } from "./message";

function hasVisibleMessageContent(message: ChatMessage) {
  const parts = message.parts ?? [];

  if (parts.length === 0) {
    return false;
  }

  return parts.some((part) => {
    if (part.type === "text") {
      return Boolean(part.text?.trim());
    }

    if (part.type === "reasoning") {
      return Boolean(
        part.text?.trim() || ("state" in part && part.state === "streaming")
      );
    }

    if (part.type === "file") {
      return true;
    }

    return part.type.startsWith("tool-");
  });
}

function mergeMessagesById(existing: ChatMessage[], incoming: ChatMessage[]) {
  if (incoming.length === 0) {
    return existing;
  }

  const seen = new Map<string, ChatMessage>();
  const existingIds = new Set<string>();

  for (const message of existing) {
    seen.set(message.id, message);
    existingIds.add(message.id);
  }

  for (const message of incoming) {
    seen.set(message.id, message);
  }

  const merged = existing.map((message) => seen.get(message.id) ?? message);

  for (const message of incoming) {
    if (!existingIds.has(message.id)) {
      merged.push(message);
    }
  }

  return merged;
}

function getLastUserId(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      return messages[i].id;
    }
  }

  return null;
}

function getLastUserIndex(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      return i;
    }
  }

  return -1;
}

type MessagesProps = {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  status: UseChatHelpers<ChatMessage>["status"];
  votes: Vote[] | undefined;
  messages: ChatMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  isArtifactVisible: boolean;
  selectedModelId: string;
};

function PureMessages({
  addToolApprovalResponse,
  chatId,
  status,
  votes,
  messages,
  setMessages,
  regenerate,
  isReadonly,
  selectedModelId: _selectedModelId,
}: MessagesProps) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
  } = useMessages({
    status,
  });

  useDataStream();

  const [activeMessageVersions, setActiveMessageVersions] = useState<
    Record<string, number>
  >({});
  const assistantHistoryRef = useRef<Record<string, ChatMessage[]>>({});
  const pendingAutoAdvanceUserIdRef = useRef<string | null>(null);
  const prevStatusRef = useRef(status);
  const messageIndexById = useMemo(
    () => new Map(messages.map((message, index) => [message.id, index])),
    [messages]
  );
  const activeUserId = useMemo(() => {
    if (status === "ready") {
      return null;
    }
    return getLastUserId(messages);
  }, [messages, status]);
  const lastUserIndex = useMemo(() => getLastUserIndex(messages), [messages]);
  const hasVisibleAssistantAfterLastUser = useMemo(() => {
    if (lastUserIndex === -1) {
      return false;
    }

    for (let i = lastUserIndex + 1; i < messages.length; i += 1) {
      const message = messages[i];
      if (message.role !== "assistant") {
        continue;
      }

      if (hasVisibleMessageContent(message)) {
        return true;
      }
    }

    return false;
  }, [lastUserIndex, messages]);
  const hasApprovalResponded = useMemo(
    () =>
      messages.some((msg) =>
        msg.parts?.some(
          (part) => "state" in part && part.state === "approval-responded"
        )
      ),
    [messages]
  );
  const shouldShowThinkingMessage =
    !hasApprovalResponded &&
    (status === "submitted" || status === "streaming") &&
    !hasVisibleAssistantAfterLastUser;

  useEffect(() => {
    const nextHistory = { ...assistantHistoryRef.current };

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];

      if (message.role !== "user") {
        continue;
      }

      const assistantGroup: ChatMessage[] = [];
      let j = i + 1;
      while (j < messages.length && messages[j].role === "assistant") {
        assistantGroup.push(messages[j]);
        j += 1;
      }

      const visibleAssistants = assistantGroup.filter(hasVisibleMessageContent);

      if (visibleAssistants.length > 0) {
        const existing = nextHistory[message.id] ?? [];
        nextHistory[message.id] = mergeMessagesById(
          existing,
          visibleAssistants
        );
      }

      i += assistantGroup.length;
    }

    assistantHistoryRef.current = nextHistory;
  }, [messages]);

  const setLatestVersionForUser = (userId: string) => {
    const assistants = assistantHistoryRef.current[userId];
    if (!assistants || assistants.length === 0) {
      return;
    }

    const latestIndex = assistants.length - 1;
    setActiveMessageVersions((prev) => {
      if (prev[userId] === latestIndex) {
        return prev;
      }

      return { ...prev, [userId]: latestIndex };
    });
  };

  useEffect(() => {
    const prevStatus = prevStatusRef.current;

    if (prevStatus === "ready" && status !== "ready") {
      pendingAutoAdvanceUserIdRef.current = getLastUserId(messages);
    }

    if (pendingAutoAdvanceUserIdRef.current) {
      setLatestVersionForUser(pendingAutoAdvanceUserIdRef.current);
    }

    if (prevStatus !== "ready" && status === "ready") {
      if (pendingAutoAdvanceUserIdRef.current) {
        setLatestVersionForUser(pendingAutoAdvanceUserIdRef.current);
      }
      pendingAutoAdvanceUserIdRef.current = null;
    }

    prevStatusRef.current = status;
  }, [messages, status]);

  const renderMessage = (
    message: ChatMessage,
    overrideKey?: string,
    currentVersion?: number,
    totalVersions?: number,
    onVersionChange?: (index: number) => void,
    regenerateMessageId?: string
  ) => {
    const messageIndex = messageIndexById.get(message.id);
    const isLastMessage = messageIndex === messages.length - 1;
    const isLoading =
      (status === "submitted" || status === "streaming") && isLastMessage;

    return (
      <PreviewMessage
        addToolApprovalResponse={addToolApprovalResponse}
        chatId={chatId}
        currentVersion={currentVersion}
        isLoading={isLoading}
        isReadonly={isReadonly}
        key={overrideKey ?? message.id}
        message={message}
        onVersionChange={onVersionChange}
        regenerate={regenerate}
        regenerateMessageId={regenerateMessageId}
        requiresScrollPadding={hasSentMessage && isLastMessage}
        setMessages={setMessages}
        totalVersions={totalVersions}
        vote={
          votes
            ? votes.find((vote) => vote.messageId === message.id)
            : undefined
        }
      />
    );
  };

  const messageNodes = useMemo(() => {
    const nodes: ReactNode[] = [];

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];

      if (message.role === "user") {
        nodes.push(renderMessage(message));

        const assistantGroup: ChatMessage[] = [];
        let j = i + 1;
        while (j < messages.length && messages[j].role === "assistant") {
          assistantGroup.push(messages[j]);
          j += 1;
        }

        const currentAssistants = assistantGroup.filter(
          hasVisibleMessageContent
        );
        const cachedAssistants = assistantHistoryRef.current[message.id] ?? [];
        const renderAssistants =
          activeUserId === message.id && status !== "ready"
            ? currentAssistants
            : mergeMessagesById(cachedAssistants, currentAssistants);

        if (renderAssistants.length > 0) {
          const groupKey = message.id;
          const storedVersionIndex = activeMessageVersions[groupKey];
          const currentVersionIndex =
            storedVersionIndex === undefined
              ? renderAssistants.length - 1
              : Math.min(storedVersionIndex, renderAssistants.length - 1);
          const currentMessage = renderAssistants[currentVersionIndex];

          if (currentMessage) {
            nodes.push(
              renderMessage(
                currentMessage,
                undefined,
                currentVersionIndex + 1,
                renderAssistants.length,
                (newIndex) =>
                  setActiveMessageVersions((prev) => ({
                    ...prev,
                    [groupKey]: newIndex,
                  })),
                groupKey
              )
            );
          }
        }

        i += assistantGroup.length;
        continue;
      }

      if (message.role === "assistant") {
        if (hasVisibleMessageContent(message)) {
          nodes.push(renderMessage(message));
        }
        continue;
      }

      nodes.push(renderMessage(message));
    }

    return nodes;
  }, [
    messages,
    votes,
    status,
    isReadonly,
    addToolApprovalResponse,
    chatId,
    regenerate,
    hasSentMessage,
    setMessages,
    activeMessageVersions,
    activeUserId,
    messageIndexById,
  ]);

  return (
    <div className="relative flex-1 bg-background">
      <div
        className="absolute inset-0 touch-pan-y overflow-y-auto bg-background"
        ref={messagesContainerRef}
      >
        <div className="mx-auto flex min-w-0 max-w-4xl flex-col gap-4 px-2 py-4 md:gap-6 md:px-4">
          {messages.length === 0 && <Greeting />}

          {messageNodes}

          {shouldShowThinkingMessage && (
            <ThinkingMessage
              phase={status === "streaming" ? "streaming" : "submitted"}
            />
          )}

          <div
            className="min-h-[24px] min-w-[24px] shrink-0"
            ref={messagesEndRef}
          />
        </div>
      </div>

      <button
        aria-label="Scroll to bottom"
        className={`absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border bg-background p-2 shadow-lg transition-all hover:bg-muted ${
          isAtBottom
            ? "pointer-events-none scale-0 opacity-0"
            : "pointer-events-auto scale-100 opacity-100"
        }`}
        onClick={() => scrollToBottom("smooth")}
        type="button"
      >
        <ArrowDownIcon className="size-4" />
      </button>
    </div>
  );
}

export const Messages = PureMessages;
