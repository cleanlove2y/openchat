"use server";

import { generateText, type UIMessage } from "ai";
import { cookies } from "next/headers";
import type { VisibilityType } from "@/components/visibility-selector";
import { titlePrompt } from "@/lib/ai/prompts";
import { getTitleModel } from "@/lib/ai/providers";
import {
  deleteMessagesByChatIdAfterTimestamp,
  getMessageById,
  updateChatVisibilityById,
} from "@/lib/db/queries";
import { writeAuditLog } from "@/lib/logging";
import { auth } from "@/lib/server/auth/core";
import { getTextFromMessage } from "@/lib/utils";

export async function saveChatModelAsCookie(model: string) {
  const cookieStore = await cookies();
  cookieStore.set("chat-model", model);
}

export async function generateTitleFromUserMessage({
  message,
}: {
  message: UIMessage;
}) {
  const { text } = await generateText({
    model: getTitleModel(),
    system: titlePrompt,
    prompt: getTextFromMessage(message),
  });
  return text
    .replace(/^[#*"\s]+/, "")
    .replace(/["]+$/, "")
    .trim();
}

export async function deleteTrailingMessages({ id }: { id: string }) {
  const session = await auth();

  try {
    const [message] = await getMessageById({ id });

    await deleteMessagesByChatIdAfterTimestamp({
      chatId: message.chatId,
      timestamp: message.createdAt,
    });

    writeAuditLog({
      action: "chat.delete_trailing_messages",
      resourceType: "chat",
      resourceId: message.chatId,
      outcome: "success",
      actorId: session?.user?.id,
      actorType: session?.user?.type,
      metadata: {
        fromMessageId: id,
      },
    });
  } catch (error) {
    writeAuditLog({
      action: "chat.delete_trailing_messages",
      resourceType: "chat",
      outcome: "failure",
      statusCode: 500,
      reason: error instanceof Error ? error.message : "unknown_error",
      actorId: session?.user?.id,
      actorType: session?.user?.type,
      metadata: {
        fromMessageId: id,
      },
    });

    throw error;
  }
}

export async function updateChatVisibility({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: VisibilityType;
}) {
  const session = await auth();

  try {
    await updateChatVisibilityById({ chatId, visibility });

    writeAuditLog({
      action: "chat.update_visibility",
      resourceType: "chat",
      resourceId: chatId,
      outcome: "success",
      actorId: session?.user?.id,
      actorType: session?.user?.type,
      metadata: {
        visibility,
      },
    });
  } catch (error) {
    writeAuditLog({
      action: "chat.update_visibility",
      resourceType: "chat",
      resourceId: chatId,
      outcome: "failure",
      statusCode: 500,
      reason: error instanceof Error ? error.message : "unknown_error",
      actorId: session?.user?.id,
      actorType: session?.user?.type,
      metadata: {
        visibility,
      },
    });

    throw error;
  }
}
