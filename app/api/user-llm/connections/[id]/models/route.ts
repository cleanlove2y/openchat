import { NextResponse } from "next/server";
import { z } from "zod";
import {
  connectionIdSchema,
  requireRegularUserSession,
} from "@/app/api/user-llm/_shared";
import {
  getUserLlmConnectionById,
  saveUserLlmModelCache,
  updateUserLlmConnectionValidation,
} from "@/lib/db/queries";
import { OpenChatError } from "@/lib/errors";
import {
  fetchOpenAICompatibleModels,
  getConnectionApiKey,
} from "@/lib/server/user-llm";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function toErrorResponse(error: unknown) {
  if (error instanceof OpenChatError) {
    return error.toResponse();
  }

  if (error instanceof z.ZodError) {
    return new OpenChatError(
      "bad_request:api",
      error.issues[0]?.message
    ).toResponse();
  }

  if (error instanceof Error) {
    return new OpenChatError("bad_request:api", error.message).toResponse();
  }

  return new OpenChatError("bad_request:api").toResponse();
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireRegularUserSession();
    const params = await context.params;
    const id = connectionIdSchema.parse(params.id);
    const connection = await getUserLlmConnectionById({
      id,
      userId: session.user.id,
    });

    if (!connection) {
      throw new OpenChatError("bad_request:api", "Connection not found");
    }

    const models = await fetchOpenAICompatibleModels({
      baseUrl: connection.baseUrl,
      apiKey: getConnectionApiKey(connection),
    });

    await saveUserLlmModelCache({
      connectionId: connection.id,
      modelsJson: models,
    });
    await updateUserLlmConnectionValidation({
      id: connection.id,
      userId: session.user.id,
      lastValidationError: null,
    });

    return NextResponse.json({ models });
  } catch (error) {
    if (error instanceof OpenChatError && context?.params) {
      try {
        const params = await context.params;
        const id = connectionIdSchema.safeParse(params.id);

        if (id.success) {
          const session = await requireRegularUserSession();
          await updateUserLlmConnectionValidation({
            id: id.data,
            userId: session.user.id,
            lastValidationError: error.cause?.toString() || error.message,
          });
        }
      } catch {
        // Ignore secondary validation persistence failures.
      }
    }

    return toErrorResponse(error);
  }
}
