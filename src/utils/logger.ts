export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

export type AppLogger = ReturnType<typeof createLogger>;

export function parseLogLevel(value: string | undefined): LogLevel {
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error" ||
    value === "silent"
  ) {
    return value;
  }

  return "info";
}

export function createLogger(scope: string, level: LogLevel): {
  debug: (message: string, context?: unknown) => void;
  info: (message: string, context?: unknown) => void;
  warn: (message: string, context?: unknown) => void;
  error: (message: string, context?: unknown) => void;
} {
  return {
    debug: (message, context) => log(scope, level, "debug", message, context),
    info: (message, context) => log(scope, level, "info", message, context),
    warn: (message, context) => log(scope, level, "warn", message, context),
    error: (message, context) => log(scope, level, "error", message, context),
  };
}

function log(
  scope: string,
  configuredLevel: LogLevel,
  messageLevel: Exclude<LogLevel, "silent">,
  message: string,
  context: unknown,
): void {
  if (LOG_LEVEL_PRIORITY[messageLevel] < LOG_LEVEL_PRIORITY[configuredLevel]) {
    return;
  }

  const prefixedMessage = `[${scope}] ${message}`;
  if (context === undefined) {
    console[messageLevel](prefixedMessage);
    return;
  }

  console[messageLevel](prefixedMessage, context);
}
