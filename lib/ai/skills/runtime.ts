import { readFile, stat } from "node:fs/promises";
import { buildSkillsSystemPromptText } from "../prompts/skills";
import { parseSkillDocument } from "./parser";
import { withTimeout } from "./security";
import { recordLoadSkillInvocation } from "./telemetry";
import type { LoadedSkill, SkillMetadata, SkillsConfig } from "./types";

export function shouldEnableSkillTooling(
  enabled: boolean,
  discoveredSkillCount: number
): boolean {
  return enabled && discoveredSkillCount > 0;
}

export function buildSkillsSystemPrompt(skills: SkillMetadata[]): string {
  return buildSkillsSystemPromptText(skills);
}

// ─── Shared file-reading helper ───────────────────────────────────────────────

async function readAndParseSkillFile(
  matchedSkill: SkillMetadata,
  config: SkillsConfig,
  context:
    | {
        source?: "tool" | "explicit_directive" | "internal";
        invokedToolName?: string | null;
      }
    | undefined,
  startedAt: number
): Promise<LoadedSkill | null> {
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

// ─── Primary lookup: by stable id (slug) ─────────────────────────────────────

/**
 * Load a skill by its stable slug id.
 * This is the preferred lookup path for new messages that carry `skill_ref` parts.
 */
export async function loadSkillById(
  skills: SkillMetadata[],
  id: string,
  config: SkillsConfig,
  context?: {
    source?: "tool" | "explicit_directive" | "internal";
    invokedToolName?: string | null;
  }
): Promise<LoadedSkill | null> {
  const startedAt = Date.now();
  const normalizedId = id.trim().toLowerCase();
  const matchedSkill = skills.find(
    (skill) => skill.id.toLowerCase() === normalizedId
  );

  if (!matchedSkill) {
    recordLoadSkillInvocation(
      id,
      false,
      Date.now() - startedAt,
      undefined,
      context
    );
    return null;
  }

  return await readAndParseSkillFile(matchedSkill, config, context, startedAt);
}
