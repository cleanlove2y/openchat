export type SkillSource = "workspace" | "user" | "bundled";

export type SkillLoadErrorCode =
  | "directory_unreadable"
  | "entry_not_directory"
  | "entry_symlink_ignored"
  | "path_escape_blocked"
  | "skill_file_missing"
  | "skill_file_too_large"
  | "skill_file_unreadable"
  | "skill_parse_invalid"
  | "skill_gated"
  | "skill_name_duplicate"
  | "max_count_reached"
  | "load_timeout"
  | "runtime_read_failed";

export type SkillMetadata = {
  name: string;
  description: string;
  source: SkillSource;
  skillDir: string;
  skillFile: string;
  metadata: Record<string, unknown>;
};

export type SkillLoadError = {
  code: SkillLoadErrorCode;
  source: SkillSource;
  skillName?: string;
  path?: string;
  reason: string;
};

export type SkillsSourceStats = Record<
  SkillSource,
  {
    discovered: number;
    loaded: number;
    skipped: number;
  }
>;

export type SkillsSnapshot = {
  skills: SkillMetadata[];
  loadedAt: number;
  sourceStats: SkillsSourceStats;
  errors: SkillLoadError[];
};

export type ParsedSkillDocument = {
  frontmatter: {
    name: string;
    description: string;
    metadata: Record<string, unknown>;
  };
  body: string;
};

export type LoadedSkill = {
  name: string;
  skillDirectory: string;
  content: string;
};

export type SkillsConfig = {
  enabled: boolean;
  workspaceDirs: string[];
  userDir: string | null;
  bundledDir: string | null;
  maxFileBytes: number;
  maxCount: number;
  cacheTtlMs: number;
  loadTimeoutMs: number;
  cwd: string;
  runtimeConfig: Record<string, unknown>;
};
