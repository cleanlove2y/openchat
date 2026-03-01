"use server";

import { AuthError } from "next-auth";
import { z } from "zod";

import { createUser, getUser } from "@/lib/db/queries";
import { hashForLog, writeAuditLog } from "@/lib/logging";
import { signIn } from "./core";
import { resolveAuthRedirectTo } from "./redirect-target";
import { completeRegistrationSignIn } from "./register-signin";

const authFormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export type LoginActionState = {
  status: "idle" | "in_progress" | "success" | "failed" | "invalid_data";
};

export const login = async (
  _: LoginActionState,
  formData: FormData
): Promise<LoginActionState> => {
  let validatedData: z.infer<typeof authFormSchema>;

  try {
    validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      writeAuditLog({
        action: "auth.login",
        resourceType: "session",
        outcome: "failure",
        statusCode: 400,
        reason: "invalid_data",
      });
      return { status: "invalid_data" };
    }

    return { status: "failed" };
  }

  try {
    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirectTo: resolveAuthRedirectTo(formData),
    });

    return { status: "success" };
  } catch (error) {
    if (error instanceof AuthError) {
      return { status: "failed" };
    }

    throw error;
  }
};

export type RegisterActionState = {
  status:
    | "idle"
    | "in_progress"
    | "success"
    | "failed"
    | "user_exists"
    | "invalid_data";
};

export const register = async (
  _: RegisterActionState,
  formData: FormData
): Promise<RegisterActionState> => {
  let validatedData: z.infer<typeof authFormSchema>;

  try {
    validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      writeAuditLog({
        action: "auth.register",
        resourceType: "user",
        outcome: "failure",
        statusCode: 400,
        reason: "invalid_data",
      });
      return { status: "invalid_data" };
    }

    writeAuditLog({
      action: "auth.register",
      resourceType: "user",
      outcome: "failure",
      statusCode: 500,
      reason: "register_failed",
    });

    return { status: "failed" };
  }

  const emailHash = hashForLog(validatedData.email.toLowerCase());

  try {
    const [user] = await getUser(validatedData.email);

    if (user) {
      writeAuditLog({
        action: "auth.register",
        resourceType: "user",
        outcome: "failure",
        statusCode: 409,
        reason: "user_exists",
        metadata: {
          emailHash,
        },
      });
      return { status: "user_exists" } as RegisterActionState;
    }

    await createUser(validatedData.email, validatedData.password);

    writeAuditLog({
      action: "auth.register",
      resourceType: "user",
      outcome: "success",
      statusCode: 201,
      metadata: {
        emailHash,
      },
    });
  } catch (_error) {
    writeAuditLog({
      action: "auth.register",
      resourceType: "user",
      outcome: "failure",
      statusCode: 500,
      reason: "register_failed",
    });

    return { status: "failed" };
  }

  return completeRegistrationSignIn({
    email: validatedData.email,
    formData,
    password: validatedData.password,
    signInFn: signIn,
  });
};
