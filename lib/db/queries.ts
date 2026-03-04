import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { ArtifactKind } from "@/components/artifact";
import type { VisibilityType } from "@/components/visibility-selector";
import { OpenChatError } from "../errors";
import { getAppLogger } from "../logging";
import { generateUUID } from "../utils";
import {
  type Chat,
  chat,
  type DBMessage,
  document,
  message,
  type ModelCapabilityOverride,
  modelCapabilityOverride,
  type NewModelCapabilityOverride,
  type NewUserLlmConnection,
  type NewUserLlmModelCache,
  type Suggestion,
  stream,
  suggestion,
  type User,
  type UserLlmConnection,
  type UserLlmModelCache,
  user,
  userLlmConnection,
  userLlmModelCache,
  vote,
} from "./schema";
import { generateHashedPassword } from "./utils";
import type {
  ModelCapabilityKey,
  ModelCapabilityRecord,
  ModelCapabilitySource,
} from "../user-llm";

// Optionally, if not using email/pass login, you can
// use the Drizzle adapter for Auth.js / NextAuth
// https://authjs.dev/reference/adapter/drizzle

// biome-ignore lint: Forbidden non-null assertion.
const client = postgres(process.env.POSTGRES_URL!);
const db = drizzle(client);
const appLogger = getAppLogger();

type ModelCapabilityRef = {
  sourceType: "system" | "user_connection";
  connectionId?: string | null;
  modelId: string;
};

const modelCapabilitySourcePriority: Record<ModelCapabilitySource, number> = {
  vercel_gateway_models: 1,
  openrouter: 2,
  vercel_gateway_endpoints: 2,
  runtime_success_probe: 3,
  runtime_error_fallback: 4,
  manual: 5,
};

function mergeModelCapabilities({
  existing,
  incoming,
}: {
  existing: ModelCapabilityRecord;
  incoming: ModelCapabilityRecord;
}): ModelCapabilityRecord {
  const merged: ModelCapabilityRecord = { ...existing };

  for (const capabilityKey of Object.keys(incoming) as ModelCapabilityKey[]) {
    const incomingState = incoming[capabilityKey];

    if (!incomingState) {
      continue;
    }

    const existingState = merged[capabilityKey];

    if (!existingState) {
      merged[capabilityKey] = incomingState;
      continue;
    }

    const existingPriority =
      modelCapabilitySourcePriority[
        existingState.source as ModelCapabilitySource
      ] ?? 0;
    const incomingPriority =
      modelCapabilitySourcePriority[
        incomingState.source as ModelCapabilitySource
      ] ?? 0;

    if (incomingPriority >= existingPriority) {
      merged[capabilityKey] = incomingState;
    }
  }

  return merged;
}

function hasCapabilityData(
  capabilities: ModelCapabilityRecord | null | undefined
): capabilities is ModelCapabilityRecord {
  return Boolean(capabilities && Object.keys(capabilities).length > 0);
}

function modelCapabilityRecordsEqual(
  left: ModelCapabilityRecord,
  right: ModelCapabilityRecord
) {
  const keys = new Set([
    ...Object.keys(left),
    ...Object.keys(right),
  ]) as Set<ModelCapabilityKey>;

  for (const capabilityKey of keys) {
    const leftState = left[capabilityKey];
    const rightState = right[capabilityKey];

    if (!leftState && !rightState) {
      continue;
    }

    if (!leftState || !rightState) {
      return false;
    }

    if (
      leftState.status !== rightState.status ||
      leftState.confidence !== rightState.confidence ||
      leftState.source !== rightState.source
    ) {
      return false;
    }
  }

  return true;
}

export async function getUser(email: string): Promise<User[]> {
  try {
    return await db.select().from(user).where(eq(user.email, email));
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get user by email"
    );
  }
}

export async function createUser(email: string, password: string) {
  const hashedPassword = generateHashedPassword(password);

  try {
    return await db.insert(user).values({ email, password: hashedPassword });
  } catch (_error) {
    throw new OpenChatError("bad_request:database", "Failed to create user");
  }
}

export async function createGuestUser() {
  const email = `guest-${Date.now()}`;
  const password = generateHashedPassword(generateUUID());

  try {
    return await db.insert(user).values({ email, password }).returning({
      id: user.id,
      email: user.email,
    });
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to create guest user"
    );
  }
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  try {
    return await db.insert(chat).values({
      id,
      createdAt: new Date(),
      userId,
      title,
      visibility,
    });
  } catch (_error) {
    throw new OpenChatError("bad_request:database", "Failed to save chat");
  }
}

export async function deleteChatById({ id }: { id: string }) {
  try {
    await db.delete(vote).where(eq(vote.chatId, id));
    await db.delete(message).where(eq(message.chatId, id));
    await db.delete(stream).where(eq(stream.chatId, id));

    const [chatsDeleted] = await db
      .delete(chat)
      .where(eq(chat.id, id))
      .returning();
    return chatsDeleted;
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to delete chat by id"
    );
  }
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    const userChats = await db
      .select({ id: chat.id })
      .from(chat)
      .where(eq(chat.userId, userId));

    if (userChats.length === 0) {
      return { deletedCount: 0 };
    }

    const chatIds = userChats.map((c) => c.id);

    await db.delete(vote).where(inArray(vote.chatId, chatIds));
    await db.delete(message).where(inArray(message.chatId, chatIds));
    await db.delete(stream).where(inArray(stream.chatId, chatIds));

    const deletedChats = await db
      .delete(chat)
      .where(eq(chat.userId, userId))
      .returning();

    return { deletedCount: deletedChats.length };
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to delete all chats by user id"
    );
  }
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    const extendedLimit = limit + 1;

    const query = (whereCondition?: SQL<any>) =>
      db
        .select()
        .from(chat)
        .where(
          whereCondition
            ? and(whereCondition, eq(chat.userId, id))
            : eq(chat.userId, id)
        )
        .orderBy(desc(chat.createdAt))
        .limit(extendedLimit);

    let filteredChats: Chat[] = [];

    if (startingAfter) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, startingAfter))
        .limit(1);

      if (!selectedChat) {
        throw new OpenChatError(
          "not_found:database",
          `Chat with id ${startingAfter} not found`
        );
      }

      filteredChats = await query(gt(chat.createdAt, selectedChat.createdAt));
    } else if (endingBefore) {
      const [selectedChat] = await db
        .select()
        .from(chat)
        .where(eq(chat.id, endingBefore))
        .limit(1);

      if (!selectedChat) {
        throw new OpenChatError(
          "not_found:database",
          `Chat with id ${endingBefore} not found`
        );
      }

      filteredChats = await query(lt(chat.createdAt, selectedChat.createdAt));
    } else {
      filteredChats = await query();
    }

    const hasMore = filteredChats.length > limit;

    return {
      chats: hasMore ? filteredChats.slice(0, limit) : filteredChats,
      hasMore,
    };
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get chats by user id"
    );
  }
}

export async function getChatById({ id }: { id: string }) {
  try {
    const [selectedChat] = await db.select().from(chat).where(eq(chat.id, id));
    if (!selectedChat) {
      return null;
    }

    return selectedChat;
  } catch (_error) {
    throw new OpenChatError("bad_request:database", "Failed to get chat by id");
  }
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    return await db.insert(message).values(messages);
  } catch (_error) {
    throw new OpenChatError("bad_request:database", "Failed to save messages");
  }
}

export async function updateMessage({
  id,
  parts,
}: {
  id: string;
  parts: DBMessage["parts"];
}) {
  try {
    return await db.update(message).set({ parts }).where(eq(message.id, id));
  } catch (_error) {
    throw new OpenChatError("bad_request:database", "Failed to update message");
  }
}

export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    return await db
      .select()
      .from(message)
      .where(eq(message.chatId, id))
      .orderBy(asc(message.createdAt));
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get messages by chat id"
    );
  }
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  try {
    const [existingVote] = await db
      .select()
      .from(vote)
      .where(and(eq(vote.messageId, messageId)));

    if (existingVote) {
      return await db
        .update(vote)
        .set({ isUpvoted: type === "up" })
        .where(and(eq(vote.messageId, messageId), eq(vote.chatId, chatId)));
    }
    return await db.insert(vote).values({
      chatId,
      messageId,
      isUpvoted: type === "up",
    });
  } catch (_error) {
    throw new OpenChatError("bad_request:database", "Failed to vote message");
  }
}

export async function getVotesByChatId({ id }: { id: string }) {
  try {
    return await db.select().from(vote).where(eq(vote.chatId, id));
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get votes by chat id"
    );
  }
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  try {
    return await db
      .insert(document)
      .values({
        id,
        title,
        kind,
        content,
        userId,
        createdAt: new Date(),
      })
      .returning();
  } catch (_error) {
    throw new OpenChatError("bad_request:database", "Failed to save document");
  }
}

export async function getDocumentsById({ id }: { id: string }) {
  try {
    const documents = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(asc(document.createdAt));

    return documents;
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get documents by id"
    );
  }
}

export async function getDocumentById({ id }: { id: string }) {
  try {
    const [selectedDocument] = await db
      .select()
      .from(document)
      .where(eq(document.id, id))
      .orderBy(desc(document.createdAt));

    return selectedDocument;
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get document by id"
    );
  }
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  try {
    await db
      .delete(suggestion)
      .where(
        and(
          eq(suggestion.documentId, id),
          gt(suggestion.documentCreatedAt, timestamp)
        )
      );

    return await db
      .delete(document)
      .where(and(eq(document.id, id), gt(document.createdAt, timestamp)))
      .returning();
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to delete documents by id after timestamp"
    );
  }
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  try {
    return await db.insert(suggestion).values(suggestions);
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to save suggestions"
    );
  }
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  try {
    return await db
      .select()
      .from(suggestion)
      .where(eq(suggestion.documentId, documentId));
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get suggestions by document id"
    );
  }
}

export async function getMessageById({ id }: { id: string }) {
  try {
    return await db.select().from(message).where(eq(message.id, id));
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get message by id"
    );
  }
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const messagesToDelete = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(eq(message.chatId, chatId), gte(message.createdAt, timestamp))
      );

    const messageIds = messagesToDelete.map(
      (currentMessage) => currentMessage.id
    );

    if (messageIds.length > 0) {
      await db
        .delete(vote)
        .where(
          and(eq(vote.chatId, chatId), inArray(vote.messageId, messageIds))
        );

      return await db
        .delete(message)
        .where(
          and(eq(message.chatId, chatId), inArray(message.id, messageIds))
        );
    }
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    return await db.update(chat).set({ visibility }).where(eq(chat.id, chatId));
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to update chat visibility by id"
    );
  }
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  try {
    return await db.update(chat).set({ title }).where(eq(chat.id, chatId));
  } catch (error) {
    appLogger.warn(
      {
        event: "db.chat_title.update_failed",
        chatId,
        error,
      },
      "Failed to update title for chat"
    );
    return;
  }
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    const twentyFourHoursAgo = new Date(
      Date.now() - differenceInHours * 60 * 60 * 1000
    );

    const [stats] = await db
      .select({ count: count(message.id) })
      .from(message)
      .innerJoin(chat, eq(message.chatId, chat.id))
      .where(
        and(
          eq(chat.userId, id),
          gte(message.createdAt, twentyFourHoursAgo),
          eq(message.role, "user")
        )
      )
      .execute();

    return stats?.count ?? 0;
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get message count by user id"
    );
  }
}

export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    await db
      .insert(stream)
      .values({ id: streamId, chatId, createdAt: new Date() });
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to create stream id"
    );
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const streamIds = await db
      .select({ id: stream.id })
      .from(stream)
      .where(eq(stream.chatId, chatId))
      .orderBy(asc(stream.createdAt))
      .execute();

    return streamIds.map(({ id }) => id);
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get stream ids by chat id"
    );
  }
}

export async function getUserLlmConnections({
  userId,
}: {
  userId: string;
}): Promise<UserLlmConnection[]> {
  try {
    return await db
      .select()
      .from(userLlmConnection)
      .where(eq(userLlmConnection.userId, userId))
      .orderBy(desc(userLlmConnection.isDefault), asc(userLlmConnection.name));
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get user LLM connections"
    );
  }
}

export async function getUserLlmConnectionById({
  id,
  userId,
}: {
  id: string;
  userId: string;
}): Promise<UserLlmConnection | null> {
  try {
    const [connection] = await db
      .select()
      .from(userLlmConnection)
      .where(
        and(eq(userLlmConnection.id, id), eq(userLlmConnection.userId, userId))
      )
      .limit(1);

    return connection ?? null;
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get user LLM connection by id"
    );
  }
}

export async function createUserLlmConnection({
  userId,
  name,
  provider,
  baseUrl,
  apiKeyEncrypted,
  defaultModel,
  defaultTemperature,
  enabled,
  isDefault,
}: {
  userId: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKeyEncrypted: string | null;
  defaultModel?: string | null;
  defaultTemperature?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
}): Promise<UserLlmConnection> {
  const now = new Date();

  try {
    if (isDefault) {
      await db
        .update(userLlmConnection)
        .set({ isDefault: false, updatedAt: now })
        .where(eq(userLlmConnection.userId, userId));
    }

    const [connection] = await db
      .insert(userLlmConnection)
      .values({
        userId,
        name,
        provider,
        baseUrl,
        apiKeyEncrypted,
        defaultModel: defaultModel ?? null,
        defaultTemperature: defaultTemperature ?? null,
        enabled: enabled ?? true,
        isDefault: isDefault ?? false,
        createdAt: now,
        updatedAt: now,
      } satisfies NewUserLlmConnection)
      .returning();

    if (!connection) {
      throw new OpenChatError(
        "bad_request:database",
        "No connection returned after insert"
      );
    }

    return connection;
  } catch (error) {
    if (error instanceof OpenChatError) {
      throw error;
    }

    throw new OpenChatError(
      "bad_request:database",
      "Failed to create user LLM connection"
    );
  }
}

export async function updateUserLlmConnection({
  id,
  userId,
  name,
  provider,
  baseUrl,
  apiKeyEncrypted,
  defaultModel,
  defaultTemperature,
  enabled,
  isDefault,
}: {
  id: string;
  userId: string;
  name?: string;
  provider?: string;
  baseUrl?: string;
  apiKeyEncrypted?: string | null;
  defaultModel?: string | null;
  defaultTemperature?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
}): Promise<UserLlmConnection | null> {
  const now = new Date();

  try {
    if (isDefault) {
      await db
        .update(userLlmConnection)
        .set({ isDefault: false, updatedAt: now })
        .where(eq(userLlmConnection.userId, userId));
    }

    const [connection] = await db
      .update(userLlmConnection)
      .set({
        updatedAt: now,
        ...(name !== undefined ? { name } : {}),
        ...(provider !== undefined ? { provider } : {}),
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        ...(apiKeyEncrypted !== undefined ? { apiKeyEncrypted } : {}),
        ...(defaultModel !== undefined ? { defaultModel } : {}),
        ...(defaultTemperature !== undefined ? { defaultTemperature } : {}),
        ...(enabled !== undefined ? { enabled } : {}),
        ...(isDefault !== undefined ? { isDefault } : {}),
      } satisfies Partial<NewUserLlmConnection>)
      .where(
        and(eq(userLlmConnection.id, id), eq(userLlmConnection.userId, userId))
      )
      .returning();

    return connection ?? null;
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to update user LLM connection"
    );
  }
}

export async function deleteUserLlmConnection({
  id,
  userId,
}: {
  id: string;
  userId: string;
}): Promise<UserLlmConnection | null> {
  try {
    const [ownedConnection] = await db
      .select({ id: userLlmConnection.id })
      .from(userLlmConnection)
      .where(
        and(eq(userLlmConnection.id, id), eq(userLlmConnection.userId, userId))
      )
      .limit(1);

    if (!ownedConnection) {
      return null;
    }

    await db
      .delete(userLlmModelCache)
      .where(eq(userLlmModelCache.connectionId, ownedConnection.id));

    const [connection] = await db
      .delete(userLlmConnection)
      .where(
        and(eq(userLlmConnection.id, id), eq(userLlmConnection.userId, userId))
      )
      .returning();

    return connection ?? null;
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to delete user LLM connection"
    );
  }
}

export async function getUserLlmModelCache({
  connectionId,
}: {
  connectionId: string;
}): Promise<UserLlmModelCache | null> {
  try {
    const [cache] = await db
      .select()
      .from(userLlmModelCache)
      .where(eq(userLlmModelCache.connectionId, connectionId))
      .orderBy(desc(userLlmModelCache.fetchedAt))
      .limit(1);

    return cache ?? null;
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get user LLM model cache"
    );
  }
}

export async function getModelCapabilityOverride({
  sourceType,
  connectionId,
  modelId,
}: ModelCapabilityRef): Promise<ModelCapabilityOverride | null> {
  if (sourceType === "user_connection" && !connectionId) {
    return null;
  }

  const safeConnectionId = connectionId ?? null;

  try {
    const query = db.select().from(modelCapabilityOverride).where(
      sourceType === "system"
        ? and(
            eq(modelCapabilityOverride.sourceType, "system"),
            eq(modelCapabilityOverride.modelId, modelId)
          )
        : and(
            eq(modelCapabilityOverride.sourceType, "user_connection"),
            eq(modelCapabilityOverride.connectionId, safeConnectionId as string),
            eq(modelCapabilityOverride.modelId, modelId)
          )
    );

    const [capability] = await query.limit(1);
    return capability ?? null;
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to get model capability override"
    );
  }
}

export async function listModelCapabilityOverrides({
  refs,
}: {
  refs: ModelCapabilityRef[];
}): Promise<ModelCapabilityOverride[]> {
  if (refs.length === 0) {
    return [];
  }

  try {
    const systemModelIds = Array.from(
      new Set(
        refs
          .filter((ref) => ref.sourceType === "system")
          .map((ref) => ref.modelId)
          .filter(Boolean)
      )
    );
    const userConnectionIds = Array.from(
      new Set(
        refs
          .filter(
            (ref): ref is ModelCapabilityRef & { connectionId: string } =>
              ref.sourceType === "user_connection" && Boolean(ref.connectionId)
          )
          .map((ref) => ref.connectionId)
      )
    );

    const rows: ModelCapabilityOverride[] = [];

    if (systemModelIds.length > 0) {
      const systemRows = await db
        .select()
        .from(modelCapabilityOverride)
        .where(
          and(
            eq(modelCapabilityOverride.sourceType, "system"),
            inArray(modelCapabilityOverride.modelId, systemModelIds)
          )
        );

      rows.push(...systemRows);
    }

    if (userConnectionIds.length > 0) {
      const requestedUserKeys = new Set(
        refs
          .filter(
            (ref): ref is ModelCapabilityRef & { connectionId: string } =>
              ref.sourceType === "user_connection" && Boolean(ref.connectionId)
          )
          .map((ref) => `${ref.connectionId}:${ref.modelId}`)
      );

      const userRows = await db
        .select()
        .from(modelCapabilityOverride)
        .where(
          and(
            eq(modelCapabilityOverride.sourceType, "user_connection"),
            inArray(modelCapabilityOverride.connectionId, userConnectionIds)
          )
        );

      rows.push(
        ...userRows.filter((row) =>
          requestedUserKeys.has(`${row.connectionId}:${row.modelId}`)
        )
      );
    }

    return rows;
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to list model capability overrides"
    );
  }
}

export async function upsertModelCapabilityOverride({
  sourceType,
  connectionId,
  providerKey,
  modelId,
  capabilities,
  lastErrorSignature,
}: ModelCapabilityRef & {
  providerKey: string;
  capabilities: ModelCapabilityRecord;
  lastErrorSignature?: string | null;
}): Promise<ModelCapabilityOverride> {
  if (!hasCapabilityData(capabilities)) {
    throw new OpenChatError(
      "bad_request:database",
      "Cannot save an empty model capability override"
    );
  }

  const now = new Date();

  try {
    const existing = await getModelCapabilityOverride({
      sourceType,
      connectionId,
      modelId,
    });
    const mergedCapabilities = mergeModelCapabilities({
      existing: existing?.capabilitiesJson ?? {},
      incoming: capabilities,
    });

    if (existing) {
      const shouldKeepExistingRow =
        providerKey === existing.providerKey &&
        lastErrorSignature === undefined &&
        modelCapabilityRecordsEqual(mergedCapabilities, existing.capabilitiesJson);

      if (shouldKeepExistingRow) {
        return existing;
      }

      const [updated] = await db
        .update(modelCapabilityOverride)
        .set({
          providerKey,
          capabilitiesJson: mergedCapabilities,
          lastDetectedAt: now,
          lastErrorSignature:
            lastErrorSignature === undefined
              ? existing.lastErrorSignature
              : lastErrorSignature,
          updatedAt: now,
        })
        .where(eq(modelCapabilityOverride.id, existing.id))
        .returning();

      if (!updated) {
        throw new OpenChatError(
          "bad_request:database",
          "No model capability returned after update"
        );
      }

      return updated;
    }

    const [created] = await db
      .insert(modelCapabilityOverride)
      .values({
        sourceType,
        connectionId: sourceType === "system" ? null : connectionId ?? null,
        providerKey,
        modelId,
        capabilitiesJson: mergedCapabilities,
        lastDetectedAt: now,
        lastErrorSignature: lastErrorSignature ?? null,
        createdAt: now,
        updatedAt: now,
      } satisfies NewModelCapabilityOverride)
      .returning();

    if (!created) {
      throw new OpenChatError(
        "bad_request:database",
        "No model capability returned after insert"
      );
    }

    return created;
  } catch (error) {
    if (error instanceof OpenChatError) {
      throw error;
    }

    throw new OpenChatError(
      "bad_request:database",
      "Failed to save model capability override"
    );
  }
}

export async function clearModelCapabilityOverrideKey({
  sourceType,
  connectionId,
  modelId,
  capabilityKey,
  expectedSources,
}: ModelCapabilityRef & {
  capabilityKey: ModelCapabilityKey;
  expectedSources?: string[];
}): Promise<void> {
  try {
    const existing = await getModelCapabilityOverride({
      sourceType,
      connectionId,
      modelId,
    });

    if (!existing) {
      return;
    }

    const existingState = existing.capabilitiesJson[capabilityKey];

    if (!existingState) {
      return;
    }

    if (
      expectedSources &&
      !expectedSources.includes(existingState.source as string)
    ) {
      return;
    }

    const nextCapabilities: ModelCapabilityRecord = {
      ...existing.capabilitiesJson,
    };
    delete nextCapabilities[capabilityKey];

    if (!hasCapabilityData(nextCapabilities)) {
      await db
        .delete(modelCapabilityOverride)
        .where(eq(modelCapabilityOverride.id, existing.id));
      return;
    }

    await db
      .update(modelCapabilityOverride)
      .set({
        capabilitiesJson: nextCapabilities,
        updatedAt: new Date(),
      })
      .where(eq(modelCapabilityOverride.id, existing.id));
  } catch (error) {
    if (error instanceof OpenChatError) {
      throw error;
    }

    throw new OpenChatError(
      "bad_request:database",
      "Failed to clear model capability override key"
    );
  }
}

export async function clearLegacySystemToolCapabilitySeeds({
  modelIds,
}: {
  modelIds: string[];
}): Promise<void> {
  if (modelIds.length === 0) {
    return;
  }

  try {
    const rows = await db
      .select()
      .from(modelCapabilityOverride)
      .where(
        and(
          eq(modelCapabilityOverride.sourceType, "system"),
          inArray(modelCapabilityOverride.modelId, modelIds)
        )
      );

    const legacyRows = rows.filter((row) => {
      const toolsState = row.capabilitiesJson.tools;

      return (
        Boolean(toolsState) &&
        ["vercel_gateway", "vercel_gateway_models"].includes(
          toolsState?.source as string
        )
      );
    });

    if (legacyRows.length === 0) {
      return;
    }

    await Promise.all(
      legacyRows.map(async (row) => {
        const nextCapabilities: ModelCapabilityRecord = {
          ...row.capabilitiesJson,
        };
        delete nextCapabilities.tools;

        if (!hasCapabilityData(nextCapabilities)) {
          await db
            .delete(modelCapabilityOverride)
            .where(eq(modelCapabilityOverride.id, row.id));
          return;
        }

        await db
          .update(modelCapabilityOverride)
          .set({
            capabilitiesJson: nextCapabilities,
            updatedAt: new Date(),
          })
          .where(eq(modelCapabilityOverride.id, row.id));
      })
    );
  } catch (error) {
    if (error instanceof OpenChatError) {
      throw error;
    }

    throw new OpenChatError(
      "bad_request:database",
      "Failed to clear legacy system tool capability seeds"
    );
  }
}

export async function saveUserLlmModelCache({
  connectionId,
  modelsJson,
}: {
  connectionId: string;
  modelsJson: UserLlmModelCache["modelsJson"];
}): Promise<UserLlmModelCache> {
  const now = new Date();

  try {
    const existingCaches = await db
      .select({ id: userLlmModelCache.id })
      .from(userLlmModelCache)
      .where(eq(userLlmModelCache.connectionId, connectionId))
      .orderBy(desc(userLlmModelCache.fetchedAt));

    const [primaryCache, ...duplicateCaches] = existingCaches;

    if (duplicateCaches.length > 0) {
      await db.delete(userLlmModelCache).where(
        inArray(
          userLlmModelCache.id,
          duplicateCaches.map((cache) => cache.id)
        )
      );
    }

    if (primaryCache) {
      const [updatedCache] = await db
        .update(userLlmModelCache)
        .set({ modelsJson, fetchedAt: now })
        .where(eq(userLlmModelCache.id, primaryCache.id))
        .returning();

      if (!updatedCache) {
        throw new OpenChatError(
          "bad_request:database",
          "No model cache returned after update"
        );
      }

      return updatedCache;
    }

    const [createdCache] = await db
      .insert(userLlmModelCache)
      .values({
        connectionId,
        modelsJson,
        fetchedAt: now,
      } satisfies NewUserLlmModelCache)
      .returning();

    if (!createdCache) {
      throw new OpenChatError(
        "bad_request:database",
        "No model cache returned after insert"
      );
    }

    return createdCache;
  } catch (error) {
    if (error instanceof OpenChatError) {
      throw error;
    }

    throw new OpenChatError(
      "bad_request:database",
      "Failed to save user LLM model cache"
    );
  }
}

export async function updateUserLlmConnectionValidation({
  id,
  userId,
  lastValidationError,
}: {
  id: string;
  userId: string;
  lastValidationError: string | null;
}) {
  try {
    await db
      .update(userLlmConnection)
      .set({
        lastValidatedAt: new Date(),
        lastValidationError,
        updatedAt: new Date(),
      })
      .where(
        and(eq(userLlmConnection.id, id), eq(userLlmConnection.userId, userId))
      );
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to update user LLM connection validation"
    );
  }
}

export async function touchUserLlmConnectionLastUsed({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  try {
    await db
      .update(userLlmConnection)
      .set({
        lastUsedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(userLlmConnection.id, id), eq(userLlmConnection.userId, userId))
      );
  } catch (_error) {
    throw new OpenChatError(
      "bad_request:database",
      "Failed to update user LLM connection last used"
    );
  }
}
