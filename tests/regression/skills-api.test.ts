import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const BASE_URL = process.env.SKILLS_TEST_BASE_URL ?? "http://localhost:3000";
const SKILL_NAME = "Regression Skill API";
const SKILL_DIR = join(process.cwd(), "agent-skills", "regression-skill-api");
const SKILL_FILE = join(SKILL_DIR, "SKILL.md");

type CookieJar = Map<string, string>;

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

test.before(async () => {
  await mkdir(SKILL_DIR, { recursive: true });
  await writeFile(
    SKILL_FILE,
    `---
name: ${SKILL_NAME}
description: Regression skill used by automated API tests.
---
# Regression Skill API

Use this skill content normally when loaded.
`
  );
});

test.after(async () => {
  await rm(SKILL_DIR, { recursive: true, force: true });
});

test("chat API loads skill and does not call weather tool", async () => {
  const jar: CookieJar = new Map();

  const guestResponse = await followRedirects(
    `${BASE_URL}/api/auth/guest?redirectUrl=/`,
    jar
  );
  assert.equal(
    guestResponse.ok,
    true,
    `Guest session creation failed with status ${guestResponse.status}`
  );

  const payload = {
    id: crypto.randomUUID(),
    message: {
      role: "user",
      id: crypto.randomUUID(),
      parts: [
        {
          type: "text",
          text: `Call the tool \`loadSkill\` exactly once with skill name "${SKILL_NAME}". After the tool call, reply with exactly: loaded`,
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

  assert.equal(chatResponse.status, 200, "Chat API should return 200");
  const sse = await chatResponse.text();

  assert.equal(
    sse.includes('"toolName":"loadSkill"'),
    true,
    "Expected loadSkill tool call in SSE response"
  );
  assert.equal(
    sse.includes(`"${SKILL_NAME}"`),
    true,
    "Expected skill name in SSE response"
  );
  assert.equal(
    sse.includes('"toolName":"getWeather"'),
    false,
    "Unexpected getWeather tool call in SSE response"
  );
});
