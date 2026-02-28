import "server-only";

import type { UserLlmConnection } from "@/lib/db/schema";
import { OpenChatError } from "@/lib/errors";
import { decryptSecret } from "@/lib/security/secret-box";
import {
  chatCompletionsEndpoint,
  modelsEndpoint,
  normalizeConnectionProvider,
  type OpenAICompatibleModel,
} from "@/lib/user-llm";

export type ConnectionResponse = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  defaultModel: string | null;
  defaultTemperature: string | null;
  enabled: boolean;
  isDefault: boolean;
  hasApiKey: boolean;
  lastValidatedAt: string | null;
  lastValidationError: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export function serializeUserLlmConnection(
  connection: UserLlmConnection
): ConnectionResponse {
  const normalizedProvider = normalizeConnectionProvider({
    provider: connection.provider,
    baseUrl: connection.baseUrl,
  });

  return {
    id: connection.id,
    name: connection.name,
    provider: normalizedProvider,
    baseUrl: connection.baseUrl,
    defaultModel: connection.defaultModel,
    defaultTemperature: connection.defaultTemperature,
    enabled: connection.enabled,
    isDefault: connection.isDefault,
    hasApiKey: Boolean(connection.apiKeyEncrypted),
    lastValidatedAt: connection.lastValidatedAt?.toISOString() ?? null,
    lastValidationError: connection.lastValidationError,
    lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildAuthHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

function normalizeModelList(payload: unknown): OpenAICompatibleModel[] {
  const responseData =
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { data?: unknown[] }).data)
      ? (payload as { data: unknown[] }).data
      : [];

  const models: OpenAICompatibleModel[] = [];

  for (const item of responseData) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const rawItem = item as Record<string, unknown>;
    const id = typeof rawItem.id === "string" ? rawItem.id : "";

    if (!id) {
      continue;
    }

    models.push({
      id,
      name:
        typeof rawItem.name === "string" && rawItem.name.length > 0
          ? rawItem.name
          : id,
      object: typeof rawItem.object === "string" ? rawItem.object : "model",
      description:
        typeof rawItem.description === "string" ? rawItem.description : "",
    });
  }

  const deduped = new Map<string, OpenAICompatibleModel>();

  for (const model of models) {
    deduped.set(model.id, model);
  }

  return Array.from(deduped.values());
}

export async function fetchOpenAICompatibleModels({
  baseUrl,
  apiKey,
}: {
  baseUrl: string;
  apiKey: string;
}): Promise<OpenAICompatibleModel[]> {
  const response = await fetchWithTimeout(
    modelsEndpoint(baseUrl),
    {
      method: "GET",
      headers: buildAuthHeaders(apiKey),
    },
    8000
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    const errorSnippet =
      errorText.length > 240 ? `${errorText.slice(0, 240)}...` : errorText;

    throw new OpenChatError(
      "bad_request:api",
      errorSnippet || `Model request failed with status ${response.status}`
    );
  }

  const payload = (await response.json().catch(() => null)) as unknown;
  const models = normalizeModelList(payload);

  if (models.length === 0) {
    throw new OpenChatError(
      "bad_request:api",
      "The provider returned an empty model list"
    );
  }

  return models;
}

export async function validateOpenAICompatibleConfig({
  baseUrl,
  apiKey,
  model,
}: {
  baseUrl: string;
  apiKey: string;
  model: string | null;
}): Promise<
  { ok: true; models?: OpenAICompatibleModel[] } | { ok: false; error: string }
> {
  try {
    const models = await fetchOpenAICompatibleModels({ baseUrl, apiKey });

    if (model && !models.some((item) => item.id === model)) {
      return {
        ok: false,
        error: "Model not found on the endpoint. Check the model name.",
      };
    }

    return { ok: true, models };
  } catch (error) {
    if (!model) {
      return {
        ok: false,
        error:
          error instanceof OpenChatError && typeof error.cause === "string"
            ? error.cause
            : "Failed to validate via /v1/models. Provide a default model to fall back to chat validation.",
      };
    }
  }

  if (!model) {
    return {
      ok: false,
      error:
        "Failed to validate via /v1/models. Provide a default model to fall back to chat validation.",
    };
  }

  try {
    const response = await fetchWithTimeout(
      chatCompletionsEndpoint(baseUrl),
      {
        method: "POST",
        headers: buildAuthHeaders(apiKey),
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          temperature: 0,
        }),
      },
      10_000
    );

    if (response.ok) {
      return { ok: true };
    }

    const errorText = await response.text().catch(() => "");
    return {
      ok: false,
      error:
        errorText.length > 240
          ? `${errorText.slice(0, 240)}...`
          : errorText || `Validation failed with status ${response.status}`,
    };
  } catch {
    return {
      ok: false,
      error: "Validation request failed. Check the base URL and API key.",
    };
  }
}

export function getConnectionApiKey(connection: UserLlmConnection): string {
  if (!connection.apiKeyEncrypted) {
    throw new OpenChatError(
      "bad_request:api",
      "This connection does not have an API key saved"
    );
  }

  const apiKey = decryptSecret(connection.apiKeyEncrypted);

  if (!apiKey) {
    throw new OpenChatError(
      "bad_request:api",
      "Failed to decrypt the saved API key"
    );
  }

  return apiKey;
}

export function parseConnectionTemperature(
  value: string | null
): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.min(2, Math.max(0, parsed));
}
