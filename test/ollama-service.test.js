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

test("generateReply passes configured Ollama context size", async (t) => {
  const memoryService = await createMemoryService(t);
  const requests = [];
  const ollamaService = new OllamaService(
    { ollamaModel: "fake-model", ollamaContextSize: 32768 },
    memoryService,
    personalityService("system prompt"),
    {
      chat: async (request) => {
        requests.push(request);
        return chatResponse("reply");
      },
    },
  );

  await ollamaService.generateReply("chat-a", "prompt", { threadId: "thread-a" });

  assert.deepEqual(requests[0]?.options, { num_ctx: 32768 });
});

test("generateSummary uses active personality and transcript without memory", async () => {
  const requests = [];
  const memoryService = {
    getThreadHistory: async () => {
      throw new Error("generateSummary should not read thread history");
    },
    getThreadIdForMessage: async () => undefined,
    appendThreadMessages: async () => {
      throw new Error("generateSummary should not write thread memory");
    },
  };
  const ollamaService = new OllamaService(
    { ollamaModel: "fake-model", ollamaContextSize: 32768 },
    memoryService,
    personalityService("system prompt", "default prompt"),
    {
      chat: async (request) => {
        requests.push(request);
        return chatResponse(" summary \n");
      },
    },
  );

  const summary = await ollamaService.generateSummary(
    "chat-a",
    [
      recentChatMessage("user-1", "user", "first message", {
        senderName: "Alice",
        timestamp: new Date(0).toISOString(),
      }),
      recentChatMessage("bot-1", "assistant", "bot reply", {
        timestamp: new Date(1).toISOString(),
      }),
    ],
    { count: 5, instructions: "only bullet points" },
  );

  assert.equal(summary, "summary");
  assert.deepEqual(requests[0]?.options, { num_ctx: 32768 });
  assert.deepEqual(requests[0]?.messages?.map(({ role }) => role), ["system", "user"]);
  assert.match(requests[0]?.messages?.[0]?.content, /system prompt/);
  assert.match(requests[0]?.messages?.[0]?.content, /default prompt/);
  assert.match(requests[0]?.messages?.[0]?.content, /summarizing recent WhatsApp chat messages/);
  assert.match(requests[0]?.messages?.[1]?.content, /last 5 messages; 2 messages are available/);
  assert.match(requests[0]?.messages?.[1]?.content, /Additional summary instructions:\nonly bullet points/);
  assert.match(requests[0]?.messages?.[1]?.content, /\[1970-01-01T00:00:00.000Z\] Alice: first message/);
  assert.match(requests[0]?.messages?.[1]?.content, /\[1970-01-01T00:00:00.001Z\] Bot: bot reply/);
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

function recentChatMessage(id, role, text, overrides = {}) {
  return {
    id,
    role,
    text,
    timestamp: new Date(0).toISOString(),
    senderJid: role === "assistant" ? "bot@s.whatsapp.net" : "alice@s.whatsapp.net",
    contentType: "conversation",
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
