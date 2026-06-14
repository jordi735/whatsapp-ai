import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MemoryService } from "../dist/services/memory-service.js";

const emptyMemoryJson = `{
  "version": 2,
  "chats": {}
}
`;

test("init creates a missing memory file", async (t) => {
  const { memoryFile, service } = await createMemoryService(t);

  await service.init();

  assert.equal(await readFile(memoryFile, "utf8"), emptyMemoryJson);
});

test("init resets a memory file with an invalid shape", async (t) => {
  const { memoryFile, service } = await createMemoryService(t);
  await writeFile(memoryFile, "{}\n", "utf8");

  await service.init();

  assert.equal(await readFile(memoryFile, "utf8"), emptyMemoryJson);
});

test("init resets legacy flat memory", async (t) => {
  const { memoryFile, service } = await createMemoryService(t);
  await writeFile(
    memoryFile,
    `${JSON.stringify({
      chats: {
        "chat-a": [memoryMessage(1)],
      },
    })}\n`,
    "utf8",
  );

  await service.init();

  assert.equal(await readFile(memoryFile, "utf8"), emptyMemoryJson);
});

test("concurrent appends preserve thread messages across chats", async (t) => {
  const { service } = await createMemoryService(t, 100);
  const messages = Array.from({ length: 30 }, (_, index) => ({
    chatId: index % 2 === 0 ? "chat-a" : "chat-b",
    threadId: index % 2 === 0 ? "thread-a" : "thread-b",
    message: memoryMessage(index),
  }));

  await Promise.all(
    messages.map(({ chatId, threadId, message }) =>
      service.appendThreadMessages(chatId, {
        threadId,
        rootMessageId: threadId,
        messages: [message],
      }),
    ),
  );

  const savedContents = [
    ...(await service.getThreadHistory("chat-a", "thread-a")),
    ...(await service.getThreadHistory("chat-b", "thread-b")),
  ]
    .map(({ content }) => Number(content.replace("message-", "")))
    .sort((left, right) => left - right);

  assert.deepEqual(
    savedContents,
    Array.from({ length: 30 }, (_, index) => index),
  );
});

test("message ids resolve back to their thread", async (t) => {
  const { service } = await createMemoryService(t);

  await service.appendThreadMessages("chat-a", {
    threadId: "thread-a",
    rootMessageId: "user-1",
    messages: [
      memoryMessage(1, {
        id: "user-1",
        parentMessageId: "quoted-0",
        senderJid: "alice@s.whatsapp.net",
        senderName: "Alice",
      }),
      memoryMessage(2, {
        id: "bot-1",
        role: "assistant",
        parentMessageId: "user-1",
      }),
    ],
  });

  assert.equal(await service.getThreadIdForMessage("chat-a", "user-1"), "thread-a");
  assert.equal(await service.getThreadIdForMessage("chat-a", "bot-1"), "thread-a");
  assert.equal(await service.getThreadIdForMessage("chat-a", "missing"), undefined);
  assert.deepEqual(
    (await service.getThreadHistory("chat-a", "thread-a")).map(
      ({ id, role, parentMessageId, senderJid, senderName }) => ({
        id,
        role,
        parentMessageId,
        senderJid,
        senderName,
      }),
    ),
    [
      {
        id: "user-1",
        role: "user",
        parentMessageId: "quoted-0",
        senderJid: "alice@s.whatsapp.net",
        senderName: "Alice",
      },
      {
        id: "bot-1",
        role: "assistant",
        parentMessageId: "user-1",
        senderJid: undefined,
        senderName: undefined,
      },
    ],
  );
});

test("thread pruning removes stale message indexes", async (t) => {
  const { service } = await createMemoryService(t, 3);
  const messages = Array.from({ length: 5 }, (_, index) => memoryMessage(index));

  await service.appendThreadMessages("chat-a", {
    threadId: "thread-a",
    rootMessageId: "message-0",
    messages,
  });

  assert.deepEqual(
    (await service.getThreadHistory("chat-a", "thread-a")).map(({ id }) => id),
    ["message-2", "message-3", "message-4"],
  );
  assert.equal(await service.getThreadIdForMessage("chat-a", "message-0"), undefined);
  assert.equal(await service.getThreadIdForMessage("chat-a", "message-4"), "thread-a");
});

test("a failed queued memory operation does not block later operations", async (t) => {
  const { memoryFile, service } = await createMemoryService(t);
  await writeFile(memoryFile, "{", "utf8");

  await assert.rejects(service.getThreadHistory("chat-a", "thread-a"), SyntaxError);

  await writeFile(memoryFile, emptyMemoryJson, "utf8");
  await service.appendThreadMessages("chat-a", {
    threadId: "thread-a",
    rootMessageId: "message-1",
    messages: [memoryMessage(1)],
  });

  assert.deepEqual(
    (await service.getThreadHistory("chat-a", "thread-a")).map(({ content }) => content),
    ["message-1"],
  );
});

async function createMemoryService(t, memoryLimit = 20) {
  const memoryDir = await mkdtemp(path.join(tmpdir(), "whatsapp-ai-memory-"));
  t.after(async () => {
    await rm(memoryDir, { recursive: true, force: true });
  });

  const memoryFile = path.join(memoryDir, "memory.json");
  return {
    memoryFile,
    service: new MemoryService({ memoryFile, memoryLimit }),
  };
}

function memoryMessage(index, overrides = {}) {
  return {
    id: `message-${index}`,
    role: "user",
    content: `message-${index}`,
    timestamp: new Date(index).toISOString(),
    ...overrides,
  };
}
