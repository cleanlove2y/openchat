import { getAppLogger } from "@/lib/logging";
import type { SkillLoadError, SkillsSnapshot } from "./types";

type SkillsMetricName =
  | "skills_discovered_total"
  | "skills_load_errors_total"
  | "skills_load_latency_ms"
  | "loadSkill_calls_total";

const metrics = new Map<SkillsMetricName, number>();

function incrementMetric(name: SkillsMetricName, value = 1): void {
  metrics.set(name, (metrics.get(name) ?? 0) + value);
}

export function logSkillsEvent(
  event: string,
  payload: Record<string, unknown>
): void {
  const line = {
    namespace: "skills",
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  // Structured logs for observability and alerting pipelines.
  getAppLogger().info(
    {
      event: "skills.telemetry",
      payload: line,
    },
    "skills.telemetry"
  );
}

export function recordSkillsSnapshot(
  snapshot: SkillsSnapshot,
  durationMs: number
): void {
  incrementMetric("skills_discovered_total", snapshot.skills.length);
  incrementMetric("skills_load_errors_total", snapshot.errors.length);
  incrementMetric("skills_load_latency_ms", durationMs);

  logSkillsEvent("skills_snapshot_loaded", {
    durationMs,
    discoveredSkills: snapshot.skills.length,
    errorCount: snapshot.errors.length,
    sourceStats: snapshot.sourceStats,
  });

  if (snapshot.errors.length > 0) {
    for (const error of snapshot.errors) {
      logSkillsEvent("skills_snapshot_error", {
        errorCode: error.code,
        source: error.source,
        path: error.path ?? null,
        skillName: error.skillName ?? null,
        reason: error.reason,
      });
    }
  }
}

export function recordLoadSkillInvocation(
  skillName: string,
  ok: boolean,
  durationMs: number,
  error?: SkillLoadError | Error,
  metadata?: {
    source?: "tool" | "explicit_directive" | "internal";
    invokedToolName?: string | null;
  }
): void {
  incrementMetric("loadSkill_calls_total", 1);

  logSkillsEvent("load_skill_invocation", {
    skillName,
    source: metadata?.source ?? null,
    invokedToolName: metadata?.invokedToolName ?? null,
    ok,
    durationMs,
    errorCode:
      error && "code" in error
        ? (error.code as string)
        : error
          ? "runtime_error"
          : null,
    errorMessage: error
      ? "reason" in error
        ? error.reason
        : error.message
      : null,
  });
}

export function getSkillsMetricsSnapshot(): Record<string, number> {
  return Object.fromEntries(metrics.entries());
}

export function resetSkillsMetrics(): void {
  metrics.clear();
}
