"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import equal from "fast-deep-equal";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react";
import { usePathname } from "next/navigation";
import {
  type ChangeEvent,
  type Dispatch,
  type KeyboardEvent,
  memo,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { useLocalStorage, useWindowSize } from "usehooks-ts";
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  type SlashCommandItem,
  useSlashCommand,
} from "@/hooks/use-slash-command";
import {
  chatModels,
  DEFAULT_CHAT_MODEL,
  isReasoningModelId,
} from "@/lib/ai/models";
import { useAppTranslation } from "@/lib/i18n/hooks";
import { localizePathFromPathname } from "@/lib/i18n/navigation";
import type { Attachment, ChatMessage } from "@/lib/types";
import {
  decodeUserConnectionModelId,
  getModelLogoProvider,
  getProviderDisplayName,
  type UserFacingChatModel,
} from "@/lib/user-llm";
import { cn, fetcher } from "@/lib/utils";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
  PromptInputTools,
} from "./elements/prompt-input";
import { ArrowUpIcon, PaperclipIcon, StopIcon } from "./icons";
import { PreviewAttachment } from "./preview-attachment";
import { SlashCommandMenu } from "./slash-command-menu";
import { SuggestedActions } from "./suggested-actions";
import { Button } from "./ui/button";
import type { VisibilityType } from "./visibility-selector";

function setCookie(name: string, value: string) {
  const maxAge = 60 * 60 * 24 * 365; // 1 year
  // eslint-disable-next-line unicorn/no-document-cookie
  // biome-ignore lint/suspicious/noDocumentCookie: needed for client-side cookie setting
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}`;
}

function highlightMatch(text: string, query: string): ReactNode {
  if (!query) {
    return text;
  }

  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();

  if (!normalizedText.includes(normalizedQuery)) {
    return text;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const matchIndex = normalizedText.indexOf(normalizedQuery, cursor);

    if (matchIndex === -1) {
      parts.push(text.slice(cursor));
      break;
    }

    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }

    const matchedText = text.slice(matchIndex, matchIndex + query.length);

    parts.push(
      <span
        className="rounded-sm bg-primary/15 px-0.5 font-semibold text-foreground"
        key={`${matchIndex}-${matchedText}`}
      >
        {matchedText}
      </span>
    );

    cursor = matchIndex + query.length;
  }

  return parts;
}

function createPendingModelEntry(selectedModelId: string): UserFacingChatModel {
  const decodedUserModel = decodeUserConnectionModelId(selectedModelId);

  if (decodedUserModel) {
    return {
      id: selectedModelId,
      realId: decodedUserModel.modelId,
      connectionId: decodedUserModel.connectionId,
      name: decodedUserModel.modelId,
      provider: "custom",
      description: "Loading model metadata...",
      source: "user",
    };
  }

  const [provider = "openai", ...modelSegments] = selectedModelId.split("/");

  return {
    id: selectedModelId,
    name: modelSegments.join("/") || selectedModelId,
    provider,
    description: "Loading model metadata...",
    source: "system",
  };
}

function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  className,
  selectedVisibilityType,
  selectedModelId,
  onModelChange,
}: {
  chatId: string;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  status: UseChatHelpers<ChatMessage>["status"];
  stop: () => void;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  messages: UIMessage[];
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  sendMessage: UseChatHelpers<ChatMessage>["sendMessage"];
  className?: string;
  selectedVisibilityType: VisibilityType;
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
}) {
  const pathname = usePathname();
  const { t } = useAppTranslation("chat");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { width } = useWindowSize();

  const adjustHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      adjustHeight();
    }
  }, [adjustHeight]);

  const hasAutoFocused = useRef(false);
  useEffect(() => {
    if (!hasAutoFocused.current && width) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
        hasAutoFocused.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [width]);

  const resetHeight = useCallback(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "44px";
    }
  }, []);

  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    "input",
    ""
  );

  useEffect(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      // Prefer DOM value over localStorage to handle hydration
      const finalValue = domValue || localStorageInput || "";
      setInput(finalValue);
      adjustHeight();
    }
    // Only run once after hydration
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjustHeight, localStorageInput, setInput]);

  useEffect(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);

  const slashCommand = useSlashCommand();
  const [selectedSlashCommands, setSelectedSlashCommands] = useState<
    SlashCommandItem[]
  >([]);

  const handleCommandSelect = useCallback((cmd: SlashCommandItem) => {
    setSelectedSlashCommands((prev) => {
      if (!prev.find((c) => c.id === cmd.id)) {
        return [...prev, cmd];
      }
      return prev;
    });
  }, []);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    slashCommand.handleChange(event);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashCommand.isOpen) {
      slashCommand.handleKeyDown(event, input, setInput, handleCommandSelect);

      // Prevent default Enter behavior if it's handled by slash command
      if (event.key === "Enter" && slashCommand.filteredCommands.length > 0) {
        event.preventDefault();
      }
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);

  const submitForm = useCallback(() => {
    window.history.pushState(
      null,
      "",
      localizePathFromPathname(pathname, `/chat/${chatId}`)
    );

    const commandPrefix =
      selectedSlashCommands.length > 0
        ? `${selectedSlashCommands.map((c) => `[Use Skill: ${c.id}]`).join("\n")}\n\n`
        : "";

    sendMessage({
      role: "user",
      parts: [
        ...attachments.map((attachment) => ({
          type: "file" as const,
          url: attachment.url,
          name: attachment.name,
          mediaType: attachment.contentType,
        })),
        {
          type: "text",
          text: commandPrefix + input,
        },
      ],
    });

    setAttachments([]);
    setSelectedSlashCommands([]);
    setLocalStorageInput("");
    resetHeight();
    setInput("");

    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    setInput,
    attachments,
    sendMessage,
    setAttachments,
    setLocalStorageInput,
    width,
    chatId,
    resetHeight,
    selectedSlashCommands,
    pathname,
  ]);

  const uploadFile = useCallback(
    async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const response = await fetch("/api/files/upload", {
          method: "POST",
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          const { url, pathname, contentType } = data;

          return {
            url,
            name: pathname,
            contentType,
          };
        }
        const { error } = await response.json();
        toast.error(error);
      } catch (_error) {
        toast.error(t("upload.failed"));
      }
    },
    [t]
  );

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files || []);

      setUploadQueue(files.map((file) => file.name));

      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== undefined
        );

        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments,
        ]);
      } catch (error) {
        console.error("Error uploading files!", error);
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments, uploadFile]
  );

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }

      const imageItems = Array.from(items).filter((item) =>
        item.type.startsWith("image/")
      );

      if (imageItems.length === 0) {
        return;
      }

      // Prevent default paste behavior for images
      event.preventDefault();

      setUploadQueue((prev) => [...prev, "Pasted image"]);

      try {
        const uploadPromises = imageItems
          .map((item) => item.getAsFile())
          .filter((file): file is File => file !== null)
          .map((file) => uploadFile(file));

        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) =>
            attachment !== undefined &&
            attachment.url !== undefined &&
            attachment.contentType !== undefined
        );

        setAttachments((curr) => [
          ...curr,
          ...(successfullyUploadedAttachments as Attachment[]),
        ]);
      } catch (error) {
        console.error("Error uploading pasted images:", error);
        toast.error(t("upload.failedPasted"));
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments, uploadFile, t]
  );

  // Add paste event listener to textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.addEventListener("paste", handlePaste);
    return () => textarea.removeEventListener("paste", handlePaste);
  }, [handlePaste]);

  return (
    <div className={cn("relative flex w-full flex-col gap-4", className)}>
      {messages.length === 0 &&
        attachments.length === 0 &&
        uploadQueue.length === 0 && (
          <SuggestedActions
            chatId={chatId}
            selectedVisibilityType={selectedVisibilityType}
            sendMessage={sendMessage}
          />
        )}

      <input
        className="pointer-events-none fixed -top-4 -left-4 size-0.5 opacity-0"
        multiple
        onChange={handleFileChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />

      <PromptInput
        className="overflow-visible rounded-xl border border-border bg-background p-3 shadow-xs transition-all duration-200 focus-within:border-border hover:border-muted-foreground/50"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !input.trim() &&
            attachments.length === 0 &&
            selectedSlashCommands.length === 0
          ) {
            return;
          }
          if (status !== "ready") {
            toast.error(t("input.waitModel"));
          } else {
            submitForm();
          }
        }}
      >
        {(attachments.length > 0 ||
          uploadQueue.length > 0 ||
          selectedSlashCommands.length > 0) && (
          <div
            className="flex flex-row items-end gap-2 overflow-x-scroll"
            data-testid="attachments-preview"
          >
            {selectedSlashCommands.map((cmd) => (
              <div
                className="flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/20 rounded-lg px-2.5 py-1.5 text-sm shrink-0 whitespace-nowrap"
                key={cmd.id}
              >
                <WrenchIcon className="size-4" />
                <span className="font-medium">@{cmd.id}</span>
                <button
                  className="text-primary/70 hover:text-primary transition-colors"
                  onClick={() =>
                    setSelectedSlashCommands((s) =>
                      s.filter((x) => x.id !== cmd.id)
                    )
                  }
                  type="button"
                >
                  <XIcon className="size-4" />
                </button>
              </div>
            ))}

            {attachments.map((attachment) => (
              <PreviewAttachment
                attachment={attachment}
                key={attachment.url}
                onRemove={() => {
                  setAttachments((currentAttachments) =>
                    currentAttachments.filter((a) => a.url !== attachment.url)
                  );
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                  }
                }}
              />
            ))}

            {uploadQueue.map((filename) => (
              <PreviewAttachment
                attachment={{
                  url: "",
                  name: filename,
                  contentType: "",
                }}
                isUploading={true}
                key={filename}
              />
            ))}
          </div>
        )}
        <div className="flex flex-row items-start gap-1 sm:gap-2 relative">
          <SlashCommandMenu
            filteredCommands={slashCommand.filteredCommands}
            isLoading={slashCommand.isLoading}
            isOpen={slashCommand.isOpen}
            onClose={slashCommand.closeMenu}
            onHover={slashCommand.setSelectedIndex}
            onSelect={(cmd) =>
              slashCommand.handleSelectCommand(
                cmd,
                input,
                setInput,
                handleCommandSelect
              )
            }
            selectedIndex={slashCommand.selectedIndex}
          />
          <PromptInputTextarea
            className="grow resize-none border-0! border-none! bg-transparent p-2 text-base outline-none ring-0 [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 [&::-webkit-scrollbar]:hidden"
            data-testid="multimodal-input"
            disableAutoResize={true}
            maxHeight={200}
            minHeight={44}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={t("input.placeholder")}
            ref={textareaRef}
            rows={1}
            value={input}
          />
        </div>
        <PromptInputToolbar className="border-top-0! border-t-0! p-0 shadow-none dark:border-0 dark:border-transparent!">
          <PromptInputTools className="gap-0 sm:gap-0.5">
            <AttachmentsButton
              fileInputRef={fileInputRef}
              selectedModelId={selectedModelId}
              status={status}
            />
            <ModelSelectorCompact
              onModelChange={onModelChange}
              selectedModelId={selectedModelId}
            />
          </PromptInputTools>

          {status === "submitted" ? (
            <StopButton setMessages={setMessages} stop={stop} />
          ) : (
            <PromptInputSubmit
              className="size-8 rounded-full bg-primary text-primary-foreground transition-colors duration-200 hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
              data-testid="send-button"
              disabled={
                (!input.trim() && selectedSlashCommands.length === 0) ||
                uploadQueue.length > 0
              }
              status={status}
            >
              <ArrowUpIcon size={14} />
            </PromptInputSubmit>
          )}
        </PromptInputToolbar>
      </PromptInput>
    </div>
  );
}

export const MultimodalInput = memo(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) {
      return false;
    }
    if (prevProps.status !== nextProps.status) {
      return false;
    }
    if (!equal(prevProps.attachments, nextProps.attachments)) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }
    if (prevProps.selectedModelId !== nextProps.selectedModelId) {
      return false;
    }

    return true;
  }
);

function PureAttachmentsButton({
  fileInputRef,
  status,
  selectedModelId,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  status: UseChatHelpers<ChatMessage>["status"];
  selectedModelId: string;
}) {
  const isReasoningModel = isReasoningModelId(selectedModelId);

  return (
    <Button
      className="aspect-square h-8 rounded-lg p-1 transition-colors hover:bg-accent"
      data-testid="attachments-button"
      disabled={status !== "ready" || isReasoningModel}
      onClick={(event) => {
        event.preventDefault();
        fileInputRef.current?.click();
      }}
      variant="ghost"
    >
      <PaperclipIcon size={14} style={{ width: 14, height: 14 }} />
    </Button>
  );
}

const AttachmentsButton = memo(PureAttachmentsButton);

function PureModelSelectorCompact({
  selectedModelId,
  onModelChange,
}: {
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
}) {
  const { t } = useAppTranslation("chat");
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [expandedSourceGroups, setExpandedSourceGroups] = useState<
    Record<"user" | "system", boolean>
  >({
    user: false,
    system: true,
  });
  const [expandedProviderGroups, setExpandedProviderGroups] = useState<
    Record<string, boolean>
  >({});
  const hasInitializedSelectorState = useRef(false);
  const wasSearchActive = useRef(false);
  const fallbackModels = chatModels.map((model) => ({
    ...model,
    source: "system" as const,
  }));
  const { data } = useSWR<{ object: "list"; data: UserFacingChatModel[] }>(
    "/api/models",
    fetcher
  );

  const authoritativeModels = data?.data;
  const displayModels = useMemo(() => {
    const baseModels = authoritativeModels ?? fallbackModels;
    const hasSelectedModel = baseModels.some(
      (model) => model.id === selectedModelId
    );

    if (hasSelectedModel) {
      return baseModels;
    }

    return [createPendingModelEntry(selectedModelId), ...baseModels];
  }, [authoritativeModels, fallbackModels, selectedModelId]);
  const selectedModel =
    displayModels.find((model) => model.id === selectedModelId) ??
    displayModels.find((model) => model.id === DEFAULT_CHAT_MODEL) ??
    displayModels[0] ??
    fallbackModels[0];
  const provider = getModelLogoProvider(selectedModel?.provider ?? "openai");
  const normalizedSearch = searchValue.trim().toLowerCase();
  const filteredModels = useMemo(() => {
    if (!normalizedSearch) {
      return displayModels;
    }

    return displayModels.filter((model) => {
      const searchableText = [
        model.name,
        model.provider,
        model.description,
        model.source,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedSearch);
    });
  }, [displayModels, normalizedSearch]);
  const selectedProviderGroupKey = selectedModel
    ? `${selectedModel.source}:${selectedModel.provider}`
    : null;
  const selectedSourceKey = selectedModel?.source ?? null;
  const sourceEntries = useMemo(() => {
    const sourceOrder = ["user", "system"] as const;
    const sourceLabels: Record<(typeof sourceOrder)[number], string> = {
      user: t("model.group.user"),
      system: t("model.group.system"),
    };
    const groupedSources = filteredModels.reduce(
      (sources, model) => {
        const sourceKey = model.source;
        const providerGroupKey = `${model.source}:${model.provider}`;

        if (!sources[sourceKey]) {
          sources[sourceKey] = {
            label: sourceLabels[sourceKey],
            providers: {},
          };
        }

        if (!sources[sourceKey].providers[providerGroupKey]) {
          sources[sourceKey].providers[providerGroupKey] = [];
        }

        sources[sourceKey].providers[providerGroupKey].push(model);
        return sources;
      },
      {} as Record<
        "user" | "system",
        {
          label: string;
          providers: Record<string, UserFacingChatModel[]>;
        }
      >
    );

    return sourceOrder
      .filter((sourceKey) => {
        const sourceGroup = groupedSources[sourceKey];
        return sourceGroup && Object.keys(sourceGroup.providers).length > 0;
      })
      .sort((leftKey, rightKey) => {
        if (leftKey === selectedSourceKey) {
          return -1;
        }

        if (rightKey === selectedSourceKey) {
          return 1;
        }

        return sourceOrder.indexOf(leftKey) - sourceOrder.indexOf(rightKey);
      })
      .map((sourceKey) => {
        const sourceGroup = groupedSources[sourceKey];
        const providerEntries = Object.entries(sourceGroup.providers)
          .sort(([leftKey], [rightKey]) => {
            if (leftKey === selectedProviderGroupKey) {
              return -1;
            }

            if (rightKey === selectedProviderGroupKey) {
              return 1;
            }

            return leftKey.localeCompare(rightKey);
          })
          .map(([providerGroupKey, models]) => ({
            key: providerGroupKey,
            label: getProviderDisplayName(models[0]?.provider ?? "openai"),
            models,
          }));

        return {
          key: sourceKey,
          label: sourceGroup.label,
          providerEntries,
        };
      });
  }, [filteredModels, selectedProviderGroupKey, selectedSourceKey, t]);

  useEffect(() => {
    if (!authoritativeModels) {
      return;
    }

    const hasSelectedModel = authoritativeModels.some(
      (model) => model.id === selectedModelId
    );

    if (hasSelectedModel) {
      return;
    }

    const decodedSelectedModel = decodeUserConnectionModelId(selectedModelId);
    const fallbackModelId =
      (decodedSelectedModel
        ? authoritativeModels.find(
            (model) =>
              model.source === "user" &&
              model.connectionId === decodedSelectedModel.connectionId
          )?.id
        : undefined) ??
      authoritativeModels.find((model) => model.id === DEFAULT_CHAT_MODEL)
        ?.id ??
      authoritativeModels.find((model) => model.source === "system")?.id ??
      authoritativeModels[0]?.id;

    if (!fallbackModelId || fallbackModelId === selectedModelId) {
      return;
    }

    onModelChange?.(fallbackModelId);
    setCookie("chat-model", fallbackModelId);
  }, [authoritativeModels, onModelChange, selectedModelId]);

  useEffect(() => {
    if (!open) {
      hasInitializedSelectorState.current = false;
      wasSearchActive.current = false;
      return;
    }

    if (hasInitializedSelectorState.current) {
      return;
    }

    hasInitializedSelectorState.current = true;

    setSearchValue("");
    setExpandedSourceGroups({
      user: selectedSourceKey === "user",
      system: selectedSourceKey !== "user",
    });

    const nextProviderState: Record<string, boolean> = {};

    for (const sourceEntry of sourceEntries) {
      for (const providerEntry of sourceEntry.providerEntries) {
        nextProviderState[providerEntry.key] =
          providerEntry.key === selectedProviderGroupKey;
      }
    }

    setExpandedProviderGroups(nextProviderState);
  }, [open, selectedProviderGroupKey, selectedSourceKey, sourceEntries]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const isSearchActive = normalizedSearch.length > 0;

    if (isSearchActive && !wasSearchActive.current) {
      setExpandedSourceGroups((currentState) => ({
        ...currentState,
        ...Object.fromEntries(
          sourceEntries.map((sourceEntry) => [sourceEntry.key, true])
        ),
      }));

      setExpandedProviderGroups((currentState) => {
        const nextState = { ...currentState };

        for (const sourceEntry of sourceEntries) {
          for (const providerEntry of sourceEntry.providerEntries) {
            nextState[providerEntry.key] = true;
          }
        }

        return nextState;
      });
    }

    if (!isSearchActive && wasSearchActive.current) {
      setExpandedSourceGroups({
        user: selectedSourceKey === "user",
        system: selectedSourceKey !== "user",
      });

      const nextProviderState: Record<string, boolean> = {};

      for (const sourceEntry of sourceEntries) {
        for (const providerEntry of sourceEntry.providerEntries) {
          nextProviderState[providerEntry.key] =
            providerEntry.key === selectedProviderGroupKey;
        }
      }

      setExpandedProviderGroups(nextProviderState);
    }

    wasSearchActive.current = isSearchActive;
  }, [
    normalizedSearch,
    open,
    selectedProviderGroupKey,
    selectedSourceKey,
    sourceEntries,
  ]);

  const toggleSourceGroup = useCallback((sourceKey: "user" | "system") => {
    setExpandedSourceGroups((currentState) => ({
      ...currentState,
      [sourceKey]: !currentState[sourceKey],
    }));
  }, []);

  const toggleProviderGroup = useCallback((groupKey: string) => {
    setExpandedProviderGroups((currentState) => ({
      ...currentState,
      [groupKey]: !currentState[groupKey],
    }));
  }, []);

  const handleGroupHeaderKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, callback: () => void) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      callback();
    },
    []
  );

  return (
    <ModelSelector onOpenChange={setOpen} open={open}>
      <ModelSelectorTrigger asChild>
        <Button className="h-8 w-[200px] justify-between px-2" variant="ghost">
          {provider && <ModelSelectorLogo provider={provider} />}
          <ModelSelectorName>{selectedModel.name}</ModelSelectorName>
        </Button>
      </ModelSelectorTrigger>
      <ModelSelectorContent disableAutomaticFiltering={true}>
        <ModelSelectorInput
          onValueChange={setSearchValue}
          placeholder={t("model.searchPlaceholder")}
          value={searchValue}
        />
        <ModelSelectorList>
          {sourceEntries.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t("model.empty")}
            </div>
          ) : (
            sourceEntries.map((sourceEntry) => {
              const isSourceExpanded = expandedSourceGroups[sourceEntry.key];

              return (
                <Collapsible key={sourceEntry.key} open={isSourceExpanded}>
                  <button
                    className="flex w-full cursor-pointer items-center gap-2 border-b border-border/70 bg-muted/30 px-3 py-3 text-sm font-semibold text-foreground transition-colors duration-200 hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    onClick={() => toggleSourceGroup(sourceEntry.key)}
                    onKeyDown={(event) =>
                      handleGroupHeaderKeyDown(event, () =>
                        toggleSourceGroup(sourceEntry.key)
                      )
                    }
                    type="button"
                  >
                    {isSourceExpanded ? (
                      <ChevronDownIcon className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronRightIcon className="size-4 text-muted-foreground" />
                    )}
                    <span>
                      {highlightMatch(sourceEntry.label, normalizedSearch)}
                    </span>
                    <span className="ml-auto rounded-full border border-border/70 bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      {sourceEntry.providerEntries.reduce(
                        (count, providerEntry) =>
                          count + providerEntry.models.length,
                        0
                      )}
                    </span>
                  </button>
                  <CollapsibleContent>
                    <div className="space-y-1 bg-background/70 px-2 py-2">
                      {sourceEntry.providerEntries.map((providerEntry) => {
                        const isProviderExpanded =
                          expandedProviderGroups[providerEntry.key] ?? false;

                        return (
                          <Collapsible
                            key={providerEntry.key}
                            open={isProviderExpanded}
                          >
                            <button
                              className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-transparent border-l-border/80 bg-transparent px-3 py-2 text-xs font-medium text-muted-foreground transition-colors duration-200 hover:border-border/70 hover:bg-muted/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                              onClick={() =>
                                toggleProviderGroup(providerEntry.key)
                              }
                              onKeyDown={(event) =>
                                handleGroupHeaderKeyDown(event, () =>
                                  toggleProviderGroup(providerEntry.key)
                                )
                              }
                              type="button"
                            >
                              {isProviderExpanded ? (
                                <ChevronDownIcon className="size-4" />
                              ) : (
                                <ChevronRightIcon className="size-4" />
                              )}
                              <span className="truncate">
                                {highlightMatch(
                                  providerEntry.label,
                                  normalizedSearch
                                )}
                              </span>
                              <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground/90">
                                {providerEntry.models.length}
                              </span>
                            </button>
                            <CollapsibleContent>
                              <div className="ml-4 space-y-1 border-l border-border/60 px-2 pb-1">
                                {providerEntry.models.map((model) => {
                                  const logoProvider = getModelLogoProvider(
                                    model.provider
                                  );

                                  return (
                                    <ModelSelectorItem
                                      className="rounded-lg px-3"
                                      key={model.id}
                                      onSelect={() => {
                                        onModelChange?.(model.id);
                                        setCookie("chat-model", model.id);
                                        setOpen(false);
                                      }}
                                      value={`${model.name} ${model.provider} ${model.source}`}
                                    >
                                      <ModelSelectorLogo
                                        provider={logoProvider}
                                      />
                                      <ModelSelectorName>
                                        {highlightMatch(
                                          model.name,
                                          normalizedSearch
                                        )}
                                      </ModelSelectorName>
                                      {model.id === selectedModel?.id && (
                                        <CheckIcon className="ml-auto size-4" />
                                      )}
                                    </ModelSelectorItem>
                                  );
                                })}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })
          )}
        </ModelSelectorList>
      </ModelSelectorContent>
    </ModelSelector>
  );
}

const ModelSelectorCompact = memo(PureModelSelectorCompact);

function PureStopButton({
  stop,
  setMessages,
}: {
  stop: () => void;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
}) {
  return (
    <Button
      className="size-7 rounded-full bg-foreground p-1 text-background transition-colors duration-200 hover:bg-foreground/90 disabled:bg-muted disabled:text-muted-foreground"
      data-testid="stop-button"
      onClick={(event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => messages);
      }}
    >
      <StopIcon size={14} />
    </Button>
  );
}

const StopButton = memo(PureStopButton);
