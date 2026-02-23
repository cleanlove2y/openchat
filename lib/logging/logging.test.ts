import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAuthedApiRoute } from "@/app/(chat)/api/_shared/authed-route";
import {
  configureLoggingForTests,
  flushLoggersForTests,
  setRequestActor,
  withRouteLogging,
} from "./index";

async function readJsonLines(path: string): Promise<Record<string, unknown>[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("withRouteLogging writes app logs and attaches x-request-id", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "openchat-logs-"));
  configureLoggingForTests({ logDir });

  try {
    const handler = withRouteLogging(
      {
        route: "/api/test",
        method: "POST",
      },
      async () => {
        setRequestActor({ userId: "user-1", userType: "regular" });
        return Response.json({ ok: true }, { status: 201 });
      }
    );

    const response = await handler(
      new Request("http://localhost/api/test", { method: "POST" })
    );

    assert.equal(response.status, 201);
    assert.ok(response.headers.get("x-request-id"));

    await flushLoggersForTests();

    const lines = await readJsonLines(join(logDir, "app.log"));

    assert.equal(
      lines.some((line) => line.event === "http.request.start"),
      true
    );
    assert.equal(
      lines.some(
        (line) =>
          line.event === "http.request.complete" && line.statusCode === 201
      ),
      true
    );
  } finally {
    await rm(logDir, { recursive: true, force: true });
  }
});

test("withRouteLogging writes success audit logs for mutating endpoints", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "openchat-audit-"));
  configureLoggingForTests({ logDir });

  try {
    const handler = withRouteLogging(
      {
        route: "/api/chat",
        method: "DELETE",
        audit: {
          action: "chat.delete",
          resourceType: "chat",
          getResourceId: (request) =>
            new URL(request.url).searchParams.get("id") ?? undefined,
        },
      },
      async () => {
        setRequestActor({ userId: "user-2", userType: "regular" });
        return new Response(null, { status: 200 });
      }
    );

    const response = await handler(
      new Request("http://localhost/api/chat?id=chat-123", { method: "DELETE" })
    );

    assert.equal(response.status, 200);
    await flushLoggersForTests();

    const lines = await readJsonLines(join(logDir, "audit.log"));
    const entry = lines.find(
      (line) =>
        line.event === "audit.event" &&
        line.action === "chat.delete" &&
        line.resourceId === "chat-123"
    );

    assert.ok(entry);
    assert.equal(entry.outcome, "success");
    assert.equal(entry.actorId, "user-2");
  } finally {
    await rm(logDir, { recursive: true, force: true });
  }
});

test("withRouteLogging writes failed audit logs for rejected requests", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "openchat-audit-fail-"));
  configureLoggingForTests({ logDir });

  try {
    const handler = withRouteLogging(
      {
        route: "/api/document",
        method: "DELETE",
        audit: {
          action: "document.delete",
          resourceType: "document",
        },
      },
      async () => {
        return Response.json({ code: "forbidden:document" }, { status: 403 });
      }
    );

    const response = await handler(
      new Request("http://localhost/api/document?id=doc-1", { method: "DELETE" })
    );

    assert.equal(response.status, 403);
    await flushLoggersForTests();

    const lines = await readJsonLines(join(logDir, "audit.log"));
    const entry = lines.find(
      (line) =>
        line.event === "audit.event" && line.action === "document.delete"
    );

    assert.ok(entry);
    assert.equal(entry.outcome, "failure");
    assert.equal(entry.statusCode, 403);
  } finally {
    await rm(logDir, { recursive: true, force: true });
  }
});

test("withRouteLogging can log request/response bodies when enabled", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "openchat-http-details-"));
  configureLoggingForTests({
    logDir,
    logHttpRequestBody: true,
    logHttpResponseBody: true,
  });

  try {
    const handler = withRouteLogging(
      {
        route: "/api/http-details",
        method: "POST",
      },
      async () => Response.json({ result: "ok" }, { status: 200 })
    );

    const response = await handler(
      new Request("http://localhost/api/http-details?source=test", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: "hello",
          password: "super-secret",
        }),
      })
    );

    assert.equal(response.status, 200);
    await flushLoggersForTests();

    const lines = await readJsonLines(join(logDir, "app.log"));
    const start = lines.find((line) => line.event === "http.request.start");
    const complete = lines.find((line) => line.event === "http.request.complete");

    assert.ok(start);
    assert.ok(complete);
    const startRequest = start.request as
      | { query?: { source?: string }; body?: Record<string, any> }
      | undefined;
    const completeResponse = complete.response as
      | { body?: { result?: string } }
      | undefined;
    assert.equal(startRequest?.query?.source, "test");
    assert.equal(startRequest?.body?.message, "hello");
    assert.equal(startRequest?.body?.password?.redacted, true);
    assert.equal(completeResponse?.body?.result, "ok");
  } finally {
    await rm(logDir, { recursive: true, force: true });
  }
});

test("withRouteLogging does not fail when log directory cannot be created", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "openchat-logs-fallback-"));
  const blockedPath = join(rootDir, "blocked-log-dir");
  await writeFile(blockedPath, "not-a-directory");
  configureLoggingForTests({ logDir: blockedPath });

  try {
    const handler = withRouteLogging(
      {
        route: "/api/fallback",
      },
      async () => Response.json({ ok: true })
    );

    const response = await handler(
      new Request("http://localhost/api/fallback", { method: "GET" })
    );

    assert.equal(response.status, 200);
    assert.ok(response.headers.get("x-request-id"));
    await flushLoggersForTests();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("withRouteLogging treats NEXT_REDIRECT as a successful audit event", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "openchat-audit-redirect-"));
  configureLoggingForTests({ logDir });

  try {
    const handler = withRouteLogging(
      {
        route: "/api/auth/guest",
        method: "POST",
        audit: {
          action: "auth.guest.sign_in",
          resourceType: "session",
        },
      },
      async () => {
        const redirectError = new Error("NEXT_REDIRECT") as Error & {
          digest: string;
        };
        redirectError.digest = "NEXT_REDIRECT;replace;/chat;303;";
        throw redirectError;
      }
    );

    await assert.rejects(
      handler(new Request("http://localhost/api/auth/guest", { method: "POST" })),
      (error: unknown) => {
        const err = error as Error & { digest?: string };
        return err.message === "NEXT_REDIRECT" && err.digest?.includes("/chat");
      }
    );

    await flushLoggersForTests();

    const appLines = await readJsonLines(join(logDir, "app.log"));
    assert.equal(
      appLines.some((line) => line.event === "http.request.error"),
      false
    );

    const auditLines = await readJsonLines(join(logDir, "audit.log"));
    const entry = auditLines.find(
      (line) =>
        line.event === "audit.event" && line.action === "auth.guest.sign_in"
    );

    assert.ok(entry);
    assert.equal(entry.outcome, "success");
    assert.equal(entry.statusCode, 303);
  } finally {
    await rm(logDir, { recursive: true, force: true });
  }
});

test("createAuthedApiRoute preserves audit fields in audit logger", async () => {
  const logDir = await mkdtemp(join(tmpdir(), "openchat-authed-audit-"));
  configureLoggingForTests({ logDir });

  try {
    const handler = createAuthedApiRoute({
      route: "/api/authed-audit",
      method: "PATCH",
      getSession: async () => ({
        user: {
          id: "user-3",
          type: "regular",
        },
        expires: new Date(Date.now() + 60_000).toISOString(),
      }),
      audit: {
        action: "vote.update",
        resourceType: "vote",
        getResourceId: (request) =>
          new URL(request.url).searchParams.get("id") ?? undefined,
        getMetadata: () => ({
          source: "authed-helper",
        }),
      },
      handler: async () => new Response(null, { status: 204 }),
    });

    const response = await handler(
      new Request("http://localhost/api/authed-audit?id=vote-7", {
        method: "PATCH",
      })
    );

    assert.equal(response.status, 204);
    await flushLoggersForTests();

    const lines = await readJsonLines(join(logDir, "audit.log"));
    const entry = lines.find(
      (line) => line.event === "audit.event" && line.action === "vote.update"
    );

    assert.ok(entry);
    assert.equal(entry.route, "/api/authed-audit");
    assert.equal(entry.method, "PATCH");
    assert.equal(entry.resourceType, "vote");
    assert.equal(entry.resourceId, "vote-7");
    assert.equal(entry.actorId, "user-3");
    assert.equal(entry.outcome, "success");
    assert.equal(entry.statusCode, 204);
  } finally {
    await rm(logDir, { recursive: true, force: true });
  }
});
