import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { MemoryService } from "../dist/services/memory-service.js";
import { OllamaService } from "../dist/services/ollama-service.js";

test("generateReply uses history without writing memory", async (t) => {
  const memoryService = await createMemoryService(t);
  await memoryService.append("chat-a", [memoryMessage("user", "old prompt")]);

  const requests = [];
  const ollamaService = new OllamaService(
    { ollamaModel: "fake-model", systemPrompt: "system prompt" },
    memoryService,
    {
      chat: async (request) => {
        requests.push(request);
        return chatResponse(" generated reply \n");
      },
    },
  );

  assert.equal(await ollamaService.generateReply("chat-a", "new prompt"), "generated reply");
  assert.deepEqual(
    (await memoryService.getHistory("chat-a")).map(({ content }) => content),
    ["old prompt"],
  );
  assert.deepEqual(requests[0]?.messages?.map(({ role, content }) => ({ role, content })), [
    { role: "system", content: "system prompt" },
    { role: "user", content: "old prompt" },
    { role: "user", content: "new prompt" },
  ]);
});

test("rememberExchange writes the delivered user and assistant turn", async (t) => {
  const memoryService = await createMemoryService(t);
  const ollamaService = new OllamaService(
    { ollamaModel: "fake-model", systemPrompt: "system prompt" },
    memoryService,
    {
      chat: async () => chatResponse("unused"),
    },
  );

  await ollamaService.rememberExchange("chat-a", "prompt", "reply");

  assert.deepEqual(
    (await memoryService.getHistory("chat-a")).map(({ role, content }) => ({ role, content })),
    [
      { role: "user", content: "prompt" },
      { role: "assistant", content: "reply" },
    ],
  );
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

function memoryMessage(role, content) {
  return {
    role,
    content,
    timestamp: new Date(0).toISOString(),
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
