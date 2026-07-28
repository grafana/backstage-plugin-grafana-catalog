import { Semaphore } from './semaphore';

// A promise with an externally controlled settle time, so tests can hold tasks
// open and decide exactly when they finish.
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

describe('Semaphore', () => {
  it('rejects a nonsensical limit', () => {
    expect(() => new Semaphore(0)).toThrow(/positive integer/);
    expect(() => new Semaphore(-1)).toThrow(/positive integer/);
    expect(() => new Semaphore(1.5)).toThrow(/positive integer/);
  });

  it('holds the slot until the task settles, not until it starts', async () => {
    const sem = new Semaphore(1);
    const first = deferred();
    let secondStarted = false;

    const firstRun = sem.run(() => first.promise);
    const secondRun = sem.run(async () => {
      secondStarted = true;
    });

    // The first task is still pending, so the second must not have begun. This
    // is the case that breaks if the slot is freed when the task's promise is
    // created rather than when it settles.
    await tick();
    expect(secondStarted).toBe(false);

    first.resolve();
    await Promise.all([firstRun, secondRun]);
    expect(secondStarted).toBe(true);
  });

  it('never runs more than maxConcurrency tasks at once', async () => {
    const sem = new Semaphore(3);
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 30 }, () =>
        sem.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await tick();
          active--;
        }),
      ),
    );

    expect(peak).toBe(3);
    expect(active).toBe(0);
  });

  it('lets waiting tasks through in the order they arrived', async () => {
    const sem = new Semaphore(1);
    const blocker = deferred();
    const order: number[] = [];

    const runs = [
      sem.run(() => blocker.promise),
      ...[1, 2, 3, 4].map(n =>
        sem.run(async () => {
          order.push(n);
        }),
      ),
    ];

    blocker.resolve();
    await Promise.all(runs);

    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('frees the slot when a task rejects', async () => {
    const sem = new Semaphore(1);

    await expect(
      sem.run(() => Promise.reject(new Error('task blew up'))),
    ).rejects.toThrow('task blew up');

    // A leaked slot would leave the semaphore permanently full
    await expect(sem.run(async () => 'still works')).resolves.toBe(
      'still works',
    );
  });

  it('frees the slot when a task throws synchronously', async () => {
    const sem = new Semaphore(1);

    await expect(
      sem.run(() => {
        throw new Error('threw before returning');
      }),
    ).rejects.toThrow('threw before returning');

    await expect(sem.run(async () => 'still works')).resolves.toBe(
      'still works',
    );
  });

  it('passes the task result through', async () => {
    const sem = new Semaphore(2);

    await expect(sem.run(async () => 42)).resolves.toBe(42);
  });

  it('keeps its limit across successive batches', async () => {
    const sem = new Semaphore(2);
    let peak = 0;
    let active = 0;

    const batch = () =>
      Promise.all(
        Array.from({ length: 5 }, () =>
          sem.run(async () => {
            active++;
            peak = Math.max(peak, active);
            await tick();
            active--;
          }),
        ),
      );

    await batch();
    await batch();

    expect(peak).toBe(2);
    expect(active).toBe(0);
  });
});
