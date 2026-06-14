export class AsyncQueue {
  private tail: Promise<void> = Promise.resolve();

  get idle(): Promise<void> {
    return this.tail;
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }
}

export class KeyedAsyncQueue<Key> {
  private readonly queues = new Map<Key, AsyncQueue>();

  enqueue<T>(key: Key, task: () => Promise<T>): Promise<T> {
    const queue = this.getQueue(key);
    const result = queue.enqueue(task);
    const idleAfterTask = queue.idle;

    idleAfterTask.then(() => {
      if (this.queues.get(key) === queue && queue.idle === idleAfterTask) {
        this.queues.delete(key);
      }
    });

    return result;
  }

  private getQueue(key: Key): AsyncQueue {
    const existingQueue = this.queues.get(key);
    if (existingQueue) {
      return existingQueue;
    }

    const queue = new AsyncQueue();
    this.queues.set(key, queue);
    return queue;
  }
}
