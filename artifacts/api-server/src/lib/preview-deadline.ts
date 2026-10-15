/** A preview never persists data, so it is safe to stop waiting at the deadline. */
export const PREVIEW_TIMEOUT_MS = 70_000;
export const PREVIEW_TIMEOUT_MESSAGE =
  "Zeitüberschreitung beim Auslesen. Bitte diese Datei erneut auslesen.";

export function previewDeadline(parent?: AbortSignal, timeoutMs = PREVIEW_TIMEOUT_MS) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(() => controller.abort(new Error(PREVIEW_TIMEOUT_MESSAGE)), timeoutMs);
  return {
    signal: controller.signal,
    async run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
      controller.signal.throwIfAborted();
      let onAbort: () => void = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(controller.signal.reason);
        controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        return await Promise.race([cancelled, operation(controller.signal)]);
      } finally {
        controller.signal.removeEventListener("abort", onAbort);
      }
    },
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}
