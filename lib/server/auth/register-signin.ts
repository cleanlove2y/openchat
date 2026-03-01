import { AuthError } from "next-auth";

import { resolveAuthRedirectTo } from "./redirect-target";

type RegisterSignInArgs = {
  email: string;
  formData: FormData;
  password: string;
  signInFn: (
    provider: string,
    options: {
      email: string;
      password: string;
      redirectTo: string;
    }
  ) => Promise<unknown>;
};

function isAuthJsError(error: unknown): error is AuthError {
  if (error instanceof AuthError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.name === "AuthError" ||
    (typeof (error as { type?: unknown }).type === "string" &&
      (error as { type: string }).type === "AuthError")
  );
}

export async function completeRegistrationSignIn({
  email,
  formData,
  password,
  signInFn,
}: RegisterSignInArgs): Promise<{ status: "success" }> {
  try {
    await signInFn("credentials", {
      email,
      password,
      redirectTo: resolveAuthRedirectTo(formData),
    });
  } catch (error) {
    if (!isAuthJsError(error)) {
      throw error;
    }
  }

  return { status: "success" };
}
