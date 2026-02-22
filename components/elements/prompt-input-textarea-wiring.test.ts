import assert from "node:assert/strict";
import test from "node:test";
import type { KeyboardEventHandler } from "react";
import { PromptInputTextarea } from "./prompt-input";

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

function createMockEvent(onRequestSubmit?: () => void): MockEvent {
  const event: MockEvent = {
    key: "Enter",
    shiftKey: false,
    defaultPrevented: false,
    nativeEvent: { isComposing: false },
    currentTarget: {
      form: {
        querySelector: (selector: string) => {
          if (selector !== 'button[type="submit"]') {
            return null;
          }
          return { disabled: false };
        },
        requestSubmit: () => onRequestSubmit?.(),
      },
    },
    preventDefault: () => {
      event.defaultPrevented = true;
    },
  };

  return event;
}

test("PromptInputTextarea wires custom onKeyDown through internal handler", () => {
  const calls: string[] = [];
  const externalOnKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = () => {
    calls.push("external");
  };

  const element = PromptInputTextarea({
    onKeyDown: externalOnKeyDown,
  });

  assert.notEqual(element.props.onKeyDown, externalOnKeyDown);

  element.props.onKeyDown(createMockEvent(() => calls.push("submit")));
  assert.deepEqual(calls, ["external", "submit"]);
});
