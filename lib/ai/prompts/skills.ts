import type { SkillMetadata } from "@/lib/ai/skills/types";

export function buildSkillsSystemPromptText(skills: SkillMetadata[]): string {
  if (skills.length === 0) {
    return "";
  }

  const skillList = skills
    .map(
      (skill) =>
        `- [${skill.id}] ${skill.name}: ${skill.description} (source: ${skill.source})`
    )
    .join("\n");

  return [
    "Skills System:",
    "Use these skills only when they are relevant to the user's request.",
    "Workflow:",
    "1) Match the user's intent against the available skill descriptions.",
    "2) Call `loadSkill` with the exact skill name (camelCase only).",
    "3) Do NOT call `load_skill`, `load-skill`, or any other tool-name variant.",
    "4) Follow the loaded instructions and referenced assets.",
    "Available skills:",
    skillList,
  ].join("\n");
}

export function buildExplicitSkillsContextPrompt(
  loadedSkills: Array<{ name: string; content: string }>
): string {
  if (loadedSkills.length === 0) {
    return "";
  }

  const skillBlocks = loadedSkills
    .map((loadedSkill) =>
      [`### Skill: ${loadedSkill.name}`, loadedSkill.content].join("\n")
    )
    .join("\n\n");

  return [
    "Explicit Skills Context:",
    "The user explicitly selected these skills for this request.",
    "Treat the following skill content as instructions for the current request:",
    skillBlocks,
  ].join("\n\n");
}
