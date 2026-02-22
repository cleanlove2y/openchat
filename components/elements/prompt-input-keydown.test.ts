import assert from "node:assert/strict";
import test from "node:test";
import type { KeyboardEventHandler } from "react";
import { handlePromptInputKeyDown } from "./prompt-input-keydown";

type MockEvent = {
  key: string;
  shiftKey: boolean;
  defaultPrevented: boolean;
  nativeEvent: { isComposing: boolean };
  currentTarget: {
    form: {
      querySelector: (selector: string) => { disabled: boolean } | null;
      requestSubmit: () => void;
    } | null;
  };
  preventDefault: () => void;
};

function createMockEvent(options?: {
  key?: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  isSubmitDisabled?: boolean;
  onRequestSubmit?: () => void;
}): MockEvent {
  const isSubmitDisabled = options?.isSubmitDisabled ?? false;

  const event: MockEvent = {
    key: options?.key ?? "Enter",
    shiftKey: options?.shiftKey ?? false,
    defaultPrevented: false,
    nativeEvent: {
      isComposing: options?.isComposing ?? false,
    },
    currentTarget: {
      form: {
        querySelector: (selector: string) => {
          if (selector !== 'button[type="submit"]') {
            return null;
          }
          return { disabled: isSubmitDisabled };
        },
        requestSubmit: () => {
          options?.onRequestSubmit?.();
        },
      },
    },
    preventDefault: () => {
      event.defaultPrevented = true;
    },
  };

  return event;
}

test("calls external keydown before submit and honors preventDefault", () => {
  const calls: string[] = [];
  const event = createMockEvent({
    onRequestSubmit: () => {
      calls.push("submit");
    },
  });

  const externalOnKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    calls.push("external");
    e.preventDefault();
  };

  handlePromptInputKeyDown(
    event as unknown as React.KeyboardEvent<HTMLTextAreaElement>,
    externalOnKeyDown
  );

  assert.deepEqual(calls, ["external"]);
});

test("submits form on Enter when not intercepted", () => {
  let submitCalls = 0;
  const event = createMockEvent({
    onRequestSubmit: () => {
      submitCalls += 1;
    },
  });

  handlePromptInputKeyDown(
    event as unknown as React.KeyboardEvent<HTMLTextAreaElement>
  );

  assert.equal(submitCalls, 1);
});
