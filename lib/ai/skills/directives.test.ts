import assert from "node:assert/strict";
import test from "node:test";
import {
  collectSkillDirectiveNamesFromParts,
  collectSkillDirectiveNamesFromRequestBody,
  extractSkillDirectives,
} from "@/lib/ai/skills/directives";

test("extractSkillDirectives collects unique skill names and strips markers", () => {
  const input = `[Use Skill: Resume Polisher & Deep Dive Coach]
[Use Skill: resume polisher & deep dive coach]

请帮我优化简历`;

  const result = extractSkillDirectives(input);

  assert.deepEqual(result.requestedSkillNames, [
    "Resume Polisher & Deep Dive Coach",
  ]);
  assert.equal(result.strippedText, "请帮我优化简历");
});

test("collectSkillDirectiveNamesFromParts only reads text parts", () => {
  const names = collectSkillDirectiveNamesFromParts([
    { type: "file", url: "https://example.com/demo.png" },
    { type: "text", text: "[Use Skill: Skill A]\n\nhello" },
    { type: "text", text: "[Use Skill: skill a]\n[Use Skill: Skill B]" },
  ]);

  assert.deepEqual(names, ["Skill A", "Skill B"]);
});

test("collectSkillDirectiveNamesFromRequestBody uses latest user message in tool approval flow", () => {
  const names = collectSkillDirectiveNamesFromRequestBody({
    messages: [
      {
        role: "user",
        parts: [{ type: "text", text: "[Use Skill: Old Skill]\nold" }],
      },
      {
        role: "assistant",
        parts: [{ type: "text", text: "ok" }],
      },
      {
        role: "user",
        parts: [{ type: "text", text: "[Use Skill: New Skill]\nnew" }],
      },
    ],
  });

  assert.deepEqual(names, ["New Skill"]);
});
