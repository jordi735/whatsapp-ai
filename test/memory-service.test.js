import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MemoryService } from "../dist/services/memory-service.js";

const emptyMemoryJson = `{
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

test("concurrent appends preserve turns across chats", async (t) => {
  const { service } = await createMemoryService(t, 100);
  const messages = Array.from({ length: 30 }, (_, index) => ({
    chatId: index % 2 === 0 ? "chat-a" : "chat-b",
    message: memoryMessage(index),
  }));

  await Promise.all(messages.map(({ chatId, message }) => service.append(chatId, [message])));

  const savedContents = [
    ...(await service.getHistory("chat-a")),
    ...(await service.getHistory("chat-b")),
  ]
    .map(({ content }) => Number(content.replace("message-", "")))
    .sort((left, right) => left - right);

  assert.deepEqual(
    savedContents,
    Array.from({ length: 30 }, (_, index) => index),
  );
});

test("a failed queued memory operation does not block later operations", async (t) => {
  const { memoryFile, service } = await createMemoryService(t);
  await writeFile(memoryFile, "{", "utf8");

  await assert.rejects(service.getHistory("chat-a"), SyntaxError);

  await writeFile(memoryFile, emptyMemoryJson, "utf8");
  await service.append("chat-a", [memoryMessage(1)]);

  assert.deepEqual(
    (await service.getHistory("chat-a")).map(({ content }) => content),
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

function memoryMessage(index) {
  return {
    role: "user",
    content: `message-${index}`,
    timestamp: new Date(index).toISOString(),
  };
}
