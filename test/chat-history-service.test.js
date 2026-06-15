import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CHAT_HISTORY_STORE_VERSION,
  ChatHistoryService,
} from "../dist/services/chat-history-service.js";

const emptyHistoryJson = `{
  "version": ${CHAT_HISTORY_STORE_VERSION},
  "chats": {}
}
`;

test("init creates a missing chat history file", async (t) => {
  const { historyFile, service } = await createChatHistoryService(t);

  await service.init();

  assert.equal(await readFile(historyFile, "utf8"), emptyHistoryJson);
});

test("init resets a chat history file with an invalid shape", async (t) => {
  const { historyFile, service } = await createChatHistoryService(t);
  await writeFile(historyFile, "{}\n", "utf8");

  await service.init();

  assert.equal(await readFile(historyFile, "utf8"), emptyHistoryJson);
});

test("chat history persists recent messages across service instances", async (t) => {
  const { historyFile, service } = await createChatHistoryService(t);
  await service.init();

  await service.appendMessage("chat-a", recentMessage(1, { senderName: "Alice" }));
  await service.appendMessage("chat-b", recentMessage(2, { text: "other chat" }));

  const reloadedService = new ChatHistoryService({ chatHistoryFile: historyFile });
  await reloadedService.init();

  assert.deepEqual(
    (await reloadedService.getRecentMessages("chat-a", 10)).map(({ id, text, senderName }) => ({
      id,
      text,
      senderName,
    })),
    [
      {
        id: "message-1",
        text: "message-1",
        senderName: "Alice",
      },
    ],
  );
  assert.deepEqual(
    (await reloadedService.getRecentMessages("chat-b", 10)).map(({ text }) => text),
    ["other chat"],
  );
});

test("chat history deduplicates messages by id and keeps newest position", async (t) => {
  const { service } = await createChatHistoryService(t);
  await service.init();

  await service.appendMessage("chat-a", recentMessage(1));
  await service.appendMessage("chat-a", recentMessage(2));
  await service.appendMessage("chat-a", recentMessage(1, { text: "updated message" }));

  assert.deepEqual(
    (await service.getRecentMessages("chat-a", 10)).map(({ id, text }) => ({ id, text })),
    [
      { id: "message-2", text: "message-2" },
      { id: "message-1", text: "updated message" },
    ],
  );
});

test("chat history keeps at most 1000 messages per chat", async (t) => {
  const { service } = await createChatHistoryService(t);
  await service.init();

  for (let index = 0; index < 1002; index += 1) {
    await service.appendMessage("chat-a", recentMessage(index));
  }

  const messages = await service.getRecentMessages("chat-a", 1000);
  assert.equal(messages.length, 1000);
  assert.equal(messages[0]?.id, "message-2");
  assert.equal(messages.at(-1)?.id, "message-1001");
});

test("chat history ignores blank messages", async (t) => {
  const { service } = await createChatHistoryService(t);
  await service.init();

  await service.appendMessage("chat-a", recentMessage(1, { text: "   " }));

  assert.deepEqual(await service.getRecentMessages("chat-a", 10), []);
});

async function createChatHistoryService(t) {
  const historyDir = await mkdtemp(path.join(tmpdir(), "whatsapp-ai-chat-history-"));
  t.after(async () => {
    await rm(historyDir, { recursive: true, force: true });
  });

  const historyFile = path.join(historyDir, "chat-history.json");
  return {
    historyFile,
    service: new ChatHistoryService({ chatHistoryFile: historyFile }),
  };
}

function recentMessage(index, overrides = {}) {
  return {
    id: `message-${index}`,
    role: "user",
    text: `message-${index}`,
    timestamp: new Date(index).toISOString(),
    senderJid: "alice@s.whatsapp.net",
    contentType: "conversation",
    ...overrides,
  };
}
