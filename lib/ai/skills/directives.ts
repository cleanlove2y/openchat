// ─── Structured skill_ref part type ───────────────────────────────────────────

/** A structured message part that references a skill by its stable id. */
export type SkillRefPart = {
  type: "skill_ref";
  skillId: string;
  /** Optional human-readable label for UI rendering */
  label?: string;
};

function isSkillRefPart(part: unknown): part is SkillRefPart {
  if (!part || typeof part !== "object") {
    return false;
  }
  const candidate = part as Record<string, unknown>;
  return (
    candidate.type === "skill_ref" &&
    typeof candidate.skillId === "string" &&
    candidate.skillId.trim().length > 0
  );
}

// ─── Structured skill_ref extraction ─────────────────────────────────────────

/**
 * Collects skill ids from structured `skill_ref` parts in a message parts array.
 */
export function collectSkillRefsFromParts(parts: unknown): string[] {
  if (!Array.isArray(parts)) {
    return [];
  }

  const requestedSkillIds: string[] = [];
  const seenSkillIds = new Set<string>();

  for (const part of parts) {
    if (isSkillRefPart(part)) {
      const trimmed = part.skillId.trim().toLowerCase();
      if (!trimmed || seenSkillIds.has(trimmed)) {
        continue;
      }
      seenSkillIds.add(trimmed);
      requestedSkillIds.push(trimmed);
    }
  }

  return requestedSkillIds;
}

/**
 * Strips `skill_ref` parts from a parts array (they are UI-only metadata).
 * Returns the filtered parts array.
 */
export function stripSkillRefParts(parts: unknown[]): unknown[] {
  return parts.filter((part) => !isSkillRefPart(part));
}
