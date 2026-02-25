import {
  type AuthenticatedSession,
  createAuthedApiRoute,
} from "@/app/api/_shared/authed-route";
import { getChatById, getVotesByChatId, voteMessage } from "@/lib/db/queries";
import { OpenChatError } from "@/lib/errors";
import { z } from "zod";

const voteGetQuerySchema = z.object({
  chatId: z.string().min(1),
});

const votePatchInputSchema = z.object({
  chatId: z.string().min(1),
  messageId: z.string().min(1),
  type: z.enum(["up", "down"]),
});

const getHandler = async ({
  session,
  input,
}: {
  session: AuthenticatedSession;
  input: z.infer<typeof voteGetQuerySchema>;
}) => {
  const { chatId } = input;

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new OpenChatError("not_found:chat").toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new OpenChatError("forbidden:vote").toResponse();
  }

  const votes = await getVotesByChatId({ id: chatId });

  return Response.json(votes, { status: 200 });
};

const patchHandler = async ({
  session,
  input,
}: {
  session: AuthenticatedSession;
  input: z.infer<typeof votePatchInputSchema>;
}) => {
  const { chatId, messageId, type } = input;

  const chat = await getChatById({ id: chatId });

  if (!chat) {
    return new OpenChatError("not_found:vote").toResponse();
  }

  if (chat.userId !== session.user.id) {
    return new OpenChatError("forbidden:vote").toResponse();
  }

  await voteMessage({
    chatId,
    messageId,
    type,
  });

  return new Response("Message voted", { status: 200 });
};

export const GET = createAuthedApiRoute<z.infer<typeof voteGetQuerySchema>>({
    route: "/api/vote",
    method: "GET",
    unauthorizedErrorCode: "unauthorized:vote",
    badRequestErrorCode: "bad_request:api",
    parseRequest: async (request) => {
      const searchParams = new URL(request.url).searchParams;
      return voteGetQuerySchema.parse({
        chatId: searchParams.get("chatId"),
      });
    },
    handler: getHandler,
  });

export const PATCH = createAuthedApiRoute<z.infer<typeof votePatchInputSchema>>({
    route: "/api/vote",
    method: "PATCH",
    unauthorizedErrorCode: "unauthorized:vote",
    badRequestErrorCode: "bad_request:api",
    parseRequest: async (request) =>
      votePatchInputSchema.parse(await request.json()),
    audit: {
      action: "vote.update",
      resourceType: "vote",
      getMetadata: async (requestForAudit) => {
        try {
          const body = (await requestForAudit.json()) as {
            chatId?: unknown;
            messageId?: unknown;
            type?: unknown;
          };

          return {
            chatId: typeof body.chatId === "string" ? body.chatId : null,
            messageId:
              typeof body.messageId === "string" ? body.messageId : null,
            voteType: typeof body.type === "string" ? body.type : null,
          };
        } catch (_) {
          return undefined;
        }
      },
    },
    handler: patchHandler,
  });

