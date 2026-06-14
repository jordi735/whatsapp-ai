import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "../config.js";
import { AsyncQueue } from "../utils/async-queue.js";
import { isNodeError } from "../utils/errors.js";

export type MemoryRole = "user" | "assistant";

export const MEMORY_STORE_VERSION = 2;

export type MemoryMessage = {
  id: string;
  role: MemoryRole;
  content: string;
  timestamp: string;
  parentMessageId?: string;
  senderJid?: string;
  senderName?: string;
};

export type MemoryThread = {
  id: string;
  rootMessageId: string;
  createdAt: string;
  updatedAt: string;
  messages: MemoryMessage[];
};

export type ChatMemory = {
  threads: Record<string, MemoryThread>;
  messageThreadIndex: Record<string, string>;
};

export type MemoryStore = {
  version: typeof MEMORY_STORE_VERSION;
  chats: Record<string, ChatMemory>;
};

export type AppendThreadMessagesInput = {
  threadId: string;
  rootMessageId: string;
  messages: MemoryMessage[];
};

type MemoryConfig = Pick<AppConfig, "memoryFile" | "memoryLimit">;

export class MemoryService {
  private readonly queue = new AsyncQueue();
  private readonly memoryDir: string;

  constructor(private readonly config: MemoryConfig) {
    this.memoryDir = path.dirname(config.memoryFile);
  }

  async init(): Promise<void> {
    await this.queue.enqueue(() => this.readMemory());
  }

  async getThreadHistory(chatId: string, threadId: string): Promise<MemoryMessage[]> {
    return this.queue.enqueue(async () => {
      const memory = await this.readMemory();
      return memory.chats[chatId]?.threads[threadId]?.messages ?? [];
    });
  }

  async getThreadIdForMessage(chatId: string, messageId: string): Promise<string | undefined> {
    return this.queue.enqueue(async () => {
      const memory = await this.readMemory();
      return memory.chats[chatId]?.messageThreadIndex[messageId];
    });
  }

  async appendThreadMessages(chatId: string, input: AppendThreadMessagesInput): Promise<void> {
    if (input.messages.length === 0) {
      return;
    }

    await this.queue.enqueue(async () => {
      const memory = await this.readMemory();
      const chat = getOrCreateChat(memory, chatId);
      const existingThread = chat.threads[input.threadId];
      const existingMessages = existingThread?.messages ?? [];
      const nextMessages = [...existingMessages, ...input.messages];
      const retainedMessages = getRetainedMessages(nextMessages, this.config.memoryLimit);
      const prunedMessages = nextMessages.slice(0, nextMessages.length - retainedMessages.length);
      const createdAt = existingThread?.createdAt ?? input.messages[0]?.timestamp ?? new Date().toISOString();
      const updatedAt = input.messages[input.messages.length - 1]?.timestamp ?? existingThread?.updatedAt ?? createdAt;

      for (const message of prunedMessages) {
        if (chat.messageThreadIndex[message.id] === input.threadId) {
          delete chat.messageThreadIndex[message.id];
        }
      }

      chat.threads[input.threadId] = {
        id: input.threadId,
        rootMessageId: existingThread?.rootMessageId ?? input.rootMessageId,
        createdAt,
        updatedAt,
        messages: retainedMessages,
      };

      for (const message of retainedMessages) {
        chat.messageThreadIndex[message.id] = input.threadId;
      }

      await this.writeMemory(memory);
    });
  }

  private async readMemory(): Promise<MemoryStore> {
    await mkdir(this.memoryDir, { recursive: true });

    try {
      const raw = await readFile(this.config.memoryFile, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      if (!isMemoryStore(parsed)) {
        return this.resetMemory();
      }

      return parsed;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return this.resetMemory();
      }

      throw error;
    }
  }

  private async resetMemory(): Promise<MemoryStore> {
    const emptyMemory: MemoryStore = { version: MEMORY_STORE_VERSION, chats: {} };
    await this.writeMemory(emptyMemory);
    return emptyMemory;
  }

  private async writeMemory(memory: MemoryStore): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });
    await writeFile(this.config.memoryFile, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
  }
}

function getOrCreateChat(memory: MemoryStore, chatId: string): ChatMemory {
  let chat = memory.chats[chatId];

  if (!chat) {
    chat = { threads: {}, messageThreadIndex: {} };
    memory.chats[chatId] = chat;
  }

  return chat;
}

function getRetainedMessages(messages: MemoryMessage[], memoryLimit: number): MemoryMessage[] {
  const limit = Math.max(0, memoryLimit);
  return limit === 0 ? [] : messages.slice(-limit);
}

function isMemoryStore(value: unknown): value is MemoryStore {
  if (!isRecord(value) || value.version !== MEMORY_STORE_VERSION || !isRecord(value.chats)) {
    return false;
  }

  return Object.values(value.chats).every(isChatMemory);
}

function isChatMemory(value: unknown): value is ChatMemory {
  if (!isRecord(value) || !isRecord(value.threads) || !isRecord(value.messageThreadIndex)) {
    return false;
  }

  return Object.values(value.threads).every(isMemoryThread);
}

function isMemoryThread(value: unknown): value is MemoryThread {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.rootMessageId !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    !Array.isArray(value.messages)
  ) {
    return false;
  }

  return value.messages.every(isMemoryMessage);
}

function isMemoryMessage(value: unknown): value is MemoryMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    typeof value.timestamp === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
