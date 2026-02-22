import { getSkillsSnapshot as getSkillsSnapshotFromCache, resetSkillsCache } from "./skills/cache";
import { getSkillsConfig as loadSkillsConfig } from "./skills/config";
import { loadSkillsSnapshot } from "./skills/loader";
import { parseSkillDocument, stripFrontmatter } from "./skills/parser";
import {
  buildSkillsSystemPrompt,
  loadSkillByName,
  shouldEnableSkillTooling,
} from "./skills/runtime";
import { resetSecurityCaches } from "./skills/security";
import { getSkillsMetricsSnapshot, resetSkillsMetrics } from "./skills/telemetry";
import type {
  LoadedSkill,
  ParsedSkillDocument,
  SkillLoadError,
  SkillLoadErrorCode,
  SkillMetadata,
  SkillSource,
  SkillsConfig,
  SkillsSnapshot,
  SkillsSourceStats,
} from "./skills/types";

export type {
  LoadedSkill,
  ParsedSkillDocument,
  SkillLoadError,
  SkillLoadErrorCode,
  SkillMetadata,
  SkillSource,
  SkillsConfig,
  SkillsSnapshot,
  SkillsSourceStats,
};

export const getSkillsConfig = loadSkillsConfig;

export async function getSkillsSnapshot(
  config = loadSkillsConfig()
): Promise<SkillsSnapshot> {
  return getSkillsSnapshotFromCache(config);
}

export async function discoverSkillsFromEnvironment(): Promise<SkillMetadata[]> {
  const config = loadSkillsConfig();
  const snapshot = await loadSkillsSnapshot(config);
  return snapshot.skills;
}

export function parseSkillFrontmatter(content: string): ParsedSkillDocument["frontmatter"] {
  return parseSkillDocument(content).frontmatter;
}

export {
  buildSkillsSystemPrompt,
  loadSkillByName,
  shouldEnableSkillTooling,
  stripFrontmatter,
};

export function resetSkillsRuntimeForTests(): void {
  resetSkillsCache();
  resetSecurityCaches();
  resetSkillsMetrics();
}

export function getSkillsRuntimeMetrics(): Record<string, number> {
  return getSkillsMetricsSnapshot();
}
