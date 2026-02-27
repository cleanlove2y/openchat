"use client";
import type { UseChatHelpers } from "@ai-sdk/react";
import { ChevronLeft, ChevronRight, WrenchIcon } from "lucide-react";
import { useState } from "react";
import { ThinkingIndicator } from "@/components/ui/thinking-indicator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Vote } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/types";
import { cn, sanitizeText } from "@/lib/utils";
import { useDataStream } from "./data-stream-provider";
import { DocumentToolResult } from "./document";
import { DocumentPreview } from "./document-preview";
import { MessageContent } from "./elements/message";
import { Response } from "./elements/response";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "./elements/tool";
import { RegenerateSparkIcon, SparklesIcon } from "./icons";
import { MessageActions } from "./message-actions";
import { MessageEditor } from "./message-editor";
import { MessageReasoning } from "./message-reasoning";
import { PreviewAttachment } from "./preview-attachment";
import { Weather } from "./weather";

const PurePreviewMessage = ({
  addToolApprovalResponse,
  chatId,
  message,
  vote,
  isLoading,
  setMessages,
  regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
  currentVersion,
  totalVersions,
  onVersionChange,
  regenerateMessageId,
}: {
  addToolApprovalResponse: UseChatHelpers<ChatMessage>["addToolApprovalResponse"];
  chatId: string;
  message: ChatMessage;
  vote: Vote | undefined;
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  currentVersion?: number;
  totalVersions?: number;
  onVersionChange?: (index: number) => void;
  regenerateMessageId?: string;
}) => {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);

  const messageParts = message.parts ?? [];
  const attachmentsFromMessage = messageParts.filter(
    (part) => part.type === "file"
  );
  const hasTextParts = messageParts.some(
    (part) => part.type === "text" && part.text?.trim()
  );
  const hasToolParts = messageParts.some((part) =>
    part.type.startsWith("tool-")
  );
  const hasReasoningParts = messageParts.some(
    (part) =>
      part.type === "reasoning" &&
      (part.text?.trim() || ("state" in part && part.state === "streaming"))
  );
  const hasVisibleContent =
    hasTextParts ||
    hasToolParts ||
    hasReasoningParts ||
    attachmentsFromMessage.length > 0;
  const shouldShowEmptyCursor =
    message.role === "assistant" &&
    isLoading &&
    (messageParts.length === 0 || !hasVisibleContent);

  useDataStream();

  return (
    <div
      className="group/message fade-in w-full animate-in duration-200"
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn("flex w-full items-start gap-2 md:gap-3", {
          "justify-end": message.role === "user" && mode !== "edit",
          "justify-start": message.role === "assistant",
        })}
      >
        {message.role === "assistant" && (
          <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
            <SparklesIcon size={14} />
          </div>
        )}

        <div
          className={cn("relative flex flex-col", {
            "gap-2 md:gap-4": hasTextParts,
            "w-full":
              (message.role === "assistant" &&
                (hasTextParts || hasToolParts || hasReasoningParts)) ||
              mode === "edit",
            "max-w-[calc(100%-2.5rem)] sm:max-w-[min(fit-content,80%)]":
              message.role === "user" && mode !== "edit",
            "rounded-xl border border-transparent p-4 transition-colors hover:border-border":
              message.role === "assistant" && hasVisibleContent,
            "p-0":
              !(message.role === "assistant" && hasVisibleContent) &&
              !shouldShowEmptyCursor,
            "p-4": shouldShowEmptyCursor,
          })}
        >
          {!isReadonly &&
            message.role === "assistant" &&
            !isLoading &&
            hasVisibleContent && (
              <div className="pointer-events-none sticky top-[calc(3.5rem+0.5rem)] z-20 flex h-0 w-full items-start justify-end overflow-visible">
                <div
                  className={cn(
                    "pointer-events-auto mr-4 -translate-y-[90%] rounded-md border bg-background p-1 shadow-sm transition-opacity dark:bg-zinc-800",
                    {
                      "opacity-0 group-focus-within/message:opacity-100 group-hover/message:opacity-100":
                        !isActionMenuOpen,
                      "opacity-100": isActionMenuOpen,
                    }
                  )}
                >
                  <MessageActions
                    chatId={chatId}
                    isLoading={isLoading}
                    key={`action-${message.id}`}
                    message={message}
                    regenerate={regenerate}
                    regenerateMessageId={regenerateMessageId}
                    setIsActionMenuOpen={setIsActionMenuOpen}
                    setMode={setMode}
                    vote={vote}
                  />
                </div>
              </div>
            )}

          {shouldShowEmptyCursor && (
            <div className="not-prose flex w-full flex-col overflow-hidden rounded-lg border border-border/50 bg-[#121212] text-sm transition-all pointer-events-none mb-2 mt-2">
              <div className="flex items-center gap-2 px-3 py-2.5">
                <RegenerateSparkIcon className="size-4 animate-spin text-blue-400" />
                <span className="font-medium text-foreground/90">Thinking</span>
                <ThinkingIndicator
                  className="text-blue-400"
                  dotClassName="bg-blue-400"
                />
              </div>
            </div>
          )}

          {attachmentsFromMessage.length > 0 && (
            <div
              className="flex flex-row justify-end gap-2"
              data-testid={"message-attachments"}
            >
              {attachmentsFromMessage.map((attachment) => (
                <PreviewAttachment
                  attachment={{
                    name: attachment.filename ?? "file",
                    contentType: attachment.mediaType,
                    url: attachment.url,
                  }}
                  key={attachment.url}
                />
              ))}
            </div>
          )}

          {messageParts.map((part, index) => {
            const { type } = part;
            const key = `message-${message.id}-part-${index}`;

            if (type === "reasoning") {
              const hasContent = part.text?.trim().length > 0;
              const isStreaming = "state" in part && part.state === "streaming";
              if (hasContent || isStreaming) {
                return (
                  <MessageReasoning
                    isLoading={isStreaming}
                    key={key}
                    reasoning={part.text || ""}
                  />
                );
              }
            }

            if (type === "text") {
              if (mode === "view") {
                let textContent = sanitizeText(part.text);
                const skills: string[] = [];

                if (message.role === "user") {
                  const skillRegex = /\[Use Skill: ([^\]]+)\]/g;
                  for (const match of textContent.matchAll(skillRegex)) {
                    skills.push(match[1]);
                  }
                  // Remove the tags and any leading newlines they left behind
                  textContent = textContent
                    .replace(/\[Use Skill: [^\]]+\]/g, "")
                    .replace(/^\n+/, "");
                }

                return (
                  <div
                    className={cn("flex flex-col gap-2", {
                      "items-end": message.role === "user",
                    })}
                    key={key}
                  >
                    {message.role === "user" && skills.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 justify-end">
                        {skills.map((skill) => (
                          <TooltipProvider key={`${message.id}-${skill}`}>
                            <Tooltip delayDuration={0}>
                              <TooltipTrigger asChild>
                                <div className="flex items-center justify-center size-[34px] bg-primary/10 text-primary border border-primary/20 rounded-xl shrink-0">
                                  <WrenchIcon className="size-4" />
                                </div>
                              </TooltipTrigger>
                              <TooltipContent sideOffset={8}>
                                Used Skill: @{skill}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ))}
                      </div>
                    )}

                    {(textContent.trim() || skills.length === 0) && (
                      <MessageContent
                        className={cn({
                          "wrap-break-word w-fit rounded-2xl px-3 py-2 text-right text-white":
                            message.role === "user",
                          "bg-transparent px-0 py-0 text-left":
                            message.role === "assistant",
                        })}
                        data-testid="message-content"
                        style={
                          message.role === "user"
                            ? { backgroundColor: "#006cff" }
                            : undefined
                        }
                      >
                        <Response>{textContent}</Response>
                      </MessageContent>
                    )}
                  </div>
                );
              }

              if (mode === "edit") {
                return (
                  <div
                    className="flex w-full flex-row items-start gap-3"
                    key={key}
                  >
                    <div className="size-8" />
                    <div className="min-w-0 flex-1">
                      <MessageEditor
                        key={message.id}
                        message={message}
                        regenerate={regenerate}
                        setMessages={setMessages}
                        setMode={setMode}
                      />
                    </div>
                  </div>
                );
              }
            }

            if (type === "tool-getWeather") {
              const { toolCallId, state } = part;
              const approvalId = (part as { approval?: { id: string } })
                .approval?.id;
              const isDenied =
                state === "output-denied" ||
                (state === "approval-responded" &&
                  (part as { approval?: { approved?: boolean } }).approval
                    ?.approved === false);
              const widthClass = "w-[min(100%,450px)]";

              if (state === "output-available") {
                return (
                  <div className={widthClass} key={toolCallId}>
                    <Weather weatherAtLocation={part.output} />
                  </div>
                );
              }

              if (isDenied) {
                return (
                  <div className={widthClass} key={toolCallId}>
                    <Tool className="w-full" defaultOpen={true}>
                      <ToolHeader
                        state="output-denied"
                        type="tool-getWeather"
                      />
                      <ToolContent>
                        <div className="px-4 py-3 text-muted-foreground text-sm">
                          Weather lookup was denied.
                        </div>
                      </ToolContent>
                    </Tool>
                  </div>
                );
              }

              if (state === "approval-responded") {
                return (
                  <div className={widthClass} key={toolCallId}>
                    <Tool className="w-full" defaultOpen={true}>
                      <ToolHeader state={state} type="tool-getWeather" />
                      <ToolContent>
                        <ToolInput input={part.input} />
                      </ToolContent>
                    </Tool>
                  </div>
                );
              }

              return (
                <div className={widthClass} key={toolCallId}>
                  <Tool className="w-full" defaultOpen={true}>
                    <ToolHeader state={state} type="tool-getWeather" />
                    <ToolContent>
                      {(state === "input-available" ||
                        state === "approval-requested") && (
                        <ToolInput input={part.input} />
                      )}
                      {state === "approval-requested" && approvalId && (
                        <div className="flex items-center justify-end gap-2 border-t px-4 py-3">
                          <button
                            className="rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
                            onClick={() => {
                              addToolApprovalResponse({
                                id: approvalId,
                                approved: false,
                                reason: "User denied weather lookup",
                              });
                            }}
                            type="button"
                          >
                            Deny
                          </button>
                          <button
                            className="rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm transition-colors hover:bg-primary/90"
                            onClick={() => {
                              addToolApprovalResponse({
                                id: approvalId,
                                approved: true,
                              });
                            }}
                            type="button"
                          >
                            Allow
                          </button>
                        </div>
                      )}
                    </ToolContent>
                  </Tool>
                </div>
              );
            }

            if (type === "tool-createDocument") {
              const { toolCallId } = part;

              if (part.output && "error" in part.output) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error creating document: {String(part.output.error)}
                  </div>
                );
              }

              return (
                <DocumentPreview
                  isReadonly={isReadonly}
                  key={toolCallId}
                  result={part.output}
                />
              );
            }

            if (type === "tool-updateDocument") {
              const { toolCallId } = part;

              if (part.output && "error" in part.output) {
                return (
                  <div
                    className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50"
                    key={toolCallId}
                  >
                    Error updating document: {String(part.output.error)}
                  </div>
                );
              }

              return (
                <div className="relative" key={toolCallId}>
                  <DocumentPreview
                    args={{ ...part.output, isUpdate: true }}
                    isReadonly={isReadonly}
                    result={part.output}
                  />
                </div>
              );
            }

            if (type === "tool-requestSuggestions") {
              const { toolCallId, state } = part;

              return (
                <Tool defaultOpen={true} key={toolCallId}>
                  <ToolHeader state={state} type="tool-requestSuggestions" />
                  <ToolContent>
                    {state === "input-available" && (
                      <ToolInput input={part.input} />
                    )}
                    {state === "output-available" && (
                      <ToolOutput
                        errorText={undefined}
                        output={
                          "error" in part.output ? (
                            <div className="rounded border p-2 text-red-500">
                              Error: {String(part.output.error)}
                            </div>
                          ) : (
                            <DocumentToolResult
                              isReadonly={isReadonly}
                              result={part.output}
                              type="request-suggestions"
                            />
                          )
                        }
                      />
                    )}
                  </ToolContent>
                </Tool>
              );
            }

            return null;
          })}

          {message.role === "assistant" &&
            totalVersions !== undefined &&
            totalVersions > 1 && (
              <div className="flex items-center gap-1 pt-2">
                <button
                  className="rounded-md p-1 hover:bg-muted disabled:opacity-50"
                  disabled={currentVersion === 1}
                  onClick={() => {
                    if (onVersionChange && currentVersion) {
                      onVersionChange(currentVersion - 2);
                    }
                  }}
                  title="Previous version"
                  type="button"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="min-w-[2rem] text-center text-xs text-muted-foreground">
                  {currentVersion} / {totalVersions}
                </span>
                <button
                  className="rounded-md p-1 hover:bg-muted disabled:opacity-50"
                  disabled={currentVersion === totalVersions}
                  onClick={() => {
                    if (onVersionChange && currentVersion) {
                      onVersionChange(currentVersion);
                    }
                  }}
                  title="Next version"
                  type="button"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}

          {!isReadonly && message.role === "user" && (
            <MessageActions
              chatId={chatId}
              isLoading={isLoading}
              key={`action-${message.id}`}
              message={message}
              setMode={setMode}
              vote={vote}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export const PreviewMessage = PurePreviewMessage;

export const ThinkingMessage = ({
  phase = "submitted",
}: {
  phase?: "submitted" | "streaming";
}) => {
  const isStreamingPhase = phase === "streaming";

  return (
    <div
      className="group/message fade-in w-full animate-in duration-200"
      data-phase={phase}
      data-role="assistant"
      data-testid="message-assistant-loading"
    >
      <div className="flex w-full items-start gap-2 md:gap-3">
        <div className="-mt-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-background ring-1 ring-border">
          <div className="animate-pulse">
            <SparklesIcon size={14} />
          </div>
        </div>

        <div className="relative flex w-full flex-col p-4">
          <div
            className={cn(
              "not-prose relative h-10 w-full overflow-hidden rounded-lg border text-sm transition-colors duration-200",
              isStreamingPhase
                ? "border-border/50 bg-[#121212]"
                : "border-border/40 bg-[#121212]/85"
            )}
          >
            <div
              className={cn(
                "absolute inset-0 flex items-center px-3 transition-opacity duration-200",
                isStreamingPhase ? "opacity-0" : "opacity-100"
              )}
            >
              <ThinkingIndicator
                className="text-zinc-300"
                dotClassName="bg-zinc-300"
              />
            </div>

            <div
              className={cn(
                "absolute inset-0 flex items-center gap-2 px-3 transition-opacity duration-200",
                isStreamingPhase ? "opacity-100" : "opacity-0"
              )}
            >
              <RegenerateSparkIcon className="size-4 animate-spin text-blue-400" />
              <span className="font-medium text-foreground/90">Thinking</span>
              <ThinkingIndicator
                className="text-sky-400"
                dotClassName="bg-sky-400"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
