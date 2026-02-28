import { z } from "zod";
import type { AuthenticatedSession } from "@/app/api/_shared/authed-route";
import { OpenChatError } from "@/lib/errors";
import { auth } from "@/lib/server/auth/core";

const nullableString = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (typeof value !== "string") {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

export const connectionIdSchema = z.string().uuid();

export const createConnectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  provider: z.string().trim().min(1).max(64),
  baseUrl: z.string().trim().url(),
  apiKey: z.string().trim().min(1),
  defaultModel: nullableString,
  defaultTemperature: nullableString,
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  validate: z.boolean().optional(),
});

export const updateConnectionSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  provider: z.string().trim().min(1).max(64).optional(),
  baseUrl: z.string().trim().url().optional(),
  apiKey: z.string().trim().min(1).optional(),
  defaultModel: nullableString.optional(),
  defaultTemperature: nullableString.optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  validate: z.boolean().optional(),
});

export async function requireRegularUserSession(): Promise<AuthenticatedSession> {
  const session = (await auth()) as AuthenticatedSession | null;

  if (!session?.user?.id) {
    throw new OpenChatError("unauthorized:auth");
  }

  if (session.user.type !== "regular") {
    throw new OpenChatError("forbidden:auth");
  }

  return session;
}
