import type {
  ModelCapabilityRecord,
  ModelCapabilitySource,
  ModelCapabilityStatus,
} from "@/lib/user-llm";

export const MODEL_CAPABILITY_ENDPOINT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function buildModelListSeedCapabilitiesFromTags(
  rawTags: unknown
): ModelCapabilityRecord | null {
  if (!Array.isArray(rawTags)) {
    return null;
  }

  const normalizedTags = rawTags
    .map((tag) => String(tag).toLowerCase())
    .filter(Boolean);
  const capabilities: ModelCapabilityRecord = {};

  if (
    normalizedTags.includes("file-input") ||
    normalizedTags.includes("vision")
  ) {
    capabilities.attachments = {
      status: "supported",
      confidence: "low",
      source: "vercel_gateway_models",
    };
  }

  if (normalizedTags.includes("reasoning")) {
    capabilities.reasoning = {
      status: "supported",
      confidence: "low",
      source: "vercel_gateway_models",
    };
  }

  return Object.keys(capabilities).length > 0 ? capabilities : null;
}

export function buildEndpointToolCapabilityRecord(
  status: ModelCapabilityStatus
): ModelCapabilityRecord | null {
  if (status === "unknown") {
    return null;
  }

  return {
    tools: {
      status,
      confidence: "medium",
      source: "vercel_gateway_endpoints",
    },
  };
}

export function getVercelModelEndpointsUrl(modelId: string): string | null {
  const separatorIndex = modelId.indexOf("/");

  if (separatorIndex <= 0 || separatorIndex === modelId.length - 1) {
    return null;
  }

  const creator = modelId.slice(0, separatorIndex);
  const model = modelId.slice(separatorIndex + 1);

  return `https://ai-gateway.vercel.sh/v1/models/${encodeURIComponent(
    creator
  )}/${encodeURIComponent(model)}/endpoints`;
}

export async function fetchSystemModelToolCapabilityFromEndpoints(
  modelId: string
): Promise<ModelCapabilityStatus> {
  const url = getVercelModelEndpointsUrl(modelId);

  if (!url) {
    return "unknown";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return "unknown";
    }

    const payload = await response.json().catch(() => null);

    return parseToolCapabilityFromEndpointPayload(payload);
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isLegacyTagBasedToolCapabilitySource(source: unknown) {
  return ["vercel_gateway", "vercel_gateway_models"].includes(
    String(source || "")
  );
}

export function shouldRefreshEndpointToolCapability(input: {
  source?: ModelCapabilitySource | string | null;
  lastDetectedAt?: Date | null;
  updatedAt?: Date | null;
}) {
  if (!input.source) {
    return true;
  }

  if (isLegacyTagBasedToolCapabilitySource(input.source)) {
    return true;
  }

  if (input.source !== "vercel_gateway_endpoints") {
    return false;
  }

  const refreshedAt = input.lastDetectedAt ?? input.updatedAt;

  if (!refreshedAt) {
    return true;
  }

  return Date.now() - refreshedAt.getTime() > MODEL_CAPABILITY_ENDPOINT_TTL_MS;
}

export function parseToolCapabilityFromEndpointPayload(
  payload: unknown
): ModelCapabilityStatus {
  if (!payload || typeof payload !== "object") {
    return "unknown";
  }

  const data = (payload as { data?: unknown }).data;

  if (!data || typeof data !== "object") {
    return "unknown";
  }

  const endpoints = (data as { endpoints?: unknown }).endpoints;

  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    return "unknown";
  }

  const endpointSupportsTools = endpoints
    .map((endpoint) => {
      if (!endpoint || typeof endpoint !== "object") {
        return null;
      }

      const supportedParameters = (
        endpoint as { supported_parameters?: unknown }
      ).supported_parameters;

      if (!Array.isArray(supportedParameters)) {
        return null;
      }

      return supportedParameters
        .map((parameter) => String(parameter).toLowerCase())
        .includes("tools");
    })
    .filter((value): value is boolean => typeof value === "boolean");

  if (endpointSupportsTools.length === 0) {
    return "unknown";
  }

  const allSupportTools = endpointSupportsTools.every(Boolean);
  const noneSupportTools = endpointSupportsTools.every(
    (supportsTools) => !supportsTools
  );

  if (allSupportTools) {
    return "supported";
  }

  if (noneSupportTools) {
    return "unsupported";
  }

  return "unknown";
}
