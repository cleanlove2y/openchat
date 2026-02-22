import assert from "node:assert/strict";
import test from "node:test";
import { getSlashCommandKeyAction } from "./slash-command-keydown";

test("returns close without preventing default for Enter when no matches", () => {
  const result = getSlashCommandKeyAction({
    isOpen: true,
    key: "Enter",
    filteredCount: 0,
    slashIndex: 3,
    selectionStart: 4,
  });

  assert.deepEqual(result, {
    action: "close",
    preventDefault: false,
  });
});

test("returns select and prevents default for Enter when matches exist", () => {
  const result = getSlashCommandKeyAction({
    isOpen: true,
    key: "Enter",
    filteredCount: 2,
    slashIndex: 3,
    selectionStart: 4,
  });

  assert.deepEqual(result, {
    action: "select",
    preventDefault: true,
  });
});
