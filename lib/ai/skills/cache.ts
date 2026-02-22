import { loadSkillsSnapshot } from "./loader";
import { recordSkillsSnapshot } from "./telemetry";
import type { SkillsConfig, SkillsSnapshot } from "./types";

type SkillsCacheState = {
  fingerprint: string;
  expiresAt: number;
  snapshot: SkillsSnapshot;
  inFlight: Promise<SkillsSnapshot> | null;
};

let state: SkillsCacheState | null = null;

function fingerprintConfig(config: SkillsConfig): string {
  return JSON.stringify({
    enabled: config.enabled,
    workspaceDirs: config.workspaceDirs,
    userDir: config.userDir,
    bundledDir: config.bundledDir,
    maxFileBytes: config.maxFileBytes,
    maxCount: config.maxCount,
    cacheTtlMs: config.cacheTtlMs,
    loadTimeoutMs: config.loadTimeoutMs,
    runtimeConfig: config.runtimeConfig,
  });
}

async function buildSnapshot(config: SkillsConfig): Promise<SkillsSnapshot> {
  const startedAt = Date.now();
  const snapshot = await loadSkillsSnapshot(config);
  recordSkillsSnapshot(snapshot, Date.now() - startedAt);
  return snapshot;
}

export async function getSkillsSnapshot(config: SkillsConfig): Promise<SkillsSnapshot> {
  const fingerprint = fingerprintConfig(config);
  const now = Date.now();

  if (
    state &&
    state.fingerprint === fingerprint &&
    state.snapshot &&
    state.expiresAt > now
  ) {
    return state.snapshot;
  }

  if (state && state.fingerprint === fingerprint && state.inFlight) {
    return state.inFlight;
  }

  const inFlight = buildSnapshot(config)
    .then((snapshot) => {
      state = {
        fingerprint,
        snapshot,
        expiresAt: Date.now() + config.cacheTtlMs,
        inFlight: null,
      };
      return snapshot;
    })
    .catch((error) => {
      if (state && state.fingerprint === fingerprint) {
        state.inFlight = null;
      }
      throw error;
    });

  state = {
    fingerprint,
    snapshot: state?.snapshot ?? {
      skills: [],
      loadedAt: now,
      sourceStats: {
        workspace: { discovered: 0, loaded: 0, skipped: 0 },
        user: { discovered: 0, loaded: 0, skipped: 0 },
        bundled: { discovered: 0, loaded: 0, skipped: 0 },
      },
      errors: [],
    },
    expiresAt: 0,
    inFlight,
  };

  return inFlight;
}

export function resetSkillsCache(): void {
  state = null;
}
