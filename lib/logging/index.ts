import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import pino, { type Logger } from "pino";

type RequestActor = {
  userId?: string;
  userType?: string;
};

type RequestContext = RequestActor & {
  requestId: string;
  route: string;
  method: string;
  ip: string | null;
  userAgent: string | null;
};

type MaybePromise<T> = Promise<T> | T;

type AuditDescriptor<TArgs extends unknown[]> = {
  action: string;
  resourceType: string;
  getResourceId?: (
    requestForAudit: Request,
    ...args: TArgs
  ) => MaybePromise<string | undefined>;
  getMetadata?: (
    requestForAudit: Request,
    ...args: TArgs
  ) => MaybePromise<Record<string, unknown> | undefined>;
};

type RouteLoggingOptions<TArgs extends unknown[]> = {
  route: string;
  method?: string;
  audit?: AuditDescriptor<TArgs>;
};

type RouteHandler<TArgs extends unknown[] = []> = (
  request: Request,
  ...args: TArgs
) => Promise<Response>;

type AuditLogEntryInput = {
  action: string;
  resourceType: string;
  resourceId?: string;
  outcome: "success" | "failure";
  statusCode?: number;
  reason?: string;
  errorCode?: string;
  metadata?: Record<string, unknown>;
  actorId?: string;
  actorType?: string;
};

type LoggingConfig = {
  logDir: string;
  appLogFile: string;
  auditLogFile: string;
  logRetentionDays: number;
  level: string;
  syncDestination: boolean;
  logHttpHeaders: boolean;
  logHttpRequestBody: boolean;
  logHttpResponseBody: boolean;
  logHttpMaxBodyBytes: number;
};

type LoggerState = {
  appLogger: Logger;
  auditLogger: Logger;
  appDestination: pino.DestinationStream;
  auditDestination: pino.DestinationStream;
  dateKey: string;
  logDir: string;
  logRetentionDays: number;
};

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

let configOverride: Partial<LoggingConfig> = {};
let loggerState: LoggerState | null = null;

const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|authorization|cookie|content|text|prompt)/i;

function getConfig(): LoggingConfig {
  const isProduction = process.env.NODE_ENV === "production";
  const maxBodyFromEnv = Number.parseInt(
    process.env.LOG_HTTP_MAX_BODY_BYTES ?? "",
    10
  );
  const retentionDaysFromEnv = Number.parseInt(
    process.env.LOG_RETENTION_DAYS ?? "",
    10
  );
  const rawLogDir = configOverride.logDir ?? process.env.LOG_DIR ?? "logs";
  const logDir = isAbsolute(rawLogDir)
    ? rawLogDir
    : join(process.cwd(), rawLogDir);

  return {
    logDir,
    appLogFile:
      configOverride.appLogFile ?? process.env.APP_LOG_FILE ?? "app.log",
    auditLogFile:
      configOverride.auditLogFile ?? process.env.AUDIT_LOG_FILE ?? "audit.log",
    logRetentionDays:
      configOverride.logRetentionDays ??
      (Number.isInteger(retentionDaysFromEnv) && retentionDaysFromEnv > 0
        ? retentionDaysFromEnv
        : 30),
    level: configOverride.level ?? process.env.LOG_LEVEL ?? "info",
    syncDestination:
      configOverride.syncDestination ?? process.env.LOG_SYNC === "true",
    logHttpHeaders:
      configOverride.logHttpHeaders ?? process.env.LOG_HTTP_HEADERS !== "false",
    logHttpRequestBody:
      configOverride.logHttpRequestBody ??
      (process.env.LOG_HTTP_REQUEST_BODY
        ? process.env.LOG_HTTP_REQUEST_BODY === "true"
        : !isProduction),
    logHttpResponseBody:
      configOverride.logHttpResponseBody ??
      (process.env.LOG_HTTP_RESPONSE_BODY
        ? process.env.LOG_HTTP_RESPONSE_BODY === "true"
        : !isProduction),
    logHttpMaxBodyBytes:
      configOverride.logHttpMaxBodyBytes ??
      (Number.isInteger(maxBodyFromEnv) && maxBodyFromEnv > 0
        ? maxBodyFromEnv
        : 4096),
  };
}

function getLocalDateKey(date = new Date()): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLocalDateKeyDaysAgo(daysAgo: number, now = new Date()): string {
  const candidate = new Date(now);
  candidate.setDate(candidate.getDate() - daysAgo);
  return getLocalDateKey(candidate);
}

function resolveDailyLogPath(
  logDir: string,
  channel: "app" | "audit",
  dateKey: string
): string {
  return join(logDir, channel, `${dateKey}.log`);
}

function isDailyLogFileName(fileName: string): boolean {
  return /^\d{4}-\d{2}-\d{2}\.log$/.test(fileName);
}

function cleanupExpiredDailyLogs(
  logDir: string,
  retentionDays: number,
  now = new Date()
): {
  deletedCount: number;
  failedCount: number;
  lastError?: unknown;
} {
  if (retentionDays <= 0) {
    return { deletedCount: 0, failedCount: 0 };
  }

  const cutoffDateKey = getLocalDateKeyDaysAgo(retentionDays - 1, now);
  let deletedCount = 0;
  let failedCount = 0;
  let lastError: unknown;

  for (const channel of ["app", "audit"] as const) {
    const channelDir = join(logDir, channel);
    let entries: string[] = [];

    try {
      entries = readdirSync(channelDir);
    } catch (error) {
      const errorWithCode = error as { code?: string };
      if (errorWithCode.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!isDailyLogFileName(entry)) {
        continue;
      }

      const fileDateKey = entry.slice(0, 10);
      if (fileDateKey >= cutoffDateKey) {
        continue;
      }

      try {
        unlinkSync(join(channelDir, entry));
        deletedCount += 1;
      } catch (error) {
        failedCount += 1;
        lastError = error;
      }
    }
  }

  return { deletedCount, failedCount, lastError };
}

function createDestination(
  destination: string | number,
  syncDestination: boolean
) {
  if (typeof destination === "number") {
    return pino.destination({
      dest: destination,
      sync: syncDestination,
    });
  }

  return pino.destination({
    dest: destination,
    mkdir: true,
    sync: syncDestination,
  });
}

function closeDestination(destination: pino.DestinationStream): void {
  if (
    "flushSync" in destination &&
    typeof destination.flushSync === "function"
  ) {
    destination.flushSync();
  }
  if ("end" in destination && typeof destination.end === "function") {
    destination.end();
  }
}

function resetLoggers(): void {
  if (!loggerState) {
    return;
  }

  closeDestination(loggerState.appDestination);
  closeDestination(loggerState.auditDestination);
  loggerState = null;
}

function getLoggerState(): LoggerState {
  const config = getConfig();
  const now = new Date();
  const dateKey = getLocalDateKey(now);

  if (
    loggerState &&
    loggerState.dateKey === dateKey &&
    loggerState.logDir === config.logDir &&
    loggerState.logRetentionDays === config.logRetentionDays
  ) {
    return loggerState;
  }

  if (loggerState) {
    resetLoggers();
  }

  let appDestination: pino.DestinationStream | null = null;
  let auditDestination: pino.DestinationStream | null = null;
  let destinationError: unknown;
  const appLogPath = resolveDailyLogPath(config.logDir, "app", dateKey);
  const auditLogPath = resolveDailyLogPath(config.logDir, "audit", dateKey);

  try {
    mkdirSync(config.logDir, { recursive: true });
    mkdirSync(join(config.logDir, "app"), { recursive: true });
    mkdirSync(join(config.logDir, "audit"), { recursive: true });
    appDestination = createDestination(appLogPath, config.syncDestination);
    auditDestination = createDestination(auditLogPath, config.syncDestination);
  } catch (error) {
    destinationError = error;

    if (appDestination) {
      closeDestination(appDestination);
    }
    if (auditDestination) {
      closeDestination(auditDestination);
    }

    appDestination = createDestination(1, config.syncDestination);
    auditDestination = createDestination(1, config.syncDestination);
  }

  const base = {
    service: "openchat",
    environment: process.env.NODE_ENV ?? "development",
  };

  const loggerOptions = {
    level: config.level,
    timestamp: pino.stdTimeFunctions.isoTime,
  } as const;

  const appLogger = pino(
    {
      ...loggerOptions,
      base: {
        ...base,
        logger: "app",
      },
    },
    appDestination
  );

  const auditLogger = pino(
    {
      ...loggerOptions,
      base: {
        ...base,
        logger: "audit",
      },
    },
    auditDestination
  );

  loggerState = {
    appLogger,
    auditLogger,
    appDestination,
    auditDestination,
    dateKey,
    logDir: config.logDir,
    logRetentionDays: config.logRetentionDays,
  };

  if (destinationError) {
    loggerState.appLogger.warn(
      {
        event: "logger.destination.fallback",
        dateKey,
        logDir: config.logDir,
        appLogPath,
        auditLogPath,
        appLogFile: config.appLogFile,
        auditLogFile: config.auditLogFile,
        error: normalizeError(destinationError),
      },
      "logger destination fallback to stdout"
    );
    return loggerState;
  }

  try {
    const cleanupResult = cleanupExpiredDailyLogs(
      config.logDir,
      config.logRetentionDays,
      now
    );

    if (cleanupResult.failedCount > 0) {
      loggerState.appLogger.warn(
        {
          event: "logger.retention.cleanup_failed",
          logDir: config.logDir,
          retentionDays: config.logRetentionDays,
          failedCount: cleanupResult.failedCount,
          deletedCount: cleanupResult.deletedCount,
          error: normalizeError(cleanupResult.lastError),
        },
        "logger retention cleanup failed for some files"
      );
    } else if (cleanupResult.deletedCount > 0) {
      loggerState.appLogger.info(
        {
          event: "logger.retention.cleanup",
          logDir: config.logDir,
          retentionDays: config.logRetentionDays,
          deletedCount: cleanupResult.deletedCount,
        },
        "logger retention cleanup completed"
      );
    }
  } catch (error) {
    loggerState.appLogger.warn(
      {
        event: "logger.retention.cleanup_error",
        logDir: config.logDir,
        retentionDays: config.logRetentionDays,
        error: normalizeError(error),
      },
      "logger retention cleanup failed"
    );
  }

  return loggerState;
}

function requestIp(request: Request): string | null {
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    return xForwardedFor.split(",")[0]?.trim() ?? null;
  }

  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    null
  );
}

const HEADER_WHITELIST = new Set([
  "host",
  "content-type",
  "content-length",
  "accept",
  "accept-language",
  "accept-encoding",
  "user-agent",
  "referer",
  "origin",
  "x-forwarded-for",
  "x-real-ip",
  "x-request-id",
  "x-vercel-id",
]);
const SENSITIVE_HEADER_PATTERN =
  /^(authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i;

function sanitizeUnknownValue(key: string, value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return { truncated: true };
  }

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return sanitizeString(key, value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeUnknownValue(key, item, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(value as Record<string, unknown>).slice(
      0,
      50
    );

    for (const [entryKey, entryValue] of entries) {
      result[entryKey] = sanitizeUnknownValue(entryKey, entryValue, depth + 1);
    }

    return result;
  }

  return String(value);
}

function sanitizeAuditMetadata(
  input: Record<string, unknown> | undefined
): Record<string, unknown> | null {
  if (!input) {
    return null;
  }

  const sanitized = sanitizeUnknownValue("metadata", input);
  if (sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)) {
    return sanitized as Record<string, unknown>;
  }

  return {
    value: sanitized,
  };
}

function sanitizeHeaders(headers: Headers): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};

  for (const [name, value] of headers.entries()) {
    const key = name.toLowerCase();
    if (!HEADER_WHITELIST.has(key)) {
      continue;
    }
    if (SENSITIVE_HEADER_PATTERN.test(key)) {
      result[key] = {
        redacted: true,
        length: value.length,
        sha256: hashForLog(value),
      };
      continue;
    }

    if (value.length > 256) {
      result[key] = {
        truncated: true,
        length: value.length,
        sha256: hashForLog(value),
      };
      continue;
    }

    result[key] = value;
  }

  return Object.keys(result).length > 0 ? result : null;
}

function bodySummaryFromText(
  text: string,
  contentType: string | null,
  maxBytes: number
): unknown {
  const normalizedType = (contentType ?? "").toLowerCase();
  const size = Buffer.byteLength(text, "utf8");

  if (size > maxBytes) {
    return {
      truncated: true,
      length: size,
      sha256: hashForLog(text),
    };
  }

  if (normalizedType.includes("application/json")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      return sanitizeUnknownValue("body", parsed);
    } catch (_) {
      return {
        invalidJson: true,
        value: sanitizeUnknownValue("body", text),
      };
    }
  }

  if (normalizedType.includes("application/x-www-form-urlencoded")) {
    const data = Object.fromEntries(new URLSearchParams(text));
    return sanitizeUnknownValue("body", data);
  }

  if (
    normalizedType.startsWith("text/") ||
    normalizedType.includes("application/xml")
  ) {
    return sanitizeUnknownValue("body", text);
  }

  return {
    length: size,
    sha256: hashForLog(text),
  };
}

async function getRequestBodySummary(
  request: Request,
  config: LoggingConfig
): Promise<unknown> {
  if (!config.logHttpRequestBody) {
    return undefined;
  }

  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const contentType = request.headers.get("content-type");
  if ((contentType ?? "").toLowerCase().includes("multipart/form-data")) {
    return {
      omitted: "multipart_form_data",
    };
  }

  try {
    const text = await request.text();
    if (!text) {
      return undefined;
    }
    return bodySummaryFromText(text, contentType, config.logHttpMaxBodyBytes);
  } catch (error) {
    return {
      unavailable: true,
      error: normalizeError(error),
    };
  }
}

async function getResponseBodySummary(
  response: Response,
  config: LoggingConfig
): Promise<unknown> {
  if (!config.logHttpResponseBody) {
    return undefined;
  }

  const contentType = response.headers.get("content-type");
  const normalizedType = (contentType ?? "").toLowerCase();

  if (normalizedType.includes("text/event-stream")) {
    return {
      omitted: "event_stream",
    };
  }

  try {
    const cloned = response.clone();
    const text = await cloned.text();

    if (!text) {
      return undefined;
    }

    return bodySummaryFromText(text, contentType, config.logHttpMaxBodyBytes);
  } catch (error) {
    return {
      unavailable: true,
      error: normalizeError(error),
    };
  }
}

async function getRequestLogDetails(
  request: Request,
  requestForBody: Request | null,
  config: LoggingConfig
): Promise<Record<string, unknown>> {
  const details: Record<string, unknown> = {
    path: (() => {
      try {
        return new URL(request.url).pathname;
      } catch (_) {
        return null;
      }
    })(),
    query: (() => {
      try {
        return Object.fromEntries(new URL(request.url).searchParams.entries());
      } catch (_) {
        return {};
      }
    })(),
  };

  if (config.logHttpHeaders) {
    details.headers = sanitizeHeaders(request.headers);
  }

  if (requestForBody) {
    const body = await getRequestBodySummary(requestForBody, config);
    if (body !== undefined) {
      details.body = body;
    }
  }

  return details;
}

async function getResponseLogDetails(
  response: Response,
  config: LoggingConfig
): Promise<Record<string, unknown>> {
  const details: Record<string, unknown> = {
    contentType: response.headers.get("content-type"),
    contentLength: response.headers.get("content-length"),
  };

  if (config.logHttpHeaders) {
    details.headers = sanitizeHeaders(response.headers);
  }

  const body = await getResponseBodySummary(response, config);
  if (body !== undefined) {
    details.body = body;
  }

  return details;
}

function resolveRoute(request: Request, configuredRoute: string): string {
  try {
    const pathname = new URL(request.url).pathname;
    return configuredRoute || pathname;
  } catch (_) {
    return configuredRoute;
  }
}

function attachRequestIdHeader(
  response: Response,
  requestId: string
): Response {
  if (response.headers.get("x-request-id")) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function sanitizeString(
  key: string,
  value: string
): string | Record<string, unknown> {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return {
      redacted: true,
      length: value.length,
      sha256: hashForLog(value),
    };
  }

  if (value.length > 256) {
    return {
      truncated: true,
      length: value.length,
      sha256: hashForLog(value),
    };
  }

  return value;
}

function statusToOutcome(statusCode: number): "success" | "failure" {
  return statusCode >= 200 && statusCode < 400 ? "success" : "failure";
}

function shouldResolveAuditDetails(statusCode: number): boolean {
  return statusCode !== 401 && statusCode !== 403;
}

function normalizeError(error: unknown): { message: string; code?: string } {
  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: string };
    return {
      message: error.message,
      code: errorWithCode.code,
    };
  }

  return {
    message: "Unknown error",
  };
}

function isRedirectControlFlow(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.message === "NEXT_REDIRECT") {
    return true;
  }

  const redirectError = error as Error & { digest?: unknown };
  return (
    typeof redirectError.digest === "string" &&
    redirectError.digest.startsWith("NEXT_REDIRECT;")
  );
}

function getRedirectStatusCode(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const redirectError = error as Error & { digest?: unknown };
  if (typeof redirectError.digest !== "string") {
    return undefined;
  }

  const parts = redirectError.digest.split(";").reverse();

  for (const part of parts) {
    const value = Number.parseInt(part, 10);
    if (Number.isInteger(value) && value >= 300 && value < 400) {
      return value;
    }
  }

  return undefined;
}

async function resolveAuditDetails<TArgs extends unknown[]>(
  descriptor: AuditDescriptor<TArgs> | undefined,
  requestForAudit: Request,
  args: TArgs
): Promise<{ resourceId?: string; metadata?: Record<string, unknown> }> {
  if (!descriptor) {
    return {};
  }

  try {
    const resourceRequest = descriptor.getResourceId
      ? requestForAudit.clone()
      : requestForAudit;
    const metadataRequest = descriptor.getMetadata
      ? requestForAudit.clone()
      : requestForAudit;

    const [resourceId, metadata] = await Promise.all([
      descriptor.getResourceId?.(resourceRequest, ...args),
      descriptor.getMetadata?.(metadataRequest, ...args),
    ]);

    return {
      resourceId,
      metadata,
    };
  } catch (error) {
    getAppLogger().warn(
      {
        event: "audit.descriptor_failed",
        error: normalizeError(error),
      },
      "audit descriptor resolution failed"
    );
    return {};
  }
}

function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => Promise<T>
): Promise<T> {
  return requestContextStorage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function setRequestActor(actor: RequestActor): void {
  const context = requestContextStorage.getStore();
  if (!context) {
    return;
  }

  if (actor.userId) {
    context.userId = actor.userId;
  }
  if (actor.userType) {
    context.userType = actor.userType;
  }
}

export function getAppLogger(): Logger {
  return getLoggerState().appLogger;
}

export function getAuditLogger(): Logger {
  return getLoggerState().auditLogger;
}

export function hashForLog(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function writeAuditLog(input: AuditLogEntryInput): void {
  const context = requestContextStorage.getStore();
  const logger = getAuditLogger();

  logger.info(
    {
      event: "audit.event",
      auditId: randomUUID(),
      requestId: context?.requestId ?? randomUUID(),
      route: context?.route ?? null,
      method: context?.method ?? null,
      ip: context?.ip ?? null,
      actorId: input.actorId ?? context?.userId ?? null,
      actorType: input.actorType ?? context?.userType ?? null,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      outcome: input.outcome,
      statusCode: input.statusCode ?? null,
      reason: input.reason ?? null,
      errorCode: input.errorCode ?? null,
      metadata: sanitizeAuditMetadata(input.metadata),
    },
    "audit.event"
  );
}

export function withRouteLogging<TArgs extends unknown[]>(
  options: RouteLoggingOptions<TArgs>,
  handler: RouteHandler<TArgs>
): RouteHandler<TArgs> {
  return (request: Request, ...args: TArgs): Promise<Response> => {
    const config = getConfig();
    const startedAt = Date.now();
    const method = options.method ?? request.method;
    const route = resolveRoute(request, options.route);
    const requestId = request.headers.get("x-request-id") ?? randomUUID();
    const ip = requestIp(request);
    const userAgent = request.headers.get("user-agent");

    const requestForAudit = options.audit ? request.clone() : request;
    const requestForDetails = config.logHttpRequestBody
      ? request.clone()
      : null;

    return runWithRequestContext(
      {
        requestId,
        route,
        method,
        ip,
        userAgent,
      },
      async () => {
        const requestDetails = await getRequestLogDetails(
          request,
          requestForDetails,
          config
        );

        getAppLogger().info(
          {
            event: "http.request.start",
            requestId,
            route,
            method,
            ip,
            userAgent,
            request: requestDetails,
          },
          "http.request.start"
        );

        try {
          const response = await handler(request, ...args);
          const statusCode = response.status;
          const durationMs = Date.now() - startedAt;
          const responseDetails = await getResponseLogDetails(response, config);

          getAppLogger().info(
            {
              event: "http.request.complete",
              requestId,
              route,
              method,
              statusCode,
              durationMs,
              response: responseDetails,
            },
            "http.request.complete"
          );

          if (options.audit) {
            const details = shouldResolveAuditDetails(statusCode)
              ? await resolveAuditDetails(options.audit, requestForAudit, args)
              : {};
            writeAuditLog({
              action: options.audit.action,
              resourceType: options.audit.resourceType,
              resourceId: details.resourceId,
              outcome: statusToOutcome(statusCode),
              statusCode,
              metadata: details.metadata,
            });
          }

          return attachRequestIdHeader(response, requestId);
        } catch (error) {
          const durationMs = Date.now() - startedAt;

          if (isRedirectControlFlow(error)) {
            const statusCode = getRedirectStatusCode(error) ?? 303;

            getAppLogger().info(
              {
                event: "http.request.redirect",
                requestId,
                route,
                method,
                statusCode,
                durationMs,
                response: {
                  redirected: true,
                },
              },
              "http.request.redirect"
            );

            if (options.audit) {
              const details = shouldResolveAuditDetails(statusCode)
                ? await resolveAuditDetails(
                    options.audit,
                    requestForAudit,
                    args
                  )
                : {};
              writeAuditLog({
                action: options.audit.action,
                resourceType: options.audit.resourceType,
                resourceId: details.resourceId,
                outcome: "success",
                statusCode,
                metadata: details.metadata,
              });
            }

            throw error;
          }

          const normalized = normalizeError(error);

          getAppLogger().error(
            {
              event: "http.request.error",
              requestId,
              route,
              method,
              durationMs,
              error: normalized,
            },
            "http.request.error"
          );

          if (options.audit) {
            const details = await resolveAuditDetails(
              options.audit,
              requestForAudit,
              args
            );
            writeAuditLog({
              action: options.audit.action,
              resourceType: options.audit.resourceType,
              resourceId: details.resourceId,
              outcome: "failure",
              statusCode: 500,
              reason: normalized.message,
              errorCode: normalized.code,
              metadata: details.metadata,
            });
          }

          throw error;
        }
      }
    );
  };
}

export async function flushLoggersForTests(): Promise<void> {
  const state = getLoggerState();

  if (
    "flushSync" in state.appDestination &&
    typeof state.appDestination.flushSync === "function"
  ) {
    state.appDestination.flushSync();
  }
  if (
    "flushSync" in state.auditDestination &&
    typeof state.auditDestination.flushSync === "function"
  ) {
    state.auditDestination.flushSync();
  }

  await Promise.resolve();
}

export function configureLoggingForTests(
  override: Partial<LoggingConfig>
): void {
  configOverride = {
    ...configOverride,
    ...override,
    syncDestination: true,
  };
  resetLoggers();
}
