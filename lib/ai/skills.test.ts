import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildSkillsSystemPrompt,
  getSkillsConfig,
  getSkillsSnapshot,
  loadSkillByName,
  parseSkillFrontmatter,
  resetSkillsRuntimeForTests,
  shouldEnableSkillTooling,
  stripFrontmatter,
} from "@/lib/ai/skills";
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
  delete process.env.SKILLS_RUNTIME_CONFIG_JSON;
  delete process.env.SKILLS_DIRS;

  resetSkillsRuntimeForTests();
  return { root, workspaceDir, userDir, bundledDir };
}

async function writeSkill(root: string, dirName: string, content: string): Promise<void> {
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
  const input = `---\nname: intent-router\ndescription: Route user intent\n---\n# Body`;
  const parsed = parseSkillFrontmatter(input);

  assert.equal(parsed.name, "intent-router");
  assert.equal(parsed.description, "Route user intent");
});

test("stripFrontmatter removes yaml header", () => {
  const input = `---\nname: intent-router\ndescription: Route user intent\n---\n\n# Instructions\nUse me.`;
  const body = stripFrontmatter(input);
  assert.equal(body, "# Instructions\nUse me.");
});

test("workspace overrides user and bundled by skill name", async () => {
  const sandbox = await createSandbox();
  try {
    await writeSkill(
      sandbox.bundledDir,
      "resume-polisher",
      `---\nname: Resume Polisher\ndescription: bundled\n---\nBundled body`
    );
    await writeSkill(
      sandbox.userDir,
      "resume-polisher",
      `---\nname: Resume Polisher\ndescription: user\n---\nUser body`
    );
    await writeSkill(
      sandbox.workspaceDir,
      "resume-polisher",
      `---\nname: Resume Polisher\ndescription: workspace\n---\nWorkspace body`
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
      `---\nname: Skill A\ndescription: a\n---\na`
    );
    await writeSkill(
      sandbox.workspaceDir,
      "skill-b",
      `---\nname: Skill B\ndescription: b\n---\nb`
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
    process.env.SKILLS_RUNTIME_CONFIG_JSON = JSON.stringify({ flow: { mode: "strict" } });
    delete process.env.OPENAI_API_KEY;
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
    assert.equal(snapshot.skills.some((s) => s.name === "Needs Config"), true);
    assert.equal(snapshot.skills.some((s) => s.name === "Needs Env"), false);
    assert.equal(snapshot.skills.some((s) => s.name === "Needs Bin"), false);
    assert.equal(snapshot.skills.some((s) => s.name === "Config Miss"), false);
    assert.equal(snapshot.errors.some((e) => e.code === "skill_gated"), true);
  } finally {
    await cleanupSandbox(sandbox.root);
  }
});

test("loadSkillByName returns body only (progressive disclosure)", async () => {
  const sandbox = await createSandbox();
  try {
    await writeSkill(
      sandbox.workspaceDir,
      "intent-router",
      `---\nname: intent-router\ndescription: route\n---\n\n# Intent Router\nRead user intent.`
    );

    const config = getSkillsConfig(sandbox.root);
    const snapshot = await getSkillsSnapshot(config);
    const loaded = await loadSkillByName(snapshot.skills, "intent-router", config);

    assert.ok(loaded);
    assert.equal(loaded?.name, "intent-router");
    assert.equal(loaded?.content, "# Intent Router\nRead user intent.");
    assert.equal(loaded?.content.includes("description:"), false);
  } finally {
    await cleanupSandbox(sandbox.root);
  }
});

test("shouldEnableSkillTooling respects enabled flag, skill count, and reasoning mode", () => {
  assert.equal(shouldEnableSkillTooling(true, 1, true), false);
  assert.equal(shouldEnableSkillTooling(true, 1, false), true);
  assert.equal(shouldEnableSkillTooling(true, 0, false), false);
  assert.equal(shouldEnableSkillTooling(false, 1, false), false);
});

test("buildSkillsSystemPrompt enforces canonical loadSkill tool naming", () => {
  const prompt = buildSkillsSystemPrompt([
    {
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
});

test("ENABLE_SKILLS defaults to true and SKILLS_DIRS is ignored", () => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.ENABLE_SKILLS;
  delete process.env.SKILLS_WORKSPACE_DIRS;
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
      `---\nname: Workspace Skill\ndescription: valid\n---\nbody`
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
