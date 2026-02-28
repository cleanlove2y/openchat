import { NextResponse } from "next/server";
import { z } from "zod";
import {
  connectionIdSchema,
  requireRegularUserSession,
  updateConnectionSchema,
} from "@/app/api/user-llm/_shared";
import {
  deleteUserLlmConnection,
  getUserLlmConnectionById,
  saveUserLlmModelCache,
  updateUserLlmConnection,
  updateUserLlmConnectionValidation,
} from "@/lib/db/queries";
import { OpenChatError } from "@/lib/errors";
import { encryptSecret } from "@/lib/security/secret-box";
import {
  getConnectionApiKey,
  serializeUserLlmConnection,
  validateOpenAICompatibleConfig,
} from "@/lib/server/user-llm";
import { normalizeBaseUrl, normalizeConnectionProvider } from "@/lib/user-llm";

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

async function getConnectionOrThrow({
  id,
  userId,
}: {
  id: string;
  userId: string;
}) {
  const connection = await getUserLlmConnectionById({ id, userId });

  if (!connection) {
    throw new OpenChatError("bad_request:api", "Connection not found");
  }

  return connection;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const session = await requireRegularUserSession();
    const params = await context.params;
    const id = connectionIdSchema.parse(params.id);
    const connection = await getConnectionOrThrow({
      id,
      userId: session.user.id,
    });

    return NextResponse.json(serializeUserLlmConnection(connection));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const session = await requireRegularUserSession();
    const params = await context.params;
    const id = connectionIdSchema.parse(params.id);
    const currentConnection = await getConnectionOrThrow({
      id,
      userId: session.user.id,
    });
    const body = updateConnectionSchema.parse(await request.json());

    const baseUrl = normalizeBaseUrl(body.baseUrl ?? currentConnection.baseUrl);
    const provider = normalizeConnectionProvider({
      provider: body.provider ?? currentConnection.provider,
      baseUrl,
    });

    const shouldValidate = body.validate ?? true;

    if (shouldValidate) {
      const apiKey = body.apiKey ?? getConnectionApiKey(currentConnection);
      const validation = await validateOpenAICompatibleConfig({
        baseUrl,
        apiKey,
        model: body.defaultModel ?? currentConnection.defaultModel,
      });

      if (!validation.ok) {
        await updateUserLlmConnectionValidation({
          id,
          userId: session.user.id,
          lastValidationError: validation.error,
        });
        throw new OpenChatError("bad_request:api", validation.error);
      }

      if (validation.models && validation.models.length > 0) {
        await saveUserLlmModelCache({
          connectionId: id,
          modelsJson: validation.models,
        });
      }

      await updateUserLlmConnectionValidation({
        id,
        userId: session.user.id,
        lastValidationError: null,
      });
    }

    const updatedConnection = await updateUserLlmConnection({
      id,
      userId: session.user.id,
      name: body.name,
      provider,
      baseUrl,
      apiKeyEncrypted:
        body.apiKey !== undefined ? encryptSecret(body.apiKey) : undefined,
      defaultModel: body.defaultModel,
      defaultTemperature: body.defaultTemperature,
      enabled: body.enabled,
      isDefault: body.isDefault,
    });

    if (!updatedConnection) {
      throw new OpenChatError("bad_request:api", "Connection not found");
    }

    return NextResponse.json(serializeUserLlmConnection(updatedConnection));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const session = await requireRegularUserSession();
    const params = await context.params;
    const id = connectionIdSchema.parse(params.id);
    const deletedConnection = await deleteUserLlmConnection({
      id,
      userId: session.user.id,
    });

    if (!deletedConnection) {
      throw new OpenChatError("bad_request:api", "Connection not found");
    }

    return NextResponse.json({ id: deletedConnection.id });
  } catch (error) {
    return toErrorResponse(error);
  }
}
