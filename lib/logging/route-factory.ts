import { type ErrorCode, OpenChatError } from "@/lib/errors";
import { setRequestActor, withRouteLogging } from "./index";

type SessionUserLike = {
  id?: string | null;
  type?: string | null;
};

type SessionLike = {
  user?: SessionUserLike | null;
} | null;

type MaybePromise<T> = T | Promise<T>;

export type RouteFactoryContext<
  TSession,
  TArgs extends unknown[],
  TInput = unknown,
  TRequireUser extends boolean = false,
> = {
  request: Request;
  args: TArgs;
  session: TRequireUser extends true ? TSession : TSession | null;
  input: TInput;
};

export type RouteFactoryOptions<
  TSession,
  TArgs extends unknown[],
  TInput = unknown,
  TRequireUser extends boolean = false,
> = {
  route: string;
  method?: string;
  audit?: Parameters<typeof withRouteLogging<TArgs>>[0]["audit"];
  getSession?: () => MaybePromise<TSession | null>;
  requireUser?: TRequireUser;
  unauthorizedErrorCode?: ErrorCode;
  badRequestErrorCode?: ErrorCode;
  unauthorizedResponse?: (
    request: Request,
    ...args: TArgs
  ) => MaybePromise<Response>;
  parseRequest?: (request: Request, ...args: TArgs) => MaybePromise<TInput>;
  mapError?: (
    error: unknown,
    context: RouteFactoryContext<
      TSession,
      TArgs,
      TInput | undefined,
      TRequireUser
    >
  ) => MaybePromise<Response | undefined>;
  handler: (
    context: RouteFactoryContext<TSession, TArgs, TInput, TRequireUser>
  ) => MaybePromise<Response>;
};

function resolveUnauthorizedResponse<
  TSession,
  TArgs extends unknown[],
  TInput,
  TRequireUser extends boolean,
>(
  options: RouteFactoryOptions<TSession, TArgs, TInput, TRequireUser>,
  request: Request,
  args: TArgs
): Promise<Response> {
  if (options.unauthorizedResponse) {
    return Promise.resolve(options.unauthorizedResponse(request, ...args));
  }

  const errorCode = options.unauthorizedErrorCode ?? "unauthorized:api";
  return Promise.resolve(new OpenChatError(errorCode).toResponse());
}

function userFromSession(session: unknown): SessionUserLike | null {
  if (!session || typeof session !== "object") {
    return null;
  }

  const sessionLike = session as Exclude<SessionLike, null>;
  const user = sessionLike.user;
  if (!user || typeof user !== "object") {
    return null;
  }

  return user;
}

export function createApiRoute<
  TSession = SessionLike,
  TArgs extends unknown[] = [],
  TInput = unknown,
  TRequireUser extends boolean = false,
>(options: RouteFactoryOptions<TSession, TArgs, TInput, TRequireUser>) {
  return withRouteLogging<TArgs>(
    {
      route: options.route,
      method: options.method,
      audit: options.audit,
    },
    async (request: Request, ...args: TArgs): Promise<Response> => {
      const session = options.getSession
        ? ((await options.getSession()) as TSession | null)
        : null;
      const user = userFromSession(session);

      if (options.requireUser && !user?.id) {
        return resolveUnauthorizedResponse(options, request, args);
      }

      if (user?.id) {
        setRequestActor({
          userId: user.id,
          userType: user.type ?? undefined,
        });
      }

      let input: TInput | undefined;

      if (options.parseRequest) {
        try {
          input = await options.parseRequest(request, ...args);
        } catch (error) {
          if (error instanceof OpenChatError) {
            return error.toResponse();
          }
          const errorCode = options.badRequestErrorCode ?? "bad_request:api";
          return new OpenChatError(errorCode).toResponse();
        }
      }

      const context: RouteFactoryContext<
        TSession,
        TArgs,
        TInput | undefined,
        TRequireUser
      > = {
        request,
        args,
        session: (options.requireUser
          ? (session as TSession)
          : session) as RouteFactoryContext<
          TSession,
          TArgs,
          TInput | undefined,
          TRequireUser
        >["session"],
        input,
      };

      try {
        return await options.handler(
          context as RouteFactoryContext<TSession, TArgs, TInput, TRequireUser>
        );
      } catch (error) {
        if (options.mapError) {
          const mappedResponse = await options.mapError(error, context);
          if (mappedResponse) {
            return mappedResponse;
          }
        }

        if (error instanceof OpenChatError) {
          return error.toResponse();
        }

        throw error;
      }
    }
  );
}
