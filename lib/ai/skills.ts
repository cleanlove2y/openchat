import {
  getSkillsSnapshot as getSkillsSnapshotFromCache,
  resetSkillsCache,
} from "./skills/cache";
import { getSkillsConfig as loadSkillsConfig } from "./skills/config";
import { loadSkillsSnapshot } from "./skills/loader";
import { parseSkillDocument } from "./skills/parser";
import { resetSecurityCaches } from "./skills/security";
import {
  getSkillsMetricsSnapshot,
  resetSkillsMetrics,
} from "./skills/telemetry";
import type {
  ParsedSkillDocument,
  SkillMetadata,
  SkillsSnapshot,
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
} from "./skills/types";

export const getSkillsConfig = loadSkillsConfig;

export function getSkillsSnapshot(
  config = loadSkillsConfig()
): Promise<SkillsSnapshot> {
  return getSkillsSnapshotFromCache(config);
}

export async function discoverSkillsFromEnvironment(): Promise<
  SkillMetadata[]
> {
  const config = loadSkillsConfig();
  const snapshot = await loadSkillsSnapshot(config);
  return snapshot.skills;
}

export function parseSkillFrontmatter(
  content: string
): ParsedSkillDocument["frontmatter"] {
  return parseSkillDocument(content).frontmatter;
}

export { stripFrontmatter } from "./skills/parser";
export {
  buildSkillsSystemPrompt,
  loadSkillByName,
  shouldEnableSkillTooling,
} from "./skills/runtime";

export function resetSkillsRuntimeForTests(): void {
  resetSkillsCache();
  resetSecurityCaches();
  resetSkillsMetrics();
}

export function getSkillsRuntimeMetrics(): Record<string, number> {
  return getSkillsMetricsSnapshot();
}
