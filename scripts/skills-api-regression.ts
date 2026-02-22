type CookieJar = Map<string, string>;

type ChatRegressionResult = {
  status: number;
  hasLoadSkill: boolean;
  hasGetWeather: boolean;
  sseLength: number;
};

const BASE_URL = process.env.SKILLS_TEST_BASE_URL ?? "http://localhost:3000";
const SKILL_NAME = process.env.SKILLS_TEST_SKILL_NAME ?? "Regression Skill API";
const PROMPT_TEMPLATE =
  process.env.SKILLS_TEST_PROMPT ??
  "Call the tool `loadSkill` exactly once with skill name \"{skillName}\". After the tool call, reply with exactly: loaded";
const SKILL_DIR = join(process.cwd(), "agent-skills", "regression-skill-api");
const SKILL_FILE = join(SKILL_DIR, "SKILL.md");

function getSetCookieValues(headers: Headers): string[] {
  const anyHeaders = headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }

  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function updateCookieJar(jar: CookieJar, headers: Headers): void {
  for (const setCookie of getSetCookieValues(headers)) {
    const pair = setCookie.split(";")[0]?.trim();
    if (!pair) {
      continue;
    }
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    jar.set(key, value);
  }
}

function cookieHeaderFromJar(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function fetchWithCookies(
  url: string,
  jar: CookieJar,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookieHeader = cookieHeaderFromJar(jar);
  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  const response = await fetch(url, {
    ...init,
    headers,
    redirect: "manual",
  });

  updateCookieJar(jar, response.headers);
  return response;
}

async function followRedirects(url: string, jar: CookieJar): Promise<Response> {
  let currentUrl = url;

  for (let i = 0; i < 10; i += 1) {
    const response = await fetchWithCookies(currentUrl, jar);
    if (response.status < 300 || response.status >= 400) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error(`Redirect response missing location header: ${response.status}`);
    }
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error("Too many redirects while creating guest session");
}

function parseRegressionResult(response: Response, sse: string): ChatRegressionResult {
  return {
    status: response.status,
    hasLoadSkill: sse.includes('"toolName":"loadSkill"'),
    hasGetWeather: sse.includes('"toolName":"getWeather"'),
    sseLength: sse.length,
  };
}

async function run(): Promise<void> {
  await mkdir(SKILL_DIR, { recursive: true });
  await writeFile(
    SKILL_FILE,
    `---
name: ${SKILL_NAME}
description: Regression skill used by scripts/skills-api-regression.ts.
---
# Regression Skill API

Use this skill content normally when loaded.
`
  );
  const jar: CookieJar = new Map();

  const guestResponse = await followRedirects(
    `${BASE_URL}/api/auth/guest?redirectUrl=/`,
    jar
  );
  if (!guestResponse.ok) {
    throw new Error(`Guest session creation failed with status ${guestResponse.status}`);
  }

  const prompt = PROMPT_TEMPLATE.replaceAll("{skillName}", SKILL_NAME);

  const payload = {
    id: crypto.randomUUID(),
    message: {
      role: "user",
      id: crypto.randomUUID(),
      parts: [
        {
          type: "text",
          text: prompt,
        },
      ],
    },
    selectedChatModel: "google/gemini-2.5-flash-lite",
    selectedVisibilityType: "private",
  };

  const chatResponse = await fetchWithCookies(`${BASE_URL}/api/chat`, jar, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const sse = await chatResponse.text();
  const result = parseRegressionResult(chatResponse, sse);

  const summary = {
    ...result,
    baseUrl: BASE_URL,
    skillName: SKILL_NAME,
    prompt,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (result.status !== 200) {
    throw new Error(`Chat API returned non-200 status: ${result.status}`);
  }

  if (!result.hasLoadSkill) {
    throw new Error("Expected loadSkill tool call was not found in SSE response");
  }

  if (result.hasGetWeather) {
    throw new Error("Unexpected getWeather tool call was found in SSE response");
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => {
  try {
    await rm(SKILL_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
