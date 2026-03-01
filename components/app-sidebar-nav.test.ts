import assert from "node:assert/strict";
import test from "node:test";

test("getSidebarPrimaryRoutes returns the localized new chat entry", async () => {
  const nav = await import("./app-sidebar-nav");

  const routes = nav.getSidebarPrimaryRoutes("/zh/chat/abc123", "新聊天");

  assert.equal(routes.length, 1);
  assert.deepEqual(routes[0], {
    href: "/zh",
    isActive: false,
    label: "新聊天",
    shouldRefresh: true,
  });
});

test("getSidebarPrimaryRoutes marks the root route as active", async () => {
  const nav = await import("./app-sidebar-nav");

  const routes = nav.getSidebarPrimaryRoutes("/en", "New chat");

  assert.equal(routes[0]?.isActive, true);
});
