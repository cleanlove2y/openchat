import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";

import { createAuthedApiRoute } from "@/app/(chat)/api/_shared/authed-route";
import { getRequestContext } from "./index";
import { createApiRoute } from "./route-factory";

test("createApiRoute returns unauthorized response when user is required", async () => {
  const route = createApiRoute({
    route: "/api/protected",
    method: "GET",
    requireUser: true,
    unauthorizedErrorCode: "unauthorized:chat",
    getSession: async () => null,
    handler: async () => Response.json({ ok: true }),
  });

  const response = await route(new Request("http://localhost/api/protected"));
  const body = (await response.json()) as { code?: string };

  assert.equal(response.status, 401);
  assert.equal(body.code, "unauthorized:chat");
});

test("createApiRoute injects actor into request context", async () => {
  const route = createApiRoute({
    route: "/api/protected",
    method: "GET",
    requireUser: true,
    getSession: async () => ({
      user: {
        id: "user-42",
        type: "regular",
      },
    }),
    handler: async () => {
      const context = getRequestContext();
      return Response.json({
        userId: context?.userId,
        userType: context?.userType,
      });
    },
  });

  const response = await route(new Request("http://localhost/api/protected"));
  const body = (await response.json()) as {
    userId?: string;
    userType?: string;
  };

  assert.equal(response.status, 200);
  assert.equal(body.userId, "user-42");
  assert.equal(body.userType, "regular");
});

test("createApiRoute supports custom unauthorized responses", async () => {
  const route = createApiRoute({
    route: "/api/custom-auth",
    method: "POST",
    requireUser: true,
    getSession: async () => null,
    unauthorizedResponse: async () =>
      Response.json({ error: "Unauthorized" }, { status: 401 }),
    handler: async () => Response.json({ ok: true }),
  });

  const response = await route(
    new Request("http://localhost/api/custom-auth", { method: "POST" })
  );
  const body = (await response.json()) as { error?: string };

  assert.equal(response.status, 401);
  assert.equal(body.error, "Unauthorized");
});

test("createApiRoute returns bad_request when parseRequest fails", async () => {
  const route = createApiRoute({
    route: "/api/parse",
    method: "POST",
    badRequestErrorCode: "bad_request:api",
    parseRequest: async (request) => {
      const schema = z.object({ id: z.string().uuid() });
      return schema.parse(await request.json());
    },
    handler: async () => Response.json({ ok: true }),
  });

  const response = await route(
    new Request("http://localhost/api/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "not-a-uuid" }),
    })
  );
  const body = (await response.json()) as { code?: string };

  assert.equal(response.status, 400);
  assert.equal(body.code, "bad_request:api");
});

test("createApiRoute passes parsed input into handler", async () => {
  const route = createApiRoute({
    route: "/api/parse",
    method: "POST",
    parseRequest: async (request) => {
      const schema = z.object({ count: z.number().int() });
      return schema.parse(await request.json());
    },
    handler: async ({ input }) =>
      Response.json({ doubled: ((input as { count: number }).count ?? 0) * 2 }),
  });

  const response = await route(
    new Request("http://localhost/api/parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 21 }),
    })
  );
  const body = (await response.json()) as { doubled?: number };

  assert.equal(response.status, 200);
  assert.equal(body.doubled, 42);
});

test("createApiRoute supports mapError for unified error handling", async () => {
  const route = createApiRoute({
    route: "/api/error-map",
    method: "GET",
    mapError: async (error) => {
      if (error instanceof Error && error.message === "boom") {
        return Response.json({ code: "mapped:error" }, { status: 500 });
      }
      return undefined;
    },
    handler: async () => {
      throw new Error("boom");
    },
  });

  const response = await route(new Request("http://localhost/api/error-map"));
  const body = (await response.json()) as { code?: string };

  assert.equal(response.status, 500);
  assert.equal(body.code, "mapped:error");
});

test("createAuthedApiRoute returns unauthorized response when session is missing", async () => {
  const route = createAuthedApiRoute({
    route: "/api/authed",
    method: "GET",
    unauthorizedErrorCode: "unauthorized:api",
    getSession: async () => null,
    handler: async () => Response.json({ ok: true }),
  });

  const response = await route(new Request("http://localhost/api/authed"));
  const body = (await response.json()) as { code?: string };

  assert.equal(response.status, 401);
  assert.equal(body.code, "unauthorized:api");
});

test("createAuthedApiRoute injects authed session and parsed input into handler", async () => {
  const route = createAuthedApiRoute<{ id: string }>({
    route: "/api/authed-parse",
    method: "POST",
    getSession: async () => ({
      user: {
        id: "user-99",
        type: "regular",
      },
      expires: new Date(Date.now() + 60_000).toISOString(),
    }),
    parseRequest: async (request) => {
      const schema = z.object({ id: z.string().min(1) });
      return schema.parse(await request.json());
    },
    handler: async ({ session, input }) =>
      Response.json({
        userId: session.user.id,
        type: session.user.type,
        id: input.id,
      }),
  });

  const response = await route(
    new Request("http://localhost/api/authed-parse", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "doc-1" }),
    })
  );
  const body = (await response.json()) as {
    userId?: string;
    type?: string;
    id?: string;
  };

  assert.equal(response.status, 200);
  assert.equal(body.userId, "user-99");
  assert.equal(body.type, "regular");
  assert.equal(body.id, "doc-1");
});

test("createAuthedApiRoute skips audit metadata extraction for unauthorized requests", async () => {
  let metadataWasRead = false;

  const route = createAuthedApiRoute({
    route: "/api/upload",
    method: "POST",
    unauthorizedErrorCode: "unauthorized:api",
    getSession: async () => null,
    audit: {
      action: "file.upload",
      resourceType: "blob",
      getMetadata: async (request) => {
        metadataWasRead = true;
        await request.formData();
        return {
          parsed: true,
        };
      },
    },
    handler: async () => Response.json({ ok: true }),
  });

  const formData = new FormData();
  formData.set("file", new Blob(["test"], { type: "text/plain" }), "test.txt");

  const response = await route(
    new Request("http://localhost/api/upload", {
      method: "POST",
      body: formData,
    })
  );
  const body = (await response.json()) as { code?: string };

  assert.equal(response.status, 401);
  assert.equal(body.code, "unauthorized:api");
  assert.equal(metadataWasRead, false);
});
