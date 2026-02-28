import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createConnectionSchema,
  requireRegularUserSession,
} from "@/app/api/user-llm/_shared";
import {
  createUserLlmConnection,
  getUserLlmConnections,
  saveUserLlmModelCache,
  updateUserLlmConnectionValidation,
} from "@/lib/db/queries";
import { OpenChatError } from "@/lib/errors";
import { encryptSecret } from "@/lib/security/secret-box";
import {
  serializeUserLlmConnection,
  validateOpenAICompatibleConfig,
} from "@/lib/server/user-llm";
import {
  normalizeBaseUrl,
  normalizeConnectionProvider,
  type OpenAICompatibleModel,
} from "@/lib/user-llm";

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

export async function GET() {
  try {
    const session = await requireRegularUserSession();
    const connections = await getUserLlmConnections({
      userId: session.user.id,
    });

    return NextResponse.json({
      connections: connections.map(serializeUserLlmConnection),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireRegularUserSession();
    const body = createConnectionSchema.parse(await request.json());

    let apiKeyEncrypted: string;

    try {
      apiKeyEncrypted = encryptSecret(body.apiKey);
    } catch {
      throw new OpenChatError(
        "bad_request:api",
        "Server is not configured to store encrypted API keys"
      );
    }

    const normalizedBaseUrl = normalizeBaseUrl(body.baseUrl);
    const provider = normalizeConnectionProvider({
      provider: body.provider,
      baseUrl: normalizedBaseUrl,
    });

    let validatedModels: OpenAICompatibleModel[] | undefined;

    if (body.validate ?? true) {
      const validation = await validateOpenAICompatibleConfig({
        baseUrl: normalizedBaseUrl,
        apiKey: body.apiKey,
        model: body.defaultModel,
      });

      if (!validation.ok) {
        throw new OpenChatError("bad_request:api", validation.error);
      }

      validatedModels = validation.models;
    }

    const connection = await createUserLlmConnection({
      userId: session.user.id,
      name: body.name,
      provider,
      baseUrl: normalizedBaseUrl,
      apiKeyEncrypted,
      defaultModel: body.defaultModel,
      defaultTemperature: body.defaultTemperature,
      enabled: body.enabled,
      isDefault: body.isDefault,
    });

    if (validatedModels && validatedModels.length > 0) {
      await saveUserLlmModelCache({
        connectionId: connection.id,
        modelsJson: validatedModels,
      });
    }

    if (body.validate ?? true) {
      await updateUserLlmConnectionValidation({
        id: connection.id,
        userId: session.user.id,
        lastValidationError: null,
      });
    }

    return NextResponse.json(serializeUserLlmConnection(connection), {
      status: 201,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
