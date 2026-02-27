import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveSkillSourceRoots } from "./config";
import { parseSkillDocument } from "./parser";
import {
  isPathWithinRoot,
  isSkillEligibleByMetadata,
  isSymlinkPath,
  withTimeout,
} from "./security";
import type {
  SkillLoadError,
  SkillSource,
  SkillsConfig,
  SkillsSnapshot,
  SkillsSourceStats,
} from "./types";

function createSourceStats(): SkillsSourceStats {
  return {
    workspace: { discovered: 0, loaded: 0, skipped: 0 },
    user: { discovered: 0, loaded: 0, skipped: 0 },
    bundled: { discovered: 0, loaded: 0, skipped: 0 },
  };
}

export function createEmptySkillsSnapshot(): SkillsSnapshot {
  return {
    skills: [],
    loadedAt: Date.now(),
    sourceStats: createSourceStats(),
    errors: [],
  };
}

function pushError(
  errors: SkillLoadError[],
  source: SkillSource,
  code: SkillLoadError["code"],
  reason: string,
  path?: string,
  skillName?: string
): void {
  errors.push({
    code,
    source,
    reason,
    path,
    skillName,
  });
}

function normalizeDescription(description: string): string {
  // Align with AgentSkills guidance: keep matching-friendly descriptions compact.
  return description.length > 1024 ? description.slice(0, 1024) : description;
}

export async function loadSkillsSnapshot(
  config: SkillsConfig
): Promise<SkillsSnapshot> {
  if (!config.enabled) {
    return createEmptySkillsSnapshot();
  }

  const snapshot = createEmptySkillsSnapshot();
  const seenNames = new Set<string>();
  let maxCountErrorEmitted = false;

  const sourceRoots = resolveSkillSourceRoots(config);

  for (const root of sourceRoots) {
    let entries: Awaited<ReturnType<typeof readdir>>;

    try {
      entries = await withTimeout(
        readdir(root.path, { withFileTypes: true }),
        config.loadTimeoutMs,
        `Timed out while reading skills directory: ${root.path}`
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        continue;
      }

      const code =
        error instanceof Error && error.message.includes("Timed out")
          ? "load_timeout"
          : "directory_unreadable";
      pushError(
        snapshot.errors,
        root.source,
        code,
        error instanceof Error
          ? error.message
          : "Unable to read skills directory",
        root.path
      );
      continue;
    }

    for (const entry of entries) {
      if (snapshot.skills.length >= config.maxCount) {
        snapshot.sourceStats[root.source].skipped += 1;
        if (!maxCountErrorEmitted) {
          pushError(
            snapshot.errors,
            root.source,
            "max_count_reached",
            `Maximum skill count reached (${config.maxCount})`
          );
          maxCountErrorEmitted = true;
        }
        continue;
      }

      if (!entry.isDirectory()) {
        snapshot.sourceStats[root.source].skipped += 1;
        continue;
      }

      const skillDir = join(root.path, entry.name);
      const skillFile = join(skillDir, "SKILL.md");
      snapshot.sourceStats[root.source].discovered += 1;

      if (!isPathWithinRoot(root.path, skillFile)) {
        snapshot.sourceStats[root.source].skipped += 1;
        pushError(
          snapshot.errors,
          root.source,
          "path_escape_blocked",
          "Skill path escapes configured source root",
          skillFile
        );
        continue;
      }

      try {
        if (await isSymlinkPath(skillDir, config.loadTimeoutMs)) {
          snapshot.sourceStats[root.source].skipped += 1;
          pushError(
            snapshot.errors,
            root.source,
            "entry_symlink_ignored",
            "Symbolic link skill directories are ignored for safety",
            skillDir
          );
          continue;
        }
      } catch (error) {
        snapshot.sourceStats[root.source].skipped += 1;
        pushError(
          snapshot.errors,
          root.source,
          "skill_file_unreadable",
          error instanceof Error
            ? error.message
            : "Unable to inspect skill directory",
          skillDir
        );
        continue;
      }

      let fileStats: Awaited<ReturnType<typeof stat>>;
      try {
        fileStats = await withTimeout(
          stat(skillFile),
          config.loadTimeoutMs,
          `Timed out while reading skill file stats: ${skillFile}`
        );
      } catch (error) {
        snapshot.sourceStats[root.source].skipped += 1;
        const code =
          error instanceof Error && error.message.includes("Timed out")
            ? "load_timeout"
            : "skill_file_missing";
        pushError(
          snapshot.errors,
          root.source,
          code,
          error instanceof Error ? error.message : "Skill file missing",
          skillFile
        );
        continue;
      }

      if (fileStats.size > config.maxFileBytes) {
        snapshot.sourceStats[root.source].skipped += 1;
        pushError(
          snapshot.errors,
          root.source,
          "skill_file_too_large",
          `Skill file exceeds maximum size (${config.maxFileBytes} bytes)`,
          skillFile
        );
        continue;
      }

      let content: string;
      try {
        content = await withTimeout(
          readFile(skillFile, "utf8"),
          config.loadTimeoutMs,
          `Timed out while reading skill file: ${skillFile}`
        );
      } catch (error) {
        snapshot.sourceStats[root.source].skipped += 1;
        const code =
          error instanceof Error && error.message.includes("Timed out")
            ? "load_timeout"
            : "skill_file_unreadable";
        pushError(
          snapshot.errors,
          root.source,
          code,
          error instanceof Error ? error.message : "Unable to read skill file",
          skillFile
        );
        continue;
      }

      let parsed: ReturnType<typeof parseSkillDocument>;
      try {
        parsed = parseSkillDocument(content);
      } catch (error) {
        snapshot.sourceStats[root.source].skipped += 1;
        pushError(
          snapshot.errors,
          root.source,
          "skill_parse_invalid",
          error instanceof Error ? error.message : "Invalid SKILL.md format",
          skillFile
        );
        continue;
      }

      const eligibility = await isSkillEligibleByMetadata(
        parsed.frontmatter.metadata,
        config
      );
      if (!eligibility.eligible) {
        snapshot.sourceStats[root.source].skipped += 1;
        pushError(
          snapshot.errors,
          root.source,
          "skill_gated",
          eligibility.reason ?? "Skill filtered by metadata requirements",
          skillFile,
          parsed.frontmatter.name
        );
        continue;
      }

      const dedupeKey = parsed.frontmatter.name.toLowerCase();
      if (seenNames.has(dedupeKey)) {
        snapshot.sourceStats[root.source].skipped += 1;
        pushError(
          snapshot.errors,
          root.source,
          "skill_name_duplicate",
          "Skill name conflict with higher-precedence source",
          skillFile,
          parsed.frontmatter.name
        );
        continue;
      }

      seenNames.add(dedupeKey);
      snapshot.sourceStats[root.source].loaded += 1;
      snapshot.skills.push({
        name: parsed.frontmatter.name,
        description: normalizeDescription(parsed.frontmatter.description),
        source: root.source,
        skillDir,
        skillFile,
        metadata: parsed.frontmatter.metadata,
      });
    }
  }

  snapshot.loadedAt = Date.now();
  return snapshot;
}
