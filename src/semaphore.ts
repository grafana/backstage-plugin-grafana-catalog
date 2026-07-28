/**
 * Semaphore bounds how many tasks may run at the same time. Tasks beyond the
 * limit wait for a slot, in the order they asked for one.
 *
 * run() is the only way in. Acquiring and releasing are private because
 * pairing them by hand is easy to get wrong: in an async function,
 *
 *   try { return somePromise } finally { release() }
 *
 * releases the slot as soon as somePromise is *created*, not when it settles,
 * which silently removes all throttling.
 */
export class Semaphore {
  // Resolvers for callers waiting on a slot, oldest first
  private readonly waiting: Array<() => void> = [];
  // Number of slots currently held
  private inFlight: number = 0;

  constructor(private readonly maxConcurrency: number) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error(
        `Semaphore: maxConcurrency must be a positive integer, got ${maxConcurrency}`,
      );
    }
  }

  /**
   * run waits for a free slot, runs the task, and frees the slot once the task
   * settles, whether it resolves or rejects.
   * @param task - The work to run while holding a slot
   * @returns - Whatever the task resolves to
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      // `return await` is load-bearing. A bare `return` would run the finally
      // block as soon as the task's promise is created.
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.inFlight < this.maxConcurrency) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.waiting.push(resolve);
    });
  }

  private release(): void {
    // Hand the slot directly to the next waiter instead of decrementing and
    // letting it re-acquire, so inFlight never dips and no waiter is skipped.
    const next = this.waiting.shift();
    if (next) {
      next();
      return;
    }
    this.inFlight--;
  }
}
