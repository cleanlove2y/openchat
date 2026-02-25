import assert from "node:assert/strict";
import test from "node:test";
import { localeFromPathname, localizePathFromPathname } from "./navigation";

test("localeFromPathname resolves fallback locale", () => {
  assert.equal(localeFromPathname("/zh/login"), "zh");
  assert.equal(localeFromPathname("/en/login"), "en");
  assert.equal(localeFromPathname("/login"), "zh");
  assert.equal(localeFromPathname(null), "zh");
});

test("localizePathFromPathname uses locale from current path", () => {
  assert.equal(localizePathFromPathname("/en/chat/1", "/login"), "/en/login");
  assert.equal(localizePathFromPathname("/zh", "/chat/2"), "/zh/chat/2");
  assert.equal(localizePathFromPathname(null, "/register"), "/zh/register");
});
