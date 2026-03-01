import assert from "node:assert/strict";
import test from "node:test";

test("mobile top bar exposes a mobile-only shell", async () => {
  let mobileTopBar: Partial<typeof import("./mobile-top-bar")> = {};

  try {
    mobileTopBar = await import("./mobile-top-bar");
  } catch {
    mobileTopBar = {};
  }

  assert.equal(typeof mobileTopBar.MobileTopBar, "function");
  assert.equal(typeof mobileTopBar.mobileTopBarClassName, "string");
  assert.equal(
    (mobileTopBar.mobileTopBarClassName as string).includes("md:hidden"),
    true
  );
  assert.equal(
    (mobileTopBar.mobileTopBarClassName as string).includes("border-b"),
    false
  );
});
