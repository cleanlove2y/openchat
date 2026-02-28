import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest, NextResponse } from "next/server";
import { proxy } from "./proxy";

test("redirects non-localized page requests to locale-prefixed path", async () => {
  const request = new NextRequest("http://localhost/chat/demo?tab=recent", {
    headers: {
      "accept-language": "en-US,en;q=0.9",
    },
  });

  const response = (await proxy(request)) as NextResponse;

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "http://localhost/en/chat/demo?tab=recent"
  );
  assert.equal(response.cookies.get("OPENCHAT_LOCALE")?.value, "en");
});

test("prefers locale cookie over accept-language when redirecting page requests", async () => {
  const request = new NextRequest("http://localhost/login", {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      cookie: "OPENCHAT_LOCALE=zh",
    },
  });

  const response = (await proxy(request)) as NextResponse;

  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), "http://localhost/zh/login");
  assert.equal(response.cookies.get("OPENCHAT_LOCALE")?.value, "zh");
});

test("strips locale prefix from localized api requests", async () => {
  const request = new NextRequest("http://localhost/en/api/history?limit=20");

  const response = await proxy(request);

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "http://localhost/api/history?limit=20"
  );
});

test("strips locale prefix from localized public files", async () => {
  const request = new NextRequest("http://localhost/zh/assets/logo.png");

  const response = await proxy(request);

  assert.equal(response.status, 307);
  assert.equal(
    response.headers.get("location"),
    "http://localhost/assets/logo.png"
  );
});

test("keeps locale prefix for locale-scoped metadata image files", async () => {
  const request = new NextRequest("http://localhost/en/opengraph-image.png");

  const response = await proxy(request);

  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("passes through non-localized public files without redirect", async () => {
  const request = new NextRequest("http://localhost/assets/logo.png");

  const response = await proxy(request);

  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("avoids self-redirect for excluded non-localized paths", async () => {
  const request = new NextRequest("http://localhost/api");

  const response = await proxy(request);

  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});
