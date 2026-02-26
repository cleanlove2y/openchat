import { readFile, stat } from "node:fs/promises";
import { parseSkillDocument } from "./parser";
import { withTimeout } from "./security";
import { recordLoadSkillInvocation } from "./telemetry";
import type { LoadedSkill, SkillMetadata, SkillsConfig } from "./types";

export function shouldEnableSkillTooling(
  enabled: boolean,
  discoveredSkillCount: number,
  isReasoningModel: boolean
): boolean {
  return enabled && discoveredSkillCount > 0 && !isReasoningModel;
}

export function buildSkillsSystemPrompt(skills: SkillMetadata[]): string {
  if (skills.length === 0) {
    return "";
  }

  const skillList = skills
    .map(
      (skill) =>
        `- ${skill.name}: ${skill.description} (source: ${skill.source}, path: ${skill.skillDir})`
    )
    .join("\n");

  return [
    "Skills System:",
    "Use these skills only when relevant.",
    "Workflow:",
    "1) Match user intent against skill descriptions.",
    "2) Call `loadSkill` with the exact skill name (camelCase only).",
    "3) Do NOT call `load_skill`, `load-skill`, or any other tool-name variant.",
    "4) Follow loaded instructions and referenced assets.",
    "Available skills:",
    skillList,
  ].join("\n");
}

export async function loadSkillByName(
  skills: SkillMetadata[],
  name: string,
  config: SkillsConfig,
  context?: {
    source?: "tool" | "explicit_directive" | "internal";
    invokedToolName?: string | null;
  }
): Promise<LoadedSkill | null> {
  const startedAt = Date.now();
  const normalizedName = name.trim().toLowerCase();
  const matchedSkill = skills.find(
    (skill) => skill.name.toLowerCase() === normalizedName
  );

  if (!matchedSkill) {
    recordLoadSkillInvocation(
      name,
      false,
      Date.now() - startedAt,
      undefined,
      context
    );
    return null;
  }

  try {
    const stats = await withTimeout(
      stat(matchedSkill.skillFile),
      config.loadTimeoutMs,
      `Timed out while reading skill file stats: ${matchedSkill.skillFile}`
    );

    if (stats.size > config.maxFileBytes) {
      const error = new Error(
        `Skill file exceeds max size (${config.maxFileBytes} bytes)`
      );
      recordLoadSkillInvocation(
        matchedSkill.name,
        false,
        Date.now() - startedAt,
        error,
        context
      );
      return null;
    }

    const content = await withTimeout(
      readFile(matchedSkill.skillFile, "utf8"),
      config.loadTimeoutMs,
      `Timed out while reading skill file: ${matchedSkill.skillFile}`
    );

    const parsed = parseSkillDocument(content);

    recordLoadSkillInvocation(
      matchedSkill.name,
      true,
      Date.now() - startedAt,
      undefined,
      context
    );
    return {
      name: matchedSkill.name,
      skillDirectory: matchedSkill.skillDir,
      content: parsed.body,
    };
  } catch (error) {
    recordLoadSkillInvocation(
      matchedSkill.name,
      false,
      Date.now() - startedAt,
      error instanceof Error ? error : new Error("Unknown skill load error"),
      context
    );

    return null;
  }
}
