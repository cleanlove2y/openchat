import assert from "node:assert/strict";
import test from "node:test";
import {
  getAutoResumeAttemptKey,
  shouldResumeExistingStream,
} from "./use-auto-resume";

test("shouldResumeExistingStream returns true for unfinished user turns", () => {
  assert.equal(
    shouldResumeExistingStream({
      autoResume: true,
      initialMessages: [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
      ],
    }),
    true
  );
});

test("shouldResumeExistingStream returns false when auto resume is disabled", () => {
  assert.equal(
    shouldResumeExistingStream({
      autoResume: false,
      initialMessages: [
        {
          id: "1",
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        },
      ],
    }),
    false
  );
});

test("shouldResumeExistingStream returns false after an assistant reply exists", () => {
  assert.equal(
    shouldResumeExistingStream({
      autoResume: true,
      initialMessages: [
        {
          id: "1",
          role: "assistant",
          parts: [{ type: "text", text: "done" }],
        },
      ],
    }),
    false
  );
});

test("getAutoResumeAttemptKey is stable for the same unfinished user turn", () => {
  assert.equal(
    getAutoResumeAttemptKey([
      {
        id: "same-id",
        role: "user",
        parts: [{ type: "text", text: "hello" }],
      },
    ]),
    "same-id:user"
  );
});

test("getAutoResumeAttemptKey ignores completed turns", () => {
  assert.equal(
    getAutoResumeAttemptKey([
      {
        id: "assistant-id",
        role: "assistant",
        parts: [{ type: "text", text: "done" }],
      },
    ]),
    null
  );
});
