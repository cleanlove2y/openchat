import assert from "node:assert/strict";
import test from "node:test";
import {
  collectSkillRefsFromParts,
  stripSkillRefParts,
} from "@/lib/ai/skills/directives";

// ─── collectSkillRefsFromParts ────────────────────────────────────────────────

test("collectSkillRefsFromParts extracts skillIds from skill_ref parts", () => {
  const ids = collectSkillRefsFromParts([
    { type: "text", text: "hello" },
    { type: "skill_ref", skillId: "resume-polisher" },
    { type: "file", url: "https://example.com/doc.pdf" },
    { type: "skill_ref", skillId: "code-reviewer", label: "Code Reviewer" },
  ]);

  assert.deepEqual(ids, ["resume-polisher", "code-reviewer"]);
});

test("collectSkillRefsFromParts deduplicates skill ids (case-insensitive)", () => {
  const ids = collectSkillRefsFromParts([
    { type: "skill_ref", skillId: "Resume-Polisher" },
    { type: "skill_ref", skillId: "resume-polisher" },
    { type: "skill_ref", skillId: "code-reviewer" },
  ]);

  assert.deepEqual(ids, ["resume-polisher", "code-reviewer"]);
});

test("collectSkillRefsFromParts ignores parts without type skill_ref", () => {
  const ids = collectSkillRefsFromParts([
    { type: "text", text: "hello" },
    { type: "file", url: "https://example.com/img.png" },
  ]);

  assert.deepEqual(ids, []);
});

test("collectSkillRefsFromParts returns empty for non-array input", () => {
  assert.deepEqual(collectSkillRefsFromParts(null), []);
  assert.deepEqual(collectSkillRefsFromParts(undefined), []);
  assert.deepEqual(collectSkillRefsFromParts("skill_ref"), []);
});

test("collectSkillRefsFromParts ignores skill_ref parts with missing or empty skillId", () => {
  const ids = collectSkillRefsFromParts([
    { type: "skill_ref" }, // missing skillId
    { type: "skill_ref", skillId: "" }, // empty skillId
    { type: "skill_ref", skillId: "  " }, // whitespace-only id
    { type: "skill_ref", skillId: "valid-skill" },
  ]);

  assert.deepEqual(ids, ["valid-skill"]);
});

// ─── stripSkillRefParts ───────────────────────────────────────────────────────

test("stripSkillRefParts removes skill_ref parts and keeps others", () => {
  const parts = [
    { type: "text", text: "hello" },
    { type: "skill_ref", skillId: "resume-polisher" },
    { type: "file", url: "https://example.com/doc.pdf" },
    { type: "skill_ref", skillId: "code-reviewer" },
  ];

  const result = stripSkillRefParts(parts);

  assert.deepEqual(result, [
    { type: "text", text: "hello" },
    { type: "file", url: "https://example.com/doc.pdf" },
  ]);
});

test("stripSkillRefParts returns all parts when none are skill_ref", () => {
  const parts = [
    { type: "text", text: "hello" },
    { type: "file", url: "https://example.com/img.png" },
  ];

  assert.deepEqual(stripSkillRefParts(parts), parts);
});
