import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEndpointToolCapabilityRecord,
  buildModelListSeedCapabilitiesFromTags,
  getVercelModelEndpointsUrl,
  isLegacyTagBasedToolCapabilitySource,
  MODEL_CAPABILITY_ENDPOINT_TTL_MS,
  parseToolCapabilityFromEndpointPayload,
  shouldRefreshEndpointToolCapability,
} from "./vercel";

test("buildModelListSeedCapabilitiesFromTags only seeds attachments and reasoning", () => {
  const result = buildModelListSeedCapabilitiesFromTags([
    "file-input",
    "tool-use",
    "reasoning",
  ]);

  assert.equal(result?.attachments?.status, "supported");
  assert.equal(result?.reasoning?.status, "supported");
  assert.equal(result?.tools, undefined);
});

test("getVercelModelEndpointsUrl builds the endpoint URL", () => {
  const result = getVercelModelEndpointsUrl("alibaba/qwen3-max");

  assert.equal(
    result,
    "https://ai-gateway.vercel.sh/v1/models/alibaba/qwen3-max/endpoints"
  );
});

test("parseToolCapabilityFromEndpointPayload returns supported when all endpoints support tools", () => {
  const result = parseToolCapabilityFromEndpointPayload({
    data: {
      endpoints: [
        { supported_parameters: ["tools", "temperature"] },
        { supported_parameters: ["max_tokens", "tool_choice", "tools"] },
      ],
    },
  });

  assert.equal(result, "supported");
});

test("parseToolCapabilityFromEndpointPayload returns unsupported when no endpoints support tools", () => {
  const result = parseToolCapabilityFromEndpointPayload({
    data: {
      endpoints: [
        { supported_parameters: ["temperature"] },
        { supported_parameters: ["max_tokens", "stop"] },
      ],
    },
  });

  assert.equal(result, "unsupported");
});

test("parseToolCapabilityFromEndpointPayload returns unknown when endpoint support is mixed", () => {
  const result = parseToolCapabilityFromEndpointPayload({
    data: {
      endpoints: [
        { supported_parameters: ["tools", "temperature"] },
        { supported_parameters: ["temperature"] },
      ],
    },
  });

  assert.equal(result, "unknown");
});

test("buildEndpointToolCapabilityRecord omits unknown states", () => {
  assert.equal(buildEndpointToolCapabilityRecord("unknown"), null);
  assert.equal(
    buildEndpointToolCapabilityRecord("supported")?.tools?.source,
    "vercel_gateway_endpoints"
  );
});

test("shouldRefreshEndpointToolCapability refreshes missing, legacy, and expired endpoint cache", () => {
  assert.equal(shouldRefreshEndpointToolCapability({}), true);
  assert.equal(
    shouldRefreshEndpointToolCapability({ source: "vercel_gateway_models" }),
    true
  );
  assert.equal(
    shouldRefreshEndpointToolCapability({
      source: "vercel_gateway_endpoints",
      lastDetectedAt: new Date(
        Date.now() - MODEL_CAPABILITY_ENDPOINT_TTL_MS - 1
      ),
    }),
    true
  );
  assert.equal(
    shouldRefreshEndpointToolCapability({
      source: "vercel_gateway_endpoints",
      lastDetectedAt: new Date(),
    }),
    false
  );
  assert.equal(
    shouldRefreshEndpointToolCapability({
      source: "runtime_error_fallback",
    }),
    false
  );
});

test("isLegacyTagBasedToolCapabilitySource detects legacy Vercel tag sources", () => {
  assert.equal(isLegacyTagBasedToolCapabilitySource("vercel_gateway"), true);
  assert.equal(
    isLegacyTagBasedToolCapabilitySource("vercel_gateway_models"),
    true
  );
  assert.equal(
    isLegacyTagBasedToolCapabilitySource("vercel_gateway_endpoints"),
    false
  );
});
