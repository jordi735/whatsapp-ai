import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MemoryService } from "../dist/services/memory-service.js";
import { OllamaService } from "../dist/services/ollama-service.js";

test("generateReply uses history without writing memory", async (t) => {
  const memoryService = await createMemoryService(t);
  await memoryService.appendThreadMessages("chat-a", {
    threadId: "thread-a",
    rootMessageId: "user-1",
    messages: [
      memoryMessage("user", "old prompt", {
        id: "user-1",
        senderName: "Alice",
      }),
      memoryMessage("assistant", "old reply", {
        id: "bot-1",
        parentMessageId: "user-1",
      }),
    ],
  });
  await memoryService.appendThreadMessages("chat-a", {
    threadId: "thread-b",
    rootMessageId: "user-2",
    messages: [
      memoryMessage("user", "unrelated prompt", {
        id: "user-2",
        senderName: "Mallory",
      }),
    ],
  });

  const requests = [];
  const ollamaService = new OllamaService(
    { ollamaModel: "fake-model" },
    memoryService,
    personalityService("system prompt", "default prompt"),
    {
      chat: async (request) => {
        requests.push(request);
        return chatResponse(" generated reply \n");
      },
    },
  );

  assert.equal(
    await ollamaService.generateReply("chat-a", "new prompt", {
      threadId: "thread-a",
      senderName: "Bob",
    }),
    "generated reply",
  );
  assert.deepEqual(
    (await memoryService.getThreadHistory("chat-a", "thread-a")).map(({ content }) => content),
    ["old prompt", "old reply"],
  );
  assert.deepEqual(requests[0]?.messages?.map(({ role, content }) => ({ role, content })), [
    { role: "system", content: "system prompt\n\ndefault prompt" },
    { role: "user", content: "Alice: old prompt" },
    { role: "assistant", content: "old reply" },
    { role: "user", content: "Bob: new prompt" },
  ]);
});

test("rememberExchange writes the delivered user and assistant turn", async (t) => {
  const memoryService = await createMemoryService(t);
  const ollamaService = new OllamaService(
    { ollamaModel: "fake-model" },
    memoryService,
    personalityService("system prompt"),
    {
      chat: async () => chatResponse("unused"),
    },
  );

  await ollamaService.rememberExchange("chat-a", {
    threadId: "thread-a",
    rootMessageId: "user-1",
    user: {
      id: "user-1",
      content: "prompt",
      timestamp: new Date(0).toISOString(),
      senderName: "Alice",
    },
    assistant: {
      id: "bot-1",
      content: "reply",
      timestamp: new Date(1).toISOString(),
      parentMessageId: "user-1",
    },
  });

  assert.deepEqual(
    (await memoryService.getThreadHistory("chat-a", "thread-a")).map(
      ({ id, role, content, parentMessageId, senderName }) => ({
        id,
        role,
        content,
        parentMessageId,
        senderName,
      }),
    ),
    [
      {
        id: "user-1",
        role: "user",
        content: "prompt",
        parentMessageId: undefined,
        senderName: "Alice",
      },
      {
        id: "bot-1",
        role: "assistant",
        content: "reply",
        parentMessageId: "user-1",
        senderName: undefined,
      },
    ],
  );
  assert.equal(await ollamaService.getThreadIdForMessage("chat-a", "bot-1"), "thread-a");
});

async function createMemoryService(t) {
  const memoryDir = await mkdtemp(path.join(tmpdir(), "whatsapp-ai-ollama-memory-"));
  t.after(async () => {
    await rm(memoryDir, { recursive: true, force: true });
  });

  return new MemoryService({
    memoryFile: path.join(memoryDir, "memory.json"),
    memoryLimit: 20,
  });
}

function memoryMessage(role, content, overrides = {}) {
  return {
    id: content,
    role,
    content,
    timestamp: new Date(0).toISOString(),
    ...overrides,
  };
}

function personalityService(prompt, defaultPrompt = "default prompt") {
  return {
    getDefaultPrompt: () => defaultPrompt,
    getActivePersonality: async () => ({
      id: "test",
      index: 1,
      name: "test",
      filePath: "/personalities/test.md",
      prompt,
    }),
  };
}

function chatResponse(content) {
  return {
    model: "fake-model",
    created_at: new Date(0),
    message: {
      role: "assistant",
      content,
    },
    done: true,
    done_reason: "stop",
    total_duration: 0,
    load_duration: 0,
    prompt_eval_count: 0,
    prompt_eval_duration: 0,
    eval_count: 0,
    eval_duration: 0,
  };
}
