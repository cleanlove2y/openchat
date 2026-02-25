import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { detectRequestLocale } from "./detector";

test("prefers locale cookie over accept-language", () => {
  const request = new NextRequest("http://localhost/chat", {
    headers: {
      "accept-language": "en-US,en;q=0.9",
      cookie: "OPENCHAT_LOCALE=zh",
    },
  });

  assert.equal(detectRequestLocale(request), "zh");
});

test("resolves locale by accept-language quality weights", () => {
  const request = new NextRequest("http://localhost/chat", {
    headers: {
      "accept-language": "en;q=0.5,zh;q=0.9",
    },
  });

  assert.equal(detectRequestLocale(request), "zh");
});

test("uses default quality 1 when q is omitted", () => {
  const request = new NextRequest("http://localhost/chat", {
    headers: {
      "accept-language": "en-US,zh;q=0.9",
    },
  });

  assert.equal(detectRequestLocale(request), "en");
});

test("falls back to default locale when no supported language exists", () => {
  const request = new NextRequest("http://localhost/chat", {
    headers: {
      "accept-language": "fr-FR,ja-JP;q=0.8",
    },
  });

  assert.equal(detectRequestLocale(request), "zh");
});
