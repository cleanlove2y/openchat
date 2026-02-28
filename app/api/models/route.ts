import { NextResponse } from "next/server";
import { chatModels } from "@/lib/ai/models";
import { getUserLlmConnections, getUserLlmModelCache } from "@/lib/db/queries";
import { auth } from "@/lib/server/auth/core";
import {
  encodeUserConnectionModelId,
  getProviderDisplayName,
  normalizeConnectionProvider,
  type OpenAICompatibleModel,
  type UserFacingChatModel,
} from "@/lib/user-llm";

function fallbackSystemModels(): UserFacingChatModel[] {
  return chatModels.map((model) => ({
    ...model,
    source: "system",
  }));
}

function inferSystemProvider(modelId: string): string {
  const [provider] = modelId.split("/");
  return provider || "vercel";
}

function isChatCapableModel(rawModel: Record<string, unknown>): boolean {
  const rawTypes = [
    ...(Array.isArray(rawModel.types) ? rawModel.types : []),
    ...(typeof rawModel.type === "string" ? [rawModel.type] : []),
  ]
    .map((typeValue) => String(typeValue).toLowerCase())
    .filter(Boolean);

  if (rawTypes.length === 0) {
    return true;
  }

  return rawTypes.some(
    (typeValue) =>
      typeValue.includes("chat") ||
      typeValue.includes("language") ||
      typeValue.includes("completion") ||
      typeValue.includes("text")
  );
}

async function fetchSystemModels(): Promise<UserFacingChatModel[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return fallbackSystemModels();
    }

    const payload = (await response.json().catch(() => null)) as {
      data?: unknown[];
    } | null;

    if (!payload?.data || !Array.isArray(payload.data)) {
      return fallbackSystemModels();
    }

    const deduped = new Map<string, UserFacingChatModel>();

    for (const item of payload.data) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const rawModel = item as Record<string, unknown>;
      const id = typeof rawModel.id === "string" ? rawModel.id : "";

      if (!id || !isChatCapableModel(rawModel)) {
        continue;
      }

      const provider =
        typeof rawModel.provider === "string"
          ? rawModel.provider
          : inferSystemProvider(id);
      const description =
        typeof rawModel.description === "string"
          ? rawModel.description
          : typeof rawModel.summary === "string"
            ? rawModel.summary
            : `${getProviderDisplayName(provider)} model`;

      deduped.set(id, {
        id,
        name:
          typeof rawModel.name === "string" && rawModel.name.length > 0
            ? rawModel.name
            : id,
        provider,
        description,
        source: "system",
      });
    }

    return deduped.size > 0
      ? Array.from(deduped.values())
      : fallbackSystemModels();
  } catch {
    return fallbackSystemModels();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function buildUserModels(userId: string): Promise<UserFacingChatModel[]> {
  const connections = await getUserLlmConnections({ userId });
  const enabledConnections = connections.filter(
    (connection) => connection.enabled
  );

  const caches = await Promise.all(
    enabledConnections.map(async (connection) => ({
      connection,
      cache: await getUserLlmModelCache({ connectionId: connection.id }),
    }))
  );

  const mergedModels = new Map<string, UserFacingChatModel>();

  for (const { connection, cache } of caches) {
    const provider = normalizeConnectionProvider({
      provider: connection.provider,
      baseUrl: connection.baseUrl,
    });
    const cachedModels = Array.isArray(cache?.modelsJson)
      ? (cache.modelsJson as OpenAICompatibleModel[])
      : [];

    if (cachedModels.length > 0) {
      for (const model of cachedModels) {
        const encodedId = encodeUserConnectionModelId({
          connectionId: connection.id,
          modelId: model.id,
        });

        mergedModels.set(encodedId, {
          id: encodedId,
          realId: model.id,
          connectionId: connection.id,
          name: `${model.name || model.id} (${connection.name})`,
          provider,
          description:
            model.description || `${connection.name} custom connection`,
          source: "user",
        });
      }

      continue;
    }

    if (connection.defaultModel) {
      const encodedId = encodeUserConnectionModelId({
        connectionId: connection.id,
        modelId: connection.defaultModel,
      });

      mergedModels.set(encodedId, {
        id: encodedId,
        realId: connection.defaultModel,
        connectionId: connection.id,
        name: `${connection.defaultModel} (${connection.name})`,
        provider,
        description: `${connection.name} custom connection`,
        source: "user",
      });
    }
  }

  return Array.from(mergedModels.values());
}

export async function GET() {
  const systemModels = await fetchSystemModels();
  const session = await auth();

  if (!session?.user?.id || session.user.type !== "regular") {
    return NextResponse.json({ object: "list", data: systemModels });
  }

  const userModels = await buildUserModels(session.user.id);

  return NextResponse.json({
    object: "list",
    data: [...userModels, ...systemModels],
  });
}
