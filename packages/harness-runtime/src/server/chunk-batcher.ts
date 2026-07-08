export const DEFAULT_BATCH_MAX_BYTES = 4096;
export const DEFAULT_BATCH_FLUSH_MS = 250;

/**
 * Coalesces a stream of text pushes into batched flushes to cap telemetry event
 * volume from noisy commands (e.g. a full test suite) while staying visibly live.
 * Flushes when buffered bytes reach `maxBytes` or on the `flushIntervalMs` timer.
 */
export class ChunkBatcher {
  private buffer = "";
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly onFlush: (text: string) => void,
    private readonly options: {
      maxBytes?: number;
      flushIntervalMs?: number;
    } = {},
  ) {
    const intervalMs = options.flushIntervalMs ?? DEFAULT_BATCH_FLUSH_MS;
    this.timer = setInterval(() => { this.flush(); }, intervalMs);
  }

  push(text: string): void {
    if (!text) return;
    this.buffer += text;
    const maxBytes = this.options.maxBytes ?? DEFAULT_BATCH_MAX_BYTES;
    if (Buffer.byteLength(this.buffer, "utf-8") >= maxBytes) {
      this.flush();
    }
  }

  flush(): void {
    if (!this.buffer) return;
    const text = this.buffer;
    this.buffer = "";
    this.onFlush(text);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
