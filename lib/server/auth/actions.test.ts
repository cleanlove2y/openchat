import assert from "node:assert/strict";
import test from "node:test";

test("completeRegistrationSignIn preserves success when sign-in raises AuthError", async () => {
  let registerSignIn: Record<string, unknown> = {};

  try {
    registerSignIn = await import("./register-signin");
  } catch {
    registerSignIn = {};
  }

  assert.equal(typeof registerSignIn.completeRegistrationSignIn, "function");
  const completeRegistrationSignIn =
    registerSignIn.completeRegistrationSignIn as (args: {
      email: string;
      formData: FormData;
      password: string;
      signInFn: (
        provider: string,
        options: Record<string, unknown>
      ) => Promise<unknown>;
    }) => Promise<{ status: "success" }>;

  const formData = new FormData();
  const authError = new Error("auth") as Error & { type?: string };

  authError.name = "AuthError";
  authError.type = "AuthError";

  const result = await completeRegistrationSignIn({
    email: "user@example.com",
    formData,
    password: "password123",
    signInFn: () => Promise.reject(authError),
  });

  assert.deepEqual(result, { status: "success" });
});

test("resolveAuthRedirectTo uses the submitted localized redirect path", async () => {
  let authRedirect: Partial<typeof import("./redirect-target")> = {};

  try {
    authRedirect = await import("./redirect-target");
  } catch {
    authRedirect = {};
  }

  assert.equal(typeof authRedirect.resolveAuthRedirectTo, "function");
  const resolveAuthRedirectTo = authRedirect.resolveAuthRedirectTo as (
    formData: FormData
  ) => string;

  const formData = new FormData();
  formData.set("redirectTo", "/zh");

  assert.equal(resolveAuthRedirectTo(formData), "/zh");
});

test("resolveAuthRedirectTo falls back to the app root when missing", async () => {
  let authRedirect: Partial<typeof import("./redirect-target")> = {};

  try {
    authRedirect = await import("./redirect-target");
  } catch {
    authRedirect = {};
  }

  assert.equal(typeof authRedirect.resolveAuthRedirectTo, "function");
  const resolveAuthRedirectTo = authRedirect.resolveAuthRedirectTo as (
    formData: FormData
  ) => string;

  assert.equal(resolveAuthRedirectTo(new FormData()), "/");
});
