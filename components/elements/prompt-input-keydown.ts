import type { KeyboardEvent, KeyboardEventHandler } from "react";

export function handlePromptInputKeyDown(
  e: KeyboardEvent<HTMLTextAreaElement>,
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>
): void {
  onKeyDown?.(e);
  if (e.defaultPrevented) {
    return;
  }

  if (e.key !== "Enter") {
    return;
  }

  if (e.nativeEvent.isComposing) {
    return;
  }

  if (e.shiftKey) {
    return;
  }

  e.preventDefault();

  const form = e.currentTarget.form;
  const submitButton = form?.querySelector(
    'button[type="submit"]'
  ) as HTMLButtonElement | null;
  if (submitButton?.disabled) {
    return;
  }

  form?.requestSubmit();
}
