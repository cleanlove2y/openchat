import { parse } from "yaml";
import type { ParsedSkillDocument } from "./types";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function ensureStringField(
  source: Record<string, unknown>,
  field: "name" | "description"
): string {
  const value = source[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required frontmatter field: ${field}`);
  }
  return value.trim();
}

function ensureMetadataField(
  source: Record<string, unknown>
): Record<string, unknown> {
  const metadata = source.metadata;

  if (metadata == null) {
    return {};
  }

  if (typeof metadata === "object" && !Array.isArray(metadata)) {
    return metadata as Record<string, unknown>;
  }

  throw new Error("Frontmatter field `metadata` must be an object");
}

export function stripFrontmatter(content: string): string {
  const match = content.match(FRONTMATTER_PATTERN);
  return (match ? content.slice(match[0].length) : content).trim();
}

export function parseSkillDocument(content: string): ParsedSkillDocument {
  const frontmatterMatch = content.match(FRONTMATTER_PATTERN);

  if (!frontmatterMatch?.[1]) {
    throw new Error("No frontmatter found in SKILL.md");
  }

  const parsed = parse(frontmatterMatch[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid YAML frontmatter in SKILL.md");
  }

  const frontmatter = parsed as Record<string, unknown>;
  const name = ensureStringField(frontmatter, "name");
  const description = ensureStringField(frontmatter, "description");
  const metadata = ensureMetadataField(frontmatter);

  return {
    frontmatter: {
      name,
      description,
      metadata,
    },
    body: stripFrontmatter(content),
  };
}
