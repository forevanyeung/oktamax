/**
 * Keeps a copy of an in-flight UI message stream (SSE text) so a client that
 * reloads – e.g. the admin navigated to another page – can replay it from the
 * start and then follow it live.
 *
 * In-memory: fine for one server instance. With several instances, swap this for
 * the `resumable-stream` package (Redis) – the route code doesn't change.
 */
export class StreamBuffer {
  private chunks: string[] = [];
  private done = false;
  private listeners = new Set<() => void>();

  constructor(
    source: ReadableStream<string>,
    /** Stops the model run (the "Stop" button), independent of any client connection. */
    readonly abort: AbortController,
  ) {
    void this.pump(source);
  }

  private async pump(source: ReadableStream<string>) {
    try {
      for await (const chunk of source) {
        this.chunks.push(chunk);
        this.notify();
      }
    } finally {
      this.done = true;
      this.notify();
    }
  }

  private notify() {
    this.listeners.forEach((listener) => listener());
  }

  get finished() {
    return this.done;
  }

  /** Everything so far, then new chunks as they arrive, until the run ends. */
  replay(): ReadableStream<string> {
    let sent = 0;
    let listener: (() => void) | undefined;
    return new ReadableStream<string>({
      start: (controller) => {
        listener = () => {
          while (sent < this.chunks.length) controller.enqueue(this.chunks[sent++]!);
          if (this.done) {
            this.listeners.delete(listener!);
            controller.close();
          }
        };
        this.listeners.add(listener);
        listener();
      },
      cancel: () => {
        if (listener) this.listeners.delete(listener);
      },
    });
  }
}
