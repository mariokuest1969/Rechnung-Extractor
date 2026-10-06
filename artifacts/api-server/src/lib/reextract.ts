export class ReextractTimeoutError extends Error {
  constructor() {
    super("Zeitlimit für die Neu-Extraktion überschritten");
    this.name = "ReextractTimeoutError";
  }
}

export function getReextractErrorHttpStatus(
  error: unknown,
  isDatabaseTimeout: (error: unknown) => boolean
): 500 | 504 {
  return error instanceof ReextractTimeoutError || isDatabaseTimeout(error)
    ? 504
    : 500;
}

export async function withReextractTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new ReextractTimeoutError());
      }, timeoutMs);
    });
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function keepExistingPositionsWhenExtractionIsEmpty<T>(
  extracted: T[],
  existing: T[] | null | undefined
): T[] {
  return extracted.length > 0 ? extracted : (existing ?? []);
}