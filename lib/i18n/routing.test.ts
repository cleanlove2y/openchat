import assert from "node:assert/strict";
import test from "node:test";
import { FALLBACK_LOCALE } from "./config";
import {
  getLocaleFromPathname,
  getLocaleOrFallback,
  stripLocalePrefix,
  withLocalePath,
} from "./routing";

test("getLocaleFromPathname resolves supported locale prefixes", () => {
  assert.equal(getLocaleFromPathname("/zh/chat/1"), "zh");
  assert.equal(getLocaleFromPathname("/en"), "en");
  assert.equal(getLocaleFromPathname("/"), null);
  assert.equal(getLocaleFromPathname("/fr/login"), null);
});

test("getLocaleOrFallback returns fallback locale when no prefix exists", () => {
  assert.equal(getLocaleOrFallback("/chat/1"), FALLBACK_LOCALE);
  assert.equal(getLocaleOrFallback(null), FALLBACK_LOCALE);
  assert.equal(getLocaleOrFallback("/en/chat/1"), "en");
});

test("stripLocalePrefix removes only a supported locale prefix", () => {
  assert.equal(stripLocalePrefix("/zh/chat/1"), "/chat/1");
  assert.equal(stripLocalePrefix("/en"), "/");
  assert.equal(stripLocalePrefix("/register"), "/register");
});

test("withLocalePath prefixes localized page paths", () => {
  assert.equal(withLocalePath("zh", "/"), "/zh");
  assert.equal(withLocalePath("zh", "/chat/1"), "/zh/chat/1");
  assert.equal(withLocalePath("en", "register"), "/en/register");
});

test("withLocalePath does not re-prefix an already localized path", () => {
  assert.equal(withLocalePath("zh", "/en/chat/1"), "/en/chat/1");
  assert.equal(withLocalePath("en", "/zh/login"), "/zh/login");
});

test("withLocalePath skips excluded non-page paths", () => {
  assert.equal(withLocalePath("zh", "/api/history"), "/api/history");
  assert.equal(
    withLocalePath("zh", "/_next/static/chunks/main.js"),
    "/_next/static/chunks/main.js"
  );
  assert.equal(withLocalePath("zh", "/favicon.ico"), "/favicon.ico");
  assert.equal(withLocalePath("zh", "/sitemap.xml"), "/sitemap.xml");
  assert.equal(withLocalePath("zh", "/robots.txt"), "/robots.txt");
});
