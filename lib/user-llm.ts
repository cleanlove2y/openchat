import type { ChatModel } from "@/lib/ai/models";

export const USER_CONNECTION_MODEL_PREFIX = "conn_";

export type ProviderTemplateId =
  | "openai"
  | "deepseek"
  | "qwen"
  | "openrouter"
  | "litellm"
  | "custom";

export type StoredConnectionProvider = ProviderTemplateId | "openai_compatible";

export type UserFacingChatModel = ChatModel & {
  source: "system" | "user";
  connectionId?: string;
  realId?: string;
};

export type OpenAICompatibleModel = {
  id: string;
  name?: string;
  object?: string;
  description?: string;
};

export const PROVIDER_TEMPLATES: Record<
  ProviderTemplateId,
  {
    name: string;
    provider: StoredConnectionProvider;
    baseUrl: string;
    defaultModel: string;
  }
> = {
  openai: {
    name: "OpenAI",
    provider: "openai_compatible",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4.1-mini",
  },
  deepseek: {
    name: "DeepSeek",
    provider: "openai_compatible",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
  },
  qwen: {
    name: "Qwen (DashScope)",
    provider: "openai_compatible",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
  },
  openrouter: {
    name: "OpenRouter",
    provider: "openai_compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4.1-mini",
  },
  litellm: {
    name: "LiteLLM Proxy",
    provider: "openai_compatible",
    baseUrl: "",
    defaultModel: "",
  },
  custom: {
    name: "Custom OpenAI-Compatible",
    provider: "openai_compatible",
    baseUrl: "",
    defaultModel: "",
  },
};

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function modelsEndpoint(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);

  if (normalized.endsWith("/v1")) {
    return `${normalized}/models`;
  }

  return `${normalized}/v1/models`;
}

export function chatCompletionsEndpoint(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);

  if (normalized.endsWith("/v1")) {
    return `${normalized}/chat/completions`;
  }

  return `${normalized}/v1/chat/completions`;
}

export function encodeUserConnectionModelId({
  connectionId,
  modelId,
}: {
  connectionId: string;
  modelId: string;
}): string {
  return `${USER_CONNECTION_MODEL_PREFIX}${connectionId}__${modelId}`;
}

export function decodeUserConnectionModelId(modelId: string): {
  connectionId: string;
  modelId: string;
} | null {
  if (!modelId.startsWith(USER_CONNECTION_MODEL_PREFIX)) {
    return null;
  }

  const stripped = modelId.slice(USER_CONNECTION_MODEL_PREFIX.length);
  const separatorIndex = stripped.indexOf("__");

  if (separatorIndex === -1) {
    return null;
  }

  const connectionId = stripped.slice(0, separatorIndex);
  const decodedModelId = stripped.slice(separatorIndex + 2);

  if (!connectionId || !decodedModelId) {
    return null;
  }

  return {
    connectionId,
    modelId: decodedModelId,
  };
}

export function isUserConnectionModelId(modelId: string): boolean {
  return decodeUserConnectionModelId(modelId) !== null;
}

export function guessProviderFromUrl(baseUrl: string): ProviderTemplateId {
  const normalized = normalizeBaseUrl(baseUrl).toLowerCase();

  if (normalized.includes("api.openai.com")) {
    return "openai";
  }

  if (normalized.includes("api.deepseek.com")) {
    return "deepseek";
  }

  if (normalized.includes("dashscope.aliyuncs.com")) {
    return "qwen";
  }

  if (normalized.includes("openrouter.ai")) {
    return "openrouter";
  }

  if (normalized.includes("litellm")) {
    return "litellm";
  }

  return "custom";
}

export function normalizeConnectionProvider({
  provider,
  baseUrl,
}: {
  provider: string;
  baseUrl: string;
}): ProviderTemplateId {
  if (provider in PROVIDER_TEMPLATES) {
    return provider as ProviderTemplateId;
  }

  return guessProviderFromUrl(baseUrl);
}

export function getProviderDisplayName(provider: string): string {
  if (provider in PROVIDER_TEMPLATES) {
    return PROVIDER_TEMPLATES[provider as ProviderTemplateId].name;
  }

  switch (provider) {
    case "anthropic":
      return "Anthropic";
    case "openai_compatible":
      return "OpenAI-Compatible";
    case "google":
      return "Google";
    case "xai":
      return "xAI";
    default:
      return provider;
  }
}

export function getModelLogoProvider(provider: string): string {
  switch (provider) {
    case "qwen":
      return "alibaba";
    case "litellm":
    case "custom":
    case "openai_compatible":
      return "openai";
    default:
      return provider;
  }
}
