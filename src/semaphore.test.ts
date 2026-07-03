import { Semaphore } from './semaphore';

describe('Semaphore', () => {
  it('should allow up to maxConcurrency concurrent acquisitions', async () => {
    const sem = new Semaphore(3);
    const acquired: number[] = [];

    // Acquire 3 slots immediately
    await sem.acquire(); acquired.push(1);
    await sem.acquire(); acquired.push(2);
    await sem.acquire(); acquired.push(3);

    expect(acquired).toEqual([1, 2, 3]);
  });

  it('should block when maxConcurrency is reached', async () => {
    const sem = new Semaphore(1);
    let secondAcquired = false;

    await sem.acquire();

    // This should block
    const secondPromise = sem.acquire().then(() => {
      secondAcquired = true;
    });

    // Give it a tick
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(secondAcquired).toBe(false);

    // Release should unblock
    sem.release();
    await secondPromise;
    expect(secondAcquired).toBe(true);
  });

  it('should process queue in order', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    await sem.acquire();

    const p1 = sem.acquire().then(() => { order.push(1); sem.release(); });
    const p2 = sem.acquire().then(() => { order.push(2); sem.release(); });
    const p3 = sem.acquire().then(() => { order.push(3); sem.release(); });

    sem.release(); // releases first queued
    await Promise.all([p1, p2, p3]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('should handle release without pending acquisitions', () => {
    const sem = new Semaphore(2);
    // Should not throw
    expect(() => sem.release()).not.toThrow();
  });
});
