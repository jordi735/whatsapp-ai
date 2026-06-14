export function getDisconnectStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("output" in error)) {
    return undefined;
  }

  const output = (error as { output?: { statusCode?: number } }).output;
  return output?.statusCode;
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
