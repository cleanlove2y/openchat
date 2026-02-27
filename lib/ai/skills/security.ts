import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { SkillsConfig } from "./types";

const binCheckCache = new Map<string, boolean>();

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getNestedValue(root: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, root);
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timer: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function isPathWithinRoot(
  rootPath: string,
  targetPath: string
): boolean {
  const resolvedRoot = resolve(rootPath);
  const resolvedTarget = resolve(targetPath);
  const diff = relative(resolvedRoot, resolvedTarget);

  if (!diff) {
    return true;
  }

  return !diff.startsWith("..") && !diff.includes(`..${sep}`);
}

async function commandExists(command: string): Promise<boolean> {
  if (binCheckCache.has(command)) {
    return binCheckCache.get(command) ?? false;
  }

  const checker = process.platform === "win32" ? "where" : "which";

  const exists = await new Promise<boolean>((resolvePromise) => {
    const child = spawn(checker, [command], { stdio: "ignore" });
    child.on("error", () => resolvePromise(false));
    child.on("close", (code) => resolvePromise(code === 0));
  });

  binCheckCache.set(command, exists);
  return exists;
}

export async function isSkillEligibleByMetadata(
  metadata: Record<string, unknown>,
  config: SkillsConfig
): Promise<{ eligible: boolean; reason?: string }> {
  const openchat = metadata.openchat;

  if (!openchat || typeof openchat !== "object" || Array.isArray(openchat)) {
    return { eligible: true };
  }

  const openchatMetadata = openchat as Record<string, unknown>;

  if (openchatMetadata.always === true) {
    return { eligible: true };
  }

  const requires = openchatMetadata.requires;
  if (!requires || typeof requires !== "object" || Array.isArray(requires)) {
    return { eligible: true };
  }

  const requirements = requires as Record<string, unknown>;

  const requiredOs = Array.isArray(requirements.os)
    ? requirements.os.filter(isNonEmptyString)
    : [];
  if (requiredOs.length > 0 && !requiredOs.includes(process.platform)) {
    return {
      eligible: false,
      reason: `os requirement not met (${process.platform})`,
    };
  }

  const requiredEnv = Array.isArray(requirements.env)
    ? requirements.env.filter(isNonEmptyString)
    : [];
  for (const envName of requiredEnv) {
    if (!process.env[envName]) {
      return {
        eligible: false,
        reason: `env requirement not met (${envName})`,
      };
    }
  }

  const requiredBins = Array.isArray(requirements.bins)
    ? requirements.bins.filter(isNonEmptyString)
    : [];
  for (const bin of requiredBins) {
    const found = await commandExists(bin);
    if (!found) {
      return {
        eligible: false,
        reason: `binary requirement not met (${bin})`,
      };
    }
  }

  const requiredConfigPaths = Array.isArray(requirements.config)
    ? requirements.config.filter(isNonEmptyString)
    : [];

  for (const configPath of requiredConfigPaths) {
    const value = getNestedValue(config.runtimeConfig, configPath);
    if (!value) {
      return {
        eligible: false,
        reason: `config requirement not met (${configPath})`,
      };
    }
  }

  return { eligible: true };
}

export async function isSymlinkPath(
  path: string,
  timeoutMs: number
): Promise<boolean> {
  const stats = await withTimeout(
    lstat(path),
    timeoutMs,
    `Timed out while reading path stats: ${path}`
  );

  return stats.isSymbolicLink();
}

export function resetSecurityCaches(): void {
  binCheckCache.clear();
}
