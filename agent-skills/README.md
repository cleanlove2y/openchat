# Agent Skills Directory

Place skills under this directory using the structure below:

```
agent-skills/
  <skill-name>/
    SKILL.md
```

`SKILL.md` should include frontmatter with required fields:

```md
---
name: your-skill-name
description: Short sentence for when to use this skill.
metadata:
  openchat:
    requires:
      env: [OPENAI_API_KEY]
---

# Instructions
Detailed instructions for the skill.
```

OpenChat source priority is fixed:
1. `SKILLS_WORKSPACE_DIRS` (default `agent-skills`)
2. `SKILLS_USER_DIR` (default `~/.openchat/skills`, empty on Vercel)
3. `SKILLS_BUNDLED_DIR` (default `skills/bundled`)

Conflicts are deduplicated by `name`, higher-priority source wins.

Runtime behavior:
- Metadata is loaded first.
- Full body is loaded only when `loadSkill` is called.
- Skills errors are fail-open (chat continues).
