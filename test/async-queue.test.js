import assert from "node:assert/strict";
import test from "node:test";

import { KeyedAsyncQueue } from "../dist/utils/async-queue.js";

test("KeyedAsyncQueue serializes tasks for the same key", async () => {
  const queue = new KeyedAsyncQueue();
  const events = [];
  let releaseFirst = () => undefined;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = queue.enqueue("chat-a", async () => {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
    return 1;
  });

  const second = queue.enqueue("chat-a", async () => {
    events.push("second:start");
    return 2;
  });

  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);

  releaseFirst();

  assert.equal(await first, 1);
  assert.equal(await second, 2);
  assert.deepEqual(events, ["first:start", "first:end", "second:start"]);
});

test("KeyedAsyncQueue continues after a task fails", async () => {
  const queue = new KeyedAsyncQueue();

  await assert.rejects(
    queue.enqueue("chat-a", async () => {
      throw new Error("boom");
    }),
    /boom/,
  );

  assert.equal(
    await queue.enqueue("chat-a", async () => "ok"),
    "ok",
  );
});
