const SKILL_DIRECTIVE_PATTERN = /\[Use Skill:\s*([^\]]+)\]/g;

type SkillDirectiveCollection = {
  requestedSkillNames: string[];
};

function addUniqueSkillName(
  requestedSkillNames: string[],
  seenSkillNames: Set<string>,
  value: string
): void {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }

  const normalized = trimmed.toLowerCase();
  if (seenSkillNames.has(normalized)) {
    return;
  }

  seenSkillNames.add(normalized);
  requestedSkillNames.push(trimmed);
}

export function extractSkillDirectives(
  text: string
): SkillDirectiveCollection & {
  strippedText: string;
} {
  const requestedSkillNames: string[] = [];
  const seenSkillNames = new Set<string>();
  const matches = text.matchAll(SKILL_DIRECTIVE_PATTERN);

  for (const match of matches) {
    if (match[1]) {
      addUniqueSkillName(requestedSkillNames, seenSkillNames, match[1]);
    }
  }

  const strippedText = text
    .replace(SKILL_DIRECTIVE_PATTERN, "")
    .replace(/^\s*\n+/, "")
    .replace(/\n{3,}/g, "\n\n");

  return {
    requestedSkillNames,
    strippedText,
  };
}

export function collectSkillDirectiveNamesFromParts(parts: unknown): string[] {
  if (!Array.isArray(parts)) {
    return [];
  }

  const requestedSkillNames: string[] = [];
  const seenSkillNames = new Set<string>();

  for (const part of parts) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const maybeTextPart = part as { type?: unknown; text?: unknown };
    if (
      maybeTextPart.type !== "text" ||
      typeof maybeTextPart.text !== "string"
    ) {
      continue;
    }

    const { requestedSkillNames: parsedSkillNames } = extractSkillDirectives(
      maybeTextPart.text
    );

    for (const parsedSkillName of parsedSkillNames) {
      addUniqueSkillName(requestedSkillNames, seenSkillNames, parsedSkillName);
    }
  }

  return requestedSkillNames;
}

function getMessageParts(message: unknown): unknown {
  if (!message || typeof message !== "object") {
    return undefined;
  }

  return (message as { parts?: unknown }).parts;
}

function getLatestUserMessage(messages: unknown): unknown {
  if (!Array.isArray(messages)) {
    return undefined;
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const candidate = messages[i];
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    if ((candidate as { role?: unknown }).role === "user") {
      return candidate;
    }
  }

  return undefined;
}

export function collectSkillDirectiveNamesFromRequestBody(body: {
  message?: unknown;
  messages?: unknown;
}): string[] {
  const requestedSkillNames: string[] = [];
  const seenSkillNames = new Set<string>();

  const mergeSkillNames = (names: string[]) => {
    for (const name of names) {
      addUniqueSkillName(requestedSkillNames, seenSkillNames, name);
    }
  };

  mergeSkillNames(
    collectSkillDirectiveNamesFromParts(getMessageParts(body.message))
  );

  const latestUserMessage = getLatestUserMessage(body.messages);
  mergeSkillNames(
    collectSkillDirectiveNamesFromParts(getMessageParts(latestUserMessage))
  );

  return requestedSkillNames;
}
