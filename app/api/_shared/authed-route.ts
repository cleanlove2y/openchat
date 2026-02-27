import type { Session } from "next-auth";
import {
  createApiRoute,
  type RouteFactoryOptions,
} from "@/lib/logging/route-factory";
import type { UserType } from "@/lib/server/auth/core";

type MaybePromise<T> = T | Promise<T>;

export type AuthenticatedSession = Session & {
  user: Session["user"] & {
    id: string;
    type: UserType;
  };
};

type CreateAuthedApiRouteOptions<TInput, TArgs extends unknown[]> = Omit<
  RouteFactoryOptions<AuthenticatedSession, TArgs, TInput, true>,
  "getSession" | "requireUser"
> & {
  getSession?: () => MaybePromise<AuthenticatedSession | null>;
};

export function createAuthedApiRoute<
  TInput = unknown,
  TArgs extends unknown[] = [],
>(options: CreateAuthedApiRouteOptions<TInput, TArgs>) {
  const getSession = options.getSession ?? defaultGetSession;

  return createApiRoute<AuthenticatedSession, TArgs, TInput, true>({
    ...options,
    getSession,
    requireUser: true,
  });
}

async function defaultGetSession(): Promise<AuthenticatedSession | null> {
  const { auth } = await import("@/lib/server/auth/core");
  return (await auth()) as AuthenticatedSession | null;
}
