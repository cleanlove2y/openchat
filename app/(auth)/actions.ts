"use server";

import { z } from "zod";

import { createUser, getUser } from "@/lib/db/queries";
import { hashForLog, writeAuditLog } from "@/lib/logging";

import { signIn } from "./auth";

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
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });

    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    return { status: "success" };
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
  try {
    const validatedData = authFormSchema.parse({
      email: formData.get("email"),
      password: formData.get("password"),
    });
    const emailHash = hashForLog(validatedData.email.toLowerCase());

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
    await signIn("credentials", {
      email: validatedData.email,
      password: validatedData.password,
      redirect: false,
    });

    writeAuditLog({
      action: "auth.register",
      resourceType: "user",
      outcome: "success",
      statusCode: 201,
      metadata: {
        emailHash,
      },
    });

    return { status: "success" };
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
};
