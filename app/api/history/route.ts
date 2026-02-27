import { z } from "zod";
import {
  type AuthenticatedSession,
  createAuthedApiRoute,
} from "@/app/api/_shared/authed-route";
import { deleteAllChatsByUserId, getChatsByUserId } from "@/lib/db/queries";
import { OpenChatError } from "@/lib/errors";

const historyInputSchema = z.object({
  limit: z.number().int().positive(),
  startingAfter: z.string().nullable(),
  endingBefore: z.string().nullable(),
});

const getHandler = async ({
  session,
  input,
}: {
  session: AuthenticatedSession;
  input: z.infer<typeof historyInputSchema>;
}) => {
  const { limit, startingAfter, endingBefore } = input;

  const chats = await getChatsByUserId({
    id: session.user.id,
    limit,
    startingAfter,
    endingBefore,
  });

  return Response.json(chats);
};

const deleteHandler = async (session: AuthenticatedSession) => {
  const result = await deleteAllChatsByUserId({ userId: session.user.id });

  return Response.json(result, { status: 200 });
};

export const GET = createAuthedApiRoute<z.infer<typeof historyInputSchema>>({
  route: "/api/history",
  method: "GET",
  unauthorizedErrorCode: "unauthorized:chat",
  badRequestErrorCode: "bad_request:api",
  parseRequest: (request) => {
    const searchParams = new URL(request.url).searchParams;
    const limitRaw = searchParams.get("limit") || "10";
    const parsedLimit = Number.parseInt(limitRaw, 10);
    const limit = Number.isNaN(parsedLimit) ? 10 : parsedLimit;
    const startingAfter = searchParams.get("starting_after");
    const endingBefore = searchParams.get("ending_before");

    if (startingAfter && endingBefore) {
      throw new OpenChatError(
        "bad_request:api",
        "Only one of starting_after or ending_before can be provided."
      );
    }

    return historyInputSchema.parse({
      limit,
      startingAfter,
      endingBefore,
    });
  },
  handler: getHandler,
});

export const DELETE = createAuthedApiRoute({
  route: "/api/history",
  method: "DELETE",
  unauthorizedErrorCode: "unauthorized:chat",
  audit: {
    action: "chat.delete_all",
    resourceType: "chat_collection",
  },
  handler: ({ session }) => deleteHandler(session),
});
