export type SlashCommandKeyAction =
  | "none"
  | "close"
  | "move-down"
  | "move-up"
  | "select";

export function getSlashCommandKeyAction({
  isOpen,
  key,
  filteredCount,
  slashIndex,
  selectionStart,
}: {
  isOpen: boolean;
  key: string;
  filteredCount: number;
  slashIndex: number;
  selectionStart: number | null;
}): {
  action: SlashCommandKeyAction;
  preventDefault: boolean;
} {
  if (!isOpen) {
    return { action: "none", preventDefault: false };
  }

  if (key === "Escape") {
    return { action: "close", preventDefault: true };
  }

  if (key === "ArrowDown") {
    return { action: "move-down", preventDefault: true };
  }

  if (key === "ArrowUp") {
    return { action: "move-up", preventDefault: true };
  }

  if (key === "Enter") {
    if (filteredCount > 0) {
      return { action: "select", preventDefault: true };
    }

    return { action: "close", preventDefault: false };
  }

  if (key === "Tab") {
    if (filteredCount > 0) {
      return { action: "select", preventDefault: true };
    }

    return { action: "close", preventDefault: true };
  }

  if (key === "Backspace" && selectionStart === slashIndex + 1) {
    return { action: "close", preventDefault: false };
  }

  return { action: "none", preventDefault: false };
}
