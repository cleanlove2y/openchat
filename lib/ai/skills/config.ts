import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { SkillsConfig } from "./types";

const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_COUNT = 200;
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_LOAD_TIMEOUT_MS = 500;

function parseBoolean(input: string | undefined, fallback: boolean): boolean {
  if (input == null) {
    return fallback;
  }

  const normalized = input.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveInt(input: string | undefined, fallback: number): number {
  if (!input) {
    return fallback;
  }

  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseDirs(raw: string | undefined, fallback: string[]): string[] {
  const value = raw?.trim();
  const dirs = (value ? value.split(",") : fallback)
    .map((dir) => dir.trim())
    .filter(Boolean);

  return [...new Set(dirs)];
}

function resolveDir(cwd: string, dir: string | null): string | null {
  if (!dir) {
    return null;
  }

  return isAbsolute(dir) ? dir : join(cwd, dir);
}

function parseRuntimeConfig(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed config and fallback to empty
  }

  return {};
}

export function getSkillsConfig(cwd = process.cwd()): SkillsConfig {
  const isVercel = Boolean(process.env.VERCEL);

  const workspaceDirs = parseDirs(process.env.SKILLS_WORKSPACE_DIRS, [
    "agent-skills",
  ])
    .map((dir) => resolveDir(cwd, dir))
    .filter(Boolean) as string[];

  const userDefault = isVercel ? null : join(homedir(), ".openchat", "skills");
  const userDir = resolveDir(
    cwd,
    process.env.SKILLS_USER_DIR?.trim() || userDefault
  );
  const bundledDir = resolveDir(
    cwd,
    process.env.SKILLS_BUNDLED_DIR?.trim() || "skills/bundled"
  );

  return {
    enabled: parseBoolean(process.env.ENABLE_SKILLS, true),
    workspaceDirs,
    userDir,
    bundledDir,
    maxFileBytes: parsePositiveInt(
      process.env.SKILLS_MAX_FILE_BYTES,
      DEFAULT_MAX_FILE_BYTES
    ),
    maxCount: parsePositiveInt(process.env.SKILLS_MAX_COUNT, DEFAULT_MAX_COUNT),
    cacheTtlMs: parsePositiveInt(
      process.env.SKILLS_CACHE_TTL_MS,
      DEFAULT_CACHE_TTL_MS
    ),
    loadTimeoutMs: parsePositiveInt(
      process.env.SKILLS_LOAD_TIMEOUT_MS,
      DEFAULT_LOAD_TIMEOUT_MS
    ),
    cwd,
    runtimeConfig: parseRuntimeConfig(process.env.SKILLS_RUNTIME_CONFIG_JSON),
  };
}

export function resolveSkillSourceRoots(config: SkillsConfig): Array<{
  source: "workspace" | "user" | "bundled";
  path: string;
}> {
  const workspaceRoots = config.workspaceDirs.map((path) => ({
    source: "workspace" as const,
    path,
  }));

  const userRoot = config.userDir
    ? [{ source: "user" as const, path: config.userDir }]
    : [];
  const bundledRoot = config.bundledDir
    ? [{ source: "bundled" as const, path: config.bundledDir }]
    : [];

  return [...workspaceRoots, ...userRoot, ...bundledRoot];
}
