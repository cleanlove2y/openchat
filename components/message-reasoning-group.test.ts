import assert from "node:assert/strict";
import test from "node:test";

type ReasoningPart = {
  type: string;
  text?: string;
  state?: "streaming" | "done";
};

test("collectMessageReasoning groups reasoning parts into one ordered payload", async () => {
  let collectMessageReasoning:
    | ((parts: ReasoningPart[]) => {
        segments: string[];
        isStreaming: boolean;
        hasReasoning: boolean;
      })
    | undefined;

  try {
    ({ collectMessageReasoning } = await import("./message-reasoning-group"));
  } catch {
    collectMessageReasoning = undefined;
  }

  assert.equal(typeof collectMessageReasoning, "function");
  if (!collectMessageReasoning) {
    assert.fail("collectMessageReasoning should be defined");
  }

  const result = collectMessageReasoning([
    { type: "text", text: "ignored" },
    { type: "reasoning", text: "First pass" },
    { type: "tool-getWeather" },
    { type: "reasoning", text: "Second pass", state: "streaming" },
    { type: "reasoning", text: "   " },
  ]);

  assert.deepEqual(result, {
    segments: ["First pass", "Second pass"],
    isStreaming: true,
    hasReasoning: true,
  });
});

test("collectMessageReasoning reports no reasoning when parts are empty or blank", async () => {
  let collectMessageReasoning:
    | ((parts: ReasoningPart[]) => {
        segments: string[];
        isStreaming: boolean;
        hasReasoning: boolean;
      })
    | undefined;

  try {
    ({ collectMessageReasoning } = await import("./message-reasoning-group"));
  } catch {
    collectMessageReasoning = undefined;
  }

  assert.equal(typeof collectMessageReasoning, "function");
  if (!collectMessageReasoning) {
    assert.fail("collectMessageReasoning should be defined");
  }

  const result = collectMessageReasoning([
    { type: "text", text: "hello" },
    { type: "reasoning", text: "   " },
  ]);

  assert.deepEqual(result, {
    segments: [],
    isStreaming: false,
    hasReasoning: false,
  });
});
