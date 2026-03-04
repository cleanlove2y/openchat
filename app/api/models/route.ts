import { NextResponse } from "next/server";
import {
  buildModelListSeedCapabilitiesFromTags,
} from "@/lib/ai/model-capabilities/vercel";
import { chatModels } from "@/lib/ai/models";
import {
  clearLegacySystemToolCapabilitySeeds,
  getUserLlmConnections,
  getUserLlmModelCache,
  listModelCapabilityOverrides,
  upsertModelCapabilityOverride,
} from "@/lib/db/queries";
import type { ModelCapabilityOverride as ModelCapabilityOverrideRow } from "@/lib/db/schema";
import { auth } from "@/lib/server/auth/core";
import {
  encodeUserConnectionModelId,
  getProviderDisplayName,
  type ModelCapabilityKey,
  type ModelCapabilityRecord,
  type UserFacingModelCapabilities,
  normalizeConnectionProvider,
  type OpenAICompatibleModel,
  type UserFacingChatModel,
} from "@/lib/user-llm";
import { getAppLogger } from "@/lib/logging";

type SystemModelFetchResult = {
  models: UserFacingChatModel[];
  seedByModelId: Map<string, ModelCapabilityRecord>;
};
const appLogger = getAppLogger();

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

function buildDefaultCapabilities(): UserFacingModelCapabilities {
  return {
    attachments: "unknown",
    tools: "unknown",
    reasoning: "unknown",
  };
}

async function fetchSystemModels(): Promise<SystemModelFetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch("https://ai-gateway.vercel.sh/v1/models", {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        models: fallbackSystemModels(),
        seedByModelId: new Map(),
      };
    }

    const payload = (await response.json().catch(() => null)) as {
      data?: unknown[];
    } | null;

    if (!payload?.data || !Array.isArray(payload.data)) {
      return {
        models: fallbackSystemModels(),
        seedByModelId: new Map(),
      };
    }

    const deduped = new Map<string, UserFacingChatModel>();
    const seedByModelId = new Map<string, ModelCapabilityRecord>();

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

      const seedCapabilities = buildModelListSeedCapabilitiesFromTags(
        rawModel.tags
      );
      if (seedCapabilities) {
        seedByModelId.set(id, seedCapabilities);
      }
    }

    return deduped.size > 0
      ? { models: Array.from(deduped.values()), seedByModelId }
      : {
          models: fallbackSystemModels(),
          seedByModelId: new Map(),
        };
  } catch {
    return {
      models: fallbackSystemModels(),
      seedByModelId: new Map(),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function getModelCapabilityRefKey(model: UserFacingChatModel): string {
  const sourceType = model.source === "system" ? "system" : "user_connection";
  const connectionId = model.connectionId ?? "system";
  const modelId = model.realId ?? model.id;

  return `${sourceType}:${connectionId}:${modelId}`;
}

function buildCapabilityOverrideRowMap(
  overrides: ModelCapabilityOverrideRow[]
): Map<string, ModelCapabilityOverrideRow> {
  return new Map(
    overrides.map((entry) => [
      `${entry.sourceType}:${entry.connectionId ?? "system"}:${entry.modelId}`,
      entry,
    ])
  );
}

function attachCapabilitiesFromOverrides(
  models: UserFacingChatModel[],
  overrides: ModelCapabilityOverrideRow[]
) {
  const overrideMap = buildCapabilityOverrideRowMap(overrides);

  return models.map((model) => {
    const capabilityRecord =
      overrideMap.get(getModelCapabilityRefKey(model))?.capabilitiesJson ?? {};
    const nextCapabilities = buildDefaultCapabilities();

    for (const capabilityKey of Object.keys(
      nextCapabilities
    ) as ModelCapabilityKey[]) {
      nextCapabilities[capabilityKey] =
        capabilityRecord[capabilityKey]?.status ?? "unknown";
    }

    return {
      ...model,
      capabilities: nextCapabilities,
    };
  });
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

async function seedSystemModelCapabilities({
  models,
  seedByModelId,
}: SystemModelFetchResult) {
  const seedCandidates = models
    .map((model) => ({
      model,
      capabilities: seedByModelId.get(model.id),
    }))
    .filter(
      (
        entry
      ): entry is {
        model: UserFacingChatModel;
        capabilities: ModelCapabilityRecord;
      } => Boolean(entry.capabilities)
    );

  if (seedCandidates.length === 0) {
    return;
  }

  await Promise.all(
    seedCandidates.map(({ model, capabilities }) =>
      upsertModelCapabilityOverride({
        sourceType: "system",
        providerKey: model.provider,
        modelId: model.id,
        capabilities,
      })
    )
  );
}

export async function GET() {
  const systemModelsResult = await fetchSystemModels();
  const systemModels = systemModelsResult.models;
  const systemModelIds = systemModels.map((model) => model.id);

  await clearLegacySystemToolCapabilitySeeds({
    modelIds: systemModelIds,
  }).catch((error) => {
    appLogger.warn(
      {
        event: "api.models.legacy_tool_seed_cleanup_failed",
        error,
      },
      "Failed to clear legacy tag-based tool capability seeds; continuing without cleanup"
    );
  });
  await seedSystemModelCapabilities(systemModelsResult).catch((error) => {
    appLogger.warn(
      {
        event: "api.models.capability_seed_failed",
        error,
      },
      "Failed to seed model capabilities from Vercel AI Gateway; continuing without persistence"
    );
  });

  const session = await auth();

  if (!session?.user?.id || session.user.type !== "regular") {
    const modelsWithCapabilities = await listModelCapabilityOverrides({
      refs: systemModels.map((model) => ({
        sourceType: "system" as const,
        modelId: model.id,
      })),
    })
      .then((overrides) => attachCapabilitiesFromOverrides(systemModels, overrides))
      .catch((error) => {
        appLogger.warn(
          {
            event: "api.models.capability_attach_failed",
            error,
          },
          "Failed to load model capabilities; continuing with fallback capability defaults"
        );
        return systemModels.map((model) => ({
          ...model,
          capabilities: buildDefaultCapabilities(),
        }));
      });

    return NextResponse.json({
      object: "list",
      data: modelsWithCapabilities,
    });
  }

  const userModels = await buildUserModels(session.user.id);
  const combinedModels = [...userModels, ...systemModels];
  const modelsWithCapabilities = await listModelCapabilityOverrides({
    refs: combinedModels.map((model) => ({
      sourceType: model.source === "system" ? "system" : "user_connection",
      connectionId: model.connectionId ?? null,
      modelId: model.realId ?? model.id,
    })),
  })
    .then((overrides) => attachCapabilitiesFromOverrides(combinedModels, overrides))
    .catch((error) => {
      appLogger.warn(
        {
          event: "api.models.capability_attach_failed",
          error,
        },
        "Failed to load model capabilities; continuing with fallback capability defaults"
      );
      return combinedModels.map((model) => ({
        ...model,
        capabilities: buildDefaultCapabilities(),
      }));
    });

  return NextResponse.json({
    object: "list",
    data: modelsWithCapabilities,
  });
}
