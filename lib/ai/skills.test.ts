import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildSkillsSystemPrompt,
  getSkillsConfig,
  getSkillsSnapshot,
  loadSkillById,
  parseSkillFrontmatter,
  resetSkillsRuntimeForTests,
  shouldEnableSkillTooling,
  stripFrontmatter,
} from "@/lib/ai/skills";
import { slugifySkillId } from "@/lib/ai/skills/loader";
import { withTimeout } from "@/lib/ai/skills/security";

const ORIGINAL_ENV = { ...process.env };

type Sandbox = {
  root: string;
  workspaceDir: string;
  userDir: string;
  bundledDir: string;
};

async function createSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(join(tmpdir(), "openchat-skills-"));
  const workspaceDir = join(root, "workspace");
  const userDir = join(root, "user");
  const bundledDir = join(root, "bundled");
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(userDir, { recursive: true });
  await mkdir(bundledDir, { recursive: true });

  process.env.ENABLE_SKILLS = "true";
  process.env.SKILLS_WORKSPACE_DIRS = workspaceDir;
  process.env.SKILLS_USER_DIR = userDir;
  process.env.SKILLS_BUNDLED_DIR = bundledDir;
  process.env.SKILLS_MAX_FILE_BYTES = "10485760";
  process.env.SKILLS_MAX_COUNT = "200";
  process.env.SKILLS_CACHE_TTL_MS = "1";
  process.env.SKILLS_LOAD_TIMEOUT_MS = "500";
  process.env.SKILLS_RUNTIME_CONFIG_JSON = undefined;
  process.env.SKILLS_DIRS = undefined;

  resetSkillsRuntimeForTests();
  return { root, workspaceDir, userDir, bundledDir };
}

async function writeSkill(
  root: string,
  dirName: string,
  content: string
): Promise<void> {
  const dir = join(root, dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), content, "utf8");
}

async function cleanupSandbox(root: string): Promise<void> {
  resetSkillsRuntimeForTests();
  process.env = { ...ORIGINAL_ENV };
  await rm(root, { recursive: true, force: true });
}

test("parseSkillFrontmatter parses required fields", () => {
  const input =
    "---\nname: intent-router\ndescription: Route user intent\n---\n# Body";
  const parsed = parseSkillFrontmatter(input);

  assert.equal(parsed.name, "intent-router");
  assert.equal(parsed.description, "Route user intent");
});

test("stripFrontmatter removes yaml header", () => {
  const input =
    "---\nname: intent-router\ndescription: Route user intent\n---\n\n# Instructions\nUse me.";
  const body = stripFrontmatter(input);
  assert.equal(body, "# Instructions\nUse me.");
});

test("workspace overrides user and bundled by skill name", async () => {
  const sandbox = await createSandbox();
  try {
    await writeSkill(
      sandbox.bundledDir,
      "resume-polisher",
      "---\nname: Resume Polisher\ndescription: bundled\n---\nBundled body"
    );
    await writeSkill(
      sandbox.userDir,
      "resume-polisher",
      "---\nname: Resume Polisher\ndescription: user\n---\nUser body"
    );
    await writeSkill(
      sandbox.workspaceDir,
      "resume-polisher",
      "---\nname: Resume Polisher\ndescription: workspace\n---\nWorkspace body"
    );

    const snapshot = await getSkillsSnapshot(getSkillsConfig(sandbox.root));
    assert.equal(snapshot.skills.length, 1);
    assert.equal(snapshot.skills[0]?.source, "workspace");
    assert.equal(snapshot.skills[0]?.description, "workspace");
  } finally {
    await cleanupSandbox(sandbox.root);
  }
});

test("skips oversized skill files (fail-open)", async () => {
  const sandbox = await createSandbox();
  try {
    process.env.SKILLS_MAX_FILE_BYTES = "120";
    resetSkillsRuntimeForTests();

    await writeSkill(
      sandbox.workspaceDir,
      "too-large",
      `---\nname: Too Large\ndescription: oversized\n---\n${"x".repeat(500)}`
    );

    const snapshot = await getSkillsSnapshot(getSkillsConfig(sandbox.root));
    assert.equal(snapshot.skills.length, 0);
    assert.equal(
      snapshot.errors.some((e) => e.code === "skill_file_too_large"),
      true
    );
  } finally {
    await cleanupSandbox(sandbox.root);
  }
});

test("enforces SKILLS_MAX_COUNT", async () => {
  const sandbox = await createSandbox();
  try {
    process.env.SKILLS_MAX_COUNT = "1";
    resetSkillsRuntimeForTests();

    await writeSkill(
      sandbox.workspaceDir,
      "skill-a",
      "---\nname: Skill A\ndescription: a\n---\na"
    );
    await writeSkill(
      sandbox.workspaceDir,
      "skill-b",
      "---\nname: Skill B\ndescription: b\n---\nb"
    );

    const snapshot = await getSkillsSnapshot(getSkillsConfig(sandbox.root));
    assert.equal(snapshot.skills.length, 1);
    assert.equal(
      snapshot.errors.some((e) => e.code === "max_count_reached"),
      true
    );
  } finally {
    await cleanupSandbox(sandbox.root);
  }
});

test("applies metadata.openchat.requires env/bins/config gating", async () => {
  const sandbox = await createSandbox();
  try {
    process.env.SKILLS_RUNTIME_CONFIG_JSON = JSON.stringify({
      flow: { mode: "strict" },
    });
    process.env.OPENAI_API_KEY = undefined;
    resetSkillsRuntimeForTests();

    await writeSkill(
      sandbox.workspaceDir,
      "needs-env",
      `---
name: Needs Env
description: requires env
metadata:
  openchat:
    requires:
      env: [OPENAI_API_KEY]
---
body`
    );

    await writeSkill(
      sandbox.workspaceDir,
      "needs-bin",
      `---
name: Needs Bin
description: requires bin
metadata:
  openchat:
    requires:
      bins: [__missing_bin_for_test__]
---
body`
    );

    await writeSkill(
      sandbox.workspaceDir,
      "needs-config",
      `---
name: Needs Config
description: requires config
metadata:
  openchat:
    requires:
      config: [flow.mode]
---
body`
    );

    await writeSkill(
      sandbox.workspaceDir,
      "config-miss",
      `---
name: Config Miss
description: requires config miss
metadata:
  openchat:
    requires:
      config: [flow.other]
---
body`
    );

    const snapshot = await getSkillsSnapshot(getSkillsConfig(sandbox.root));
    assert.equal(
      snapshot.skills.some((s) => s.name === "Needs Config"),
      true
    );
    assert.equal(
      snapshot.skills.some((s) => s.name === "Needs Env"),
      false
    );
    assert.equal(
      snapshot.skills.some((s) => s.name === "Needs Bin"),
      false
    );
    assert.equal(
      snapshot.skills.some((s) => s.name === "Config Miss"),
      false
    );
    assert.equal(
      snapshot.errors.some((e) => e.code === "skill_gated"),
      true
    );
  } finally {
    await cleanupSandbox(sandbox.root);
  }
});

test("loadSkillById returns body only (progressive disclosure)", async () => {
  const sandbox = await createSandbox();
  try {
    await writeSkill(
      sandbox.workspaceDir,
      "intent-router",
      "---\nname: intent-router\ndescription: route\n---\n\n# Intent Router\nRead user intent."
    );

    const config = getSkillsConfig(sandbox.root);
    const snapshot = await getSkillsSnapshot(config);
    const loaded = await loadSkillById(
      snapshot.skills,
      "intent-router", // slug matches the name
      config
    );

    assert.ok(loaded);
    assert.equal(loaded?.name, "intent-router");
    assert.equal(loaded?.content, "# Intent Router\nRead user intent.");
    assert.equal(loaded?.content.includes("description:"), false);
  } finally {
    await cleanupSandbox(sandbox.root);
  }
});

test("shouldEnableSkillTooling respects enabled flag and skill count", () => {
  assert.equal(shouldEnableSkillTooling(true, 1), true);
  assert.equal(shouldEnableSkillTooling(true, 0), false);
  assert.equal(shouldEnableSkillTooling(false, 1), false);
});

test("buildSkillsSystemPrompt enforces canonical loadSkill tool naming", () => {
  const prompt = buildSkillsSystemPrompt([
    {
      id: "resume-polisher",
      name: "Resume Polisher",
      description: "Improve resumes",
      source: "workspace",
      skillDir: "/tmp/skill",
      skillFile: "/tmp/skill/SKILL.md",
      metadata: {},
    },
  ]);

  assert.equal(prompt.includes("loadSkill"), true);
  assert.equal(prompt.includes("Do NOT call `load_skill`"), true);
  // PR-3: id should be present in the skill list; local path should not be exposed.
  assert.equal(prompt.includes("resume-polisher"), true);
  assert.equal(prompt.includes("/tmp/skill"), false);
});

test("ENABLE_SKILLS defaults to true and SKILLS_DIRS is ignored", () => {
  process.env = { ...ORIGINAL_ENV };
  process.env.ENABLE_SKILLS = undefined;
  process.env.SKILLS_WORKSPACE_DIRS = undefined;
  process.env.SKILLS_DIRS = "deprecated-path";

  const config = getSkillsConfig();
  assert.equal(config.enabled, true);
  assert.equal(
    config.workspaceDirs.some((dir) => dir.includes("deprecated-path")),
    false
  );
});

test("withTimeout rejects long operations", async () => {
  await assert.rejects(
    withTimeout(
      new Promise<void>((resolve) => setTimeout(resolve, 20)),
      1,
      "timeout"
    ),
    /timeout/
  );
});

test("missing optional skill roots are treated as empty sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "openchat-skills-missing-roots-"));
  const workspaceDir = join(root, "workspace");
  await mkdir(workspaceDir, { recursive: true });

  process.env = { ...ORIGINAL_ENV };
  process.env.ENABLE_SKILLS = "true";
  process.env.SKILLS_WORKSPACE_DIRS = workspaceDir;
  process.env.SKILLS_USER_DIR = join(root, "missing-user");
  process.env.SKILLS_BUNDLED_DIR = join(root, "missing-bundled");
  process.env.SKILLS_CACHE_TTL_MS = "1";
  resetSkillsRuntimeForTests();

  try {
    await writeSkill(
      workspaceDir,
      "valid-workspace-skill",
      "---\nname: Workspace Skill\ndescription: valid\n---\nbody"
    );

    const snapshot = await getSkillsSnapshot(getSkillsConfig(root));
    assert.equal(snapshot.skills.length, 1);
    assert.equal(
      snapshot.errors.some((error) => error.code === "directory_unreadable"),
      false
    );
  } finally {
    await cleanupSandbox(root);
  }
});

// ─── PR-1: id infrastructure tests ───────────────────────────────────────────

test("slugifySkillId converts name to stable lowercase slug", () => {
  assert.equal(slugifySkillId("Resume Polisher"), "resume-polisher");
  assert.equal(slugifySkillId("Skill A & B"), "skill-a-b");
  assert.equal(slugifySkillId("UPPER CASE"), "upper-case");
  assert.equal(slugifySkillId("  leading/trailing  "), "leading-trailing");
  assert.equal(slugifySkillId("---"), "skill"); // fallback for all-non-alphanumeric
});

test("skill id is auto-generated from name when frontmatter omits id", async () => {
  const sandbox = await createSandbox();
  try {
    await writeSkill(
      sandbox.workspaceDir,
      "my-skill",
      "---\nname: Resume Polisher\ndescription: test\n---\nbody"
    );
    const snapshot = await getSkillsSnapshot(getSkillsConfig(sandbox.root));
    assert.equal(snapshot.skills.length, 1);
    assert.equal(snapshot.skills[0]?.id, "resume-polisher");
  } finally {
    await cleanupSandbox(sandbox.root);
  }
});

test("explicit frontmatter id takes priority over slugified name", async () => {
  const sandbox = await createSandbox();
  try {
    await writeSkill(
      sandbox.workspaceDir,
      "my-skill",
      "---\nid: my-custom-id\nname: Resume Polisher\ndescription: test\n---\nbody"
    );
    const snapshot = await getSkillsSnapshot(getSkillsConfig(sandbox.root));
    assert.equal(snapshot.skills.length, 1);
    assert.equal(snapshot.skills[0]?.id, "my-custom-id");
    assert.equal(snapshot.skills[0]?.name, "Resume Polisher");
  } finally {
    await cleanupSandbox(sandbox.root);
  }
});

test("skill id dedup: same id from different sources keeps higher-priority source", async () => {
  const sandbox = await createSandbox();
  try {
    // Both skills resolve to the same slug id "code-reviewer"
    await writeSkill(
      sandbox.bundledDir,
      "code-reviewer-bundled",
      "---\nname: Code Reviewer\ndescription: bundled\n---\nbundled body"
    );
    await writeSkill(
      sandbox.workspaceDir,
      "code-reviewer-workspace",
      "---\nname: Code Reviewer\ndescription: workspace\n---\nworkspace body"
    );

    const snapshot = await getSkillsSnapshot(getSkillsConfig(sandbox.root));
    // workspace > bundled, so only 1 skill loaded; bundled is skipped
    assert.equal(snapshot.skills.length, 1);
    assert.equal(snapshot.skills[0]?.id, "code-reviewer");
    assert.equal(snapshot.skills[0]?.source, "workspace");
    assert.equal(
      snapshot.errors.some((e) => e.code === "skill_name_duplicate"),
      true
    );
  } finally {
    await cleanupSandbox(sandbox.root);
  }
});

test("loaded skill has id field set", async () => {
  const sandbox = await createSandbox();
  try {
    await writeSkill(
      sandbox.workspaceDir,
      "some-skill",
      "---\nname: My Skill\ndescription: desc\n---\nbody"
    );
    const snapshot = await getSkillsSnapshot(getSkillsConfig(sandbox.root));
    const skill = snapshot.skills[0];
    assert.ok(skill);
    assert.equal(typeof skill.id, "string");
    assert.ok(skill.id.length > 0);
  } finally {
    await cleanupSandbox(sandbox.root);
  }
});
