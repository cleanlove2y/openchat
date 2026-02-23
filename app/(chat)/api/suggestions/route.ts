import {
  type AuthenticatedSession,
  createAuthedApiRoute,
} from "@/app/(chat)/api/_shared/authed-route";
import { getSuggestionsByDocumentId } from "@/lib/db/queries";
import { OpenChatError } from "@/lib/errors";
import { z } from "zod";

const suggestionsQuerySchema = z.object({
  documentId: z.string().min(1),
});

const getHandler = async ({
  session,
  input,
}: {
  session: AuthenticatedSession;
  input: z.infer<typeof suggestionsQuerySchema>;
}) => {
  const { documentId } = input;

  const suggestions = await getSuggestionsByDocumentId({
    documentId,
  });

  const [suggestion] = suggestions;

  if (!suggestion) {
    return Response.json([], { status: 200 });
  }

  if (suggestion.userId !== session.user.id) {
    return new OpenChatError("forbidden:api").toResponse();
  }

  return Response.json(suggestions, { status: 200 });
};

export const GET = createAuthedApiRoute<
  z.infer<typeof suggestionsQuerySchema>
>({
    route: "/api/suggestions",
    method: "GET",
    unauthorizedErrorCode: "unauthorized:suggestions",
    badRequestErrorCode: "bad_request:api",
    parseRequest: async (request) => {
      const searchParams = new URL(request.url).searchParams;
      return suggestionsQuerySchema.parse({
        documentId: searchParams.get("documentId"),
      });
    },
    handler: getHandler,
  });
