import { geolocation } from "@vercel/functions";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
  tool,
} from "ai";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream";
import { z } from "zod";
import {
  type AuthenticatedSession,
  createAuthedApiRoute,
} from "@/app/api/_shared/authed-route";
import { entitlementsByUserType } from "@/lib/ai/entitlements";
import { isReasoningModelId } from "@/lib/ai/models";
import { type RequestHints, systemPrompt } from "@/lib/ai/prompts";
import { getLanguageModel } from "@/lib/ai/providers";
import {
  buildSkillsSystemPrompt,
  getSkillsConfig,
  getSkillsSnapshot,
  loadSkillByName,
  shouldEnableSkillTooling,
} from "@/lib/ai/skills";
import {
  collectSkillDirectiveNamesFromRequestBody,
  extractSkillDirectives,
} from "@/lib/ai/skills/directives";
import { createDocument } from "@/lib/ai/tools/create-document";
import { getWeather } from "@/lib/ai/tools/get-weather";
import { requestSuggestions } from "@/lib/ai/tools/request-suggestions";
import { updateDocument } from "@/lib/ai/tools/update-document";
import { isProductionEnvironment } from "@/lib/constants";
import {
  createStreamId,
  deleteChatById,
  deleteMessagesByChatIdAfterTimestamp,
  getChatById,
  getMessageById,
  getMessageCountByUserId,
  getMessagesByChatId,
  saveChat,
  saveMessages,
  updateChatTitleById,
  updateMessage,
} from "@/lib/db/queries";
import type { DBMessage } from "@/lib/db/schema";
import { OpenChatError } from "@/lib/errors";
import { getAppLogger } from "@/lib/logging";
import type { UserType } from "@/lib/server/auth/core";
import { generateTitleFromUserMessage } from "@/lib/server/chat/actions";
import type { ChatMessage } from "@/lib/types";
import { convertToUIMessages, generateUUID } from "@/lib/utils";
import { type PostRequestBody, postRequestBodySchema } from "./schema";

export const maxDuration = 60;
const appLogger = getAppLogger();

const deleteChatInputSchema = z.object({
  id: z.string().min(1),
});

function getStreamContext() {
  try {
    return createResumableStreamContext({ waitUntil: after });
  } catch (_) {
    return null;
  }
}

export { getStreamContext };

function sanitizeUserSkillDirectivesForModel(
  messages: ChatMessage[]
): ChatMessage[] {
  let changedAny = false;

  const nextMessages = messages.map((message) => {
    if (message.role !== "user") {
      return message;
    }

    let changedMessage = false;
    const nextParts = message.parts.map((part) => {
      if (
        part.type !== "text" ||
        !("text" in part) ||
        typeof part.text !== "string"
      ) {
        return part;
      }

      const { strippedText } = extractSkillDirectives(part.text);
      if (strippedText !== part.text) {
        changedMessage = true;
        return { ...part, text: strippedText };
      }

      return part;
    });

    if (!changedMessage) {
      return message;
    }

    changedAny = true;
    return {
      ...message,
      parts: nextParts,
    };
  });

  return changedAny ? nextMessages : messages;
}

function buildExplicitSkillsSystemPrompt(
  loadedSkills: Array<{ name: string; content: string }>
): string {
  if (loadedSkills.length === 0) {
    return "";
  }

  const skillBlocks = loadedSkills
    .map((loadedSkill) =>
      [`### Skill: ${loadedSkill.name}`, loadedSkill.content].join("\n")
    )
    .join("\n\n");

  return [
    "Explicit Skills Context:",
    "The user explicitly selected these skills for this request.",
    skillBlocks,
  ].join("\n\n");
}

function trimMessagesForRegenerate({
  messages,
  messageId,
}: {
  messages: ChatMessage[];
  messageId?: string;
}) {
  if (!messageId) {
    return messages;
  }

  const messageIndex = messages.findIndex(
    (currentMessage) => currentMessage.id === messageId
  );

  if (messageIndex === -1) {
    throw new OpenChatError(
      "bad_request:api",
      `Regenerate target message not found: ${messageId}`
    );
  }

  const targetMessage = messages[messageIndex];

  return messages.slice(
    0,
    targetMessage.role === "assistant" ? messageIndex : messageIndex + 1
  );
}

const postHandler = async ({
  request,
  session,
  input,
}: {
  request: Request;
  session: AuthenticatedSession;
  input: PostRequestBody;
}) => {
  const {
    id,
    message,
    messages,
    trigger,
    messageId,
    selectedChatModel,
    selectedVisibilityType,
  } = input;

  const userType: UserType = session.user.type;

  const messageCount = await getMessageCountByUserId({
    id: session.user.id,
    differenceInHours: 24,
  });

  if (messageCount > entitlementsByUserType[userType].maxMessagesPerDay) {
    return new OpenChatError("rate_limit:chat").toResponse();
  }

  const isMessagesFlow = Array.isArray(messages);
  const isRegenerateFlow = trigger === "regenerate-message";

  const chat = await getChatById({ id });
  let messagesFromDb: DBMessage[] = [];
  let titlePromise: Promise<string> | null = null;

  if (chat) {
    if (chat.userId !== session.user.id) {
      return new OpenChatError("forbidden:chat").toResponse();
    }
    if (!isMessagesFlow) {
      messagesFromDb = await getMessagesByChatId({ id });
    }
  } else if (message?.role === "user") {
    await saveChat({
      id,
      userId: session.user.id,
      title: "New chat",
      visibility: selectedVisibilityType,
    });
    titlePromise = generateTitleFromUserMessage({ message });
  }

  const dbMessagesAsUi = convertToUIMessages(messagesFromDb);
  let uiMessages = isMessagesFlow
    ? (messages as ChatMessage[])
    : message
      ? [...dbMessagesAsUi, message as ChatMessage]
      : dbMessagesAsUi;

  if (isRegenerateFlow) {
    uiMessages = trimMessagesForRegenerate({ messages: uiMessages, messageId });
  }

  const modelUiMessages = sanitizeUserSkillDirectivesForModel(uiMessages);
  const requestedSkillNames = collectSkillDirectiveNamesFromRequestBody({
    message,
    messages,
  });

  const { longitude, latitude, city, country } = geolocation(request);

  const requestHints: RequestHints = {
    longitude,
    latitude,
    city,
    country,
  };

  if (message?.role === "user") {
    const messageAlreadyExists = messagesFromDb.some(
      (storedMessage) => storedMessage.id === message.id
    );

    if (messageAlreadyExists) {
      await updateMessage({
        id: message.id,
        parts: message.parts,
      });
    } else {
      await saveMessages({
        messages: [
          {
            chatId: id,
            id: message.id,
            role: "user",
            parts: message.parts,
            attachments: [],
            createdAt: new Date(),
          },
        ],
      });
    }
  }

  const isReasoningModel = isReasoningModelId(selectedChatModel);

  const modelMessages = await convertToModelMessages(modelUiMessages);
  const skillsConfig = getSkillsConfig();
  const skillsSnapshot = await getSkillsSnapshot(skillsConfig).catch(
    (error) => {
      appLogger.error(
        { event: "skills.snapshot.load_failed", error },
        "[skills] snapshot load failed (fail-open)"
      );
      return {
        skills: [],
        loadedAt: Date.now(),
        sourceStats: {
          workspace: { discovered: 0, loaded: 0, skipped: 0 },
          user: { discovered: 0, loaded: 0, skipped: 0 },
          bundled: { discovered: 0, loaded: 0, skipped: 0 },
        },
        errors: [],
      };
    }
  );
  const skillToolingEnabled = shouldEnableSkillTooling(
    skillsConfig.enabled,
    skillsSnapshot.skills.length,
    isReasoningModel
  );
  const explicitlyLoadedSkills: Array<{ name: string; content: string }> = [];
  const missingExplicitSkillNames: string[] = [];

  for (const requestedSkillName of requestedSkillNames) {
    const loadedSkill = await loadSkillByName(
      skillsSnapshot.skills,
      requestedSkillName,
      skillsConfig,
      {
        source: "explicit_directive",
        invokedToolName: null,
      }
    );

    if (!loadedSkill) {
      missingExplicitSkillNames.push(requestedSkillName);
      continue;
    }

    explicitlyLoadedSkills.push({
      name: loadedSkill.name,
      content: loadedSkill.content,
    });
  }

  if (requestedSkillNames.length > 0) {
    appLogger.info(
      {
        event: "skills.explicit_resolution",
        requestedSkillNames,
        loadedSkillNames: explicitlyLoadedSkills.map((skill) => skill.name),
        missingSkillNames: missingExplicitSkillNames,
        chatId: id,
      },
      "[skills] explicit directives resolved"
    );
  }

  const skillsSystemPrompt = skillToolingEnabled
    ? buildSkillsSystemPrompt(skillsSnapshot.skills)
    : "";
  const explicitSkillsSystemPrompt = buildExplicitSkillsSystemPrompt(
    explicitlyLoadedSkills
  );
  const baseSystemPrompt = systemPrompt({ selectedChatModel, requestHints });
  const effectiveSystemPrompt = [
    baseSystemPrompt,
    skillsSystemPrompt,
    explicitSkillsSystemPrompt,
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");

  const executeLoadSkill = async ({
    name,
    invokedToolName,
  }: {
    name: string;
    invokedToolName: "loadSkill" | "load_skill";
  }) => {
    const loadedSkill = await loadSkillByName(
      skillsSnapshot.skills,
      name,
      skillsConfig,
      {
        source: "tool",
        invokedToolName,
      }
    );

    if (!loadedSkill) {
      return {
        error: `Skill '${name}' not found`,
        availableSkills: skillsSnapshot.skills.map((skill) => skill.name),
      };
    }

    return loadedSkill;
  };

  const loadSkillTool = skillToolingEnabled
    ? tool({
        description: "Load a skill by name and return its full instructions",
        inputSchema: z.object({
          name: z.string().describe("Skill name to load"),
        }),
        execute: ({ name }) =>
          executeLoadSkill({ name, invokedToolName: "loadSkill" }),
      })
    : undefined;

  const loadSkillAliasTool = skillToolingEnabled
    ? tool({
        description:
          "Compatibility alias for loading a skill by name and returning full instructions",
        inputSchema: z.object({
          name: z.string().describe("Skill name to load"),
        }),
        execute: ({ name }) =>
          executeLoadSkill({ name, invokedToolName: "load_skill" }),
      })
    : undefined;

  const activeTools: Array<
    | "getWeather"
    | "createDocument"
    | "updateDocument"
    | "requestSuggestions"
    | "loadSkill"
    | "load_skill"
  > = [];

  if (!isReasoningModel) {
    activeTools.push(
      "getWeather",
      "createDocument",
      "updateDocument",
      "requestSuggestions"
    );

    if (loadSkillTool) {
      activeTools.push("loadSkill");
    }

    if (loadSkillAliasTool) {
      activeTools.push("load_skill");
    }
  }

  const stream = createUIMessageStream({
    originalMessages: isMessagesFlow ? uiMessages : undefined,
    execute: async ({ writer: dataStream }) => {
      const result = streamText({
        model: getLanguageModel(selectedChatModel),
        system: effectiveSystemPrompt,
        messages: modelMessages,
        stopWhen: stepCountIs(5),
        experimental_activeTools: activeTools,
        providerOptions: isReasoningModel
          ? {
              anthropic: {
                thinking: { type: "enabled", budgetTokens: 10_000 },
              },
            }
          : undefined,
        tools: {
          getWeather,
          createDocument: createDocument({ session, dataStream }),
          updateDocument: updateDocument({ session, dataStream }),
          requestSuggestions: requestSuggestions({ session, dataStream }),
          ...(loadSkillTool ? { loadSkill: loadSkillTool } : {}),
          ...(loadSkillAliasTool ? { load_skill: loadSkillAliasTool } : {}),
        },
        experimental_telemetry: {
          isEnabled: isProductionEnvironment,
          functionId: "stream-text",
        },
      });

      dataStream.merge(result.toUIMessageStream({ sendReasoning: true }));

      if (titlePromise) {
        const title = await titlePromise;
        dataStream.write({ type: "data-chat-title", data: title });
        updateChatTitleById({ chatId: id, title });
      }
    },
    generateId: generateUUID,
    onFinish: async ({ messages: finishedMessages }) => {
      if (isRegenerateFlow && messageId) {
        const [regenerateFromMessage] = await getMessageById({ id: messageId });

        if (regenerateFromMessage?.chatId === id) {
          await deleteMessagesByChatIdAfterTimestamp({
            chatId: id,
            timestamp: regenerateFromMessage.createdAt,
          });
        }
      }

      if (isMessagesFlow) {
        for (const finishedMsg of finishedMessages) {
          const existingMsg = uiMessages.find((m) => m.id === finishedMsg.id);
          if (existingMsg) {
            await updateMessage({
              id: finishedMsg.id,
              parts: finishedMsg.parts,
            });
          } else {
            await saveMessages({
              messages: [
                {
                  id: finishedMsg.id,
                  role: finishedMsg.role,
                  parts: finishedMsg.parts,
                  createdAt: new Date(),
                  attachments: [],
                  chatId: id,
                },
              ],
            });
          }
        }
      } else if (finishedMessages.length > 0) {
        await saveMessages({
          messages: finishedMessages.map((currentMessage) => ({
            id: currentMessage.id,
            role: currentMessage.role,
            parts: currentMessage.parts,
            createdAt: new Date(),
            attachments: [],
            chatId: id,
          })),
        });
      }
    },
    onError: () => "Oops, an error occurred!",
  });

  return createUIMessageStreamResponse({
    stream,
    async consumeSseStream({ stream: sseStream }) {
      if (!process.env.REDIS_URL) {
        return;
      }
      try {
        const streamContext = getStreamContext();
        if (streamContext) {
          const streamId = generateId();
          await createStreamId({ streamId, chatId: id });
          await streamContext.createNewResumableStream(
            streamId,
            () => sseStream
          );
        }
      } catch (_) {
        // ignore redis errors
      }
    },
  });
};

const deleteHandler = async ({
  session,
  input,
}: {
  session: AuthenticatedSession;
  input: z.infer<typeof deleteChatInputSchema>;
}) => {
  const { id } = input;

  const chat = await getChatById({ id });

  if (chat?.userId !== session.user.id) {
    return new OpenChatError("forbidden:chat").toResponse();
  }

  const deletedChat = await deleteChatById({ id });

  return Response.json(deletedChat, { status: 200 });
};

const parseChatPostRequest = async (
  request: Request
): Promise<PostRequestBody> => {
  const json = await request.json();
  return postRequestBodySchema.parse(json);
};

const parseDeleteChatRequest = (
  request: Request
): z.infer<typeof deleteChatInputSchema> => {
  const searchParams = new URL(request.url).searchParams;
  return deleteChatInputSchema.parse({
    id: searchParams.get("id"),
  });
};

const mapChatPostError = (error: unknown, request: Request) => {
  const vercelId = request.headers.get("x-vercel-id");

  if (error instanceof OpenChatError) {
    return error.toResponse();
  }

  if (
    error instanceof Error &&
    error.message?.includes(
      "AI Gateway requires a valid credit card on file to service requests"
    )
  ) {
    return new OpenChatError("bad_request:activate_gateway").toResponse();
  }

  if (error instanceof Error) {
    appLogger.error(
      {
        event: "api.chat.unhandled_error",
        error,
        vercelId,
      },
      "Unhandled error in chat API"
    );
  }

  return new OpenChatError("offline:chat").toResponse();
};

const chatSubmitAudit = {
  action: "chat.submit",
  resourceType: "chat",
  getResourceId: async (requestForAudit: Request) => {
    try {
      const body = (await requestForAudit.json()) as { id?: unknown };
      return typeof body.id === "string" ? body.id : undefined;
    } catch (_) {
      return undefined;
    }
  },
  getMetadata: async (requestForAudit: Request) => {
    try {
      const body = (await requestForAudit.json()) as {
        selectedChatModel?: unknown;
        selectedVisibilityType?: unknown;
        message?: unknown;
        messages?: unknown;
        trigger?: unknown;
        messageId?: unknown;
      };
      const requestedSkillNames = collectSkillDirectiveNamesFromRequestBody({
        message: body.message,
        messages: body.messages,
      });

      return {
        selectedChatModel:
          typeof body.selectedChatModel === "string"
            ? body.selectedChatModel
            : null,
        selectedVisibilityType:
          typeof body.selectedVisibilityType === "string"
            ? body.selectedVisibilityType
            : null,
        trigger: typeof body.trigger === "string" ? body.trigger : null,
        messageId: typeof body.messageId === "string" ? body.messageId : null,
        isRegenerateFlow: body.trigger === "regenerate-message",
        isToolApprovalFlow:
          Array.isArray(body.messages) && body.trigger !== "regenerate-message",
        requestedSkillNames,
        requestedSkillCount: requestedSkillNames.length,
      };
    } catch (_) {
      return undefined;
    }
  },
} as const;

const chatDeleteAudit = {
  action: "chat.delete",
  resourceType: "chat",
  getResourceId: (requestForAudit: Request) =>
    new URL(requestForAudit.url).searchParams.get("id") ?? undefined,
} as const;

export const POST = createAuthedApiRoute<PostRequestBody>({
  route: "/api/chat",
  method: "POST",
  unauthorizedErrorCode: "unauthorized:chat",
  badRequestErrorCode: "bad_request:api",
  parseRequest: parseChatPostRequest,
  mapError: async (error, context) => mapChatPostError(error, context.request),
  audit: chatSubmitAudit,
  handler: postHandler,
});

export const DELETE = createAuthedApiRoute<
  z.infer<typeof deleteChatInputSchema>
>({
  route: "/api/chat",
  method: "DELETE",
  unauthorizedErrorCode: "unauthorized:chat",
  badRequestErrorCode: "bad_request:api",
  parseRequest: parseDeleteChatRequest,
  audit: chatDeleteAudit,
  handler: deleteHandler,
});
