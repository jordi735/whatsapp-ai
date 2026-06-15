import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "../config.js";
import { AsyncQueue } from "../utils/async-queue.js";
import { isNodeError } from "../utils/errors.js";
import { SUMMARY_MESSAGE_LIMIT } from "../utils/summary.js";

export const CHAT_HISTORY_STORE_VERSION = 1;

export type ChatHistoryRole = "user" | "assistant";

export type RecentChatMessage = {
  id: string;
  role: ChatHistoryRole;
  text: string;
  timestamp: string;
  senderJid: string;
  contentType: string;
  senderName?: string;
};

export type ChatHistory = {
  messages: RecentChatMessage[];
};

export type ChatHistoryStore = {
  version: typeof CHAT_HISTORY_STORE_VERSION;
  chats: Record<string, ChatHistory>;
};

type ChatHistoryConfig = Pick<AppConfig, "chatHistoryFile">;

export class ChatHistoryService {
  private readonly queue = new AsyncQueue();
  private readonly historyDir: string;

  constructor(private readonly config: ChatHistoryConfig) {
    this.historyDir = path.dirname(config.chatHistoryFile);
  }

  async init(): Promise<void> {
    await this.queue.enqueue(() => this.readHistory());
  }

  async appendMessage(chatId: string, message: RecentChatMessage): Promise<void> {
    if (!message.text.trim()) {
      return;
    }

    await this.queue.enqueue(async () => {
      const history = await this.readHistory();
      const chat = getOrCreateChat(history, chatId);
      const existingIndex = chat.messages.findIndex((existingMessage) => existingMessage.id === message.id);

      if (existingIndex >= 0) {
        chat.messages.splice(existingIndex, 1);
      }

      chat.messages.push(message);
      chat.messages = getRetainedMessages(chat.messages);

      await this.writeHistory(history);
    });
  }

  async getRecentMessages(chatId: string, count: number): Promise<RecentChatMessage[]> {
    return this.queue.enqueue(async () => {
      const history = await this.readHistory();
      const chatMessages = history.chats[chatId]?.messages ?? [];
      const limit = Math.max(0, Math.min(count, SUMMARY_MESSAGE_LIMIT));
      return limit === 0 ? [] : chatMessages.slice(-limit);
    });
  }

  private async readHistory(): Promise<ChatHistoryStore> {
    await mkdir(this.historyDir, { recursive: true });

    try {
      const raw = await readFile(this.config.chatHistoryFile, "utf8");
      const parsed = JSON.parse(raw) as unknown;

      if (!isChatHistoryStore(parsed)) {
        return this.resetHistory();
      }

      return parsed;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return this.resetHistory();
      }

      throw error;
    }
  }

  private async resetHistory(): Promise<ChatHistoryStore> {
    const emptyHistory: ChatHistoryStore = { version: CHAT_HISTORY_STORE_VERSION, chats: {} };
    await this.writeHistory(emptyHistory);
    return emptyHistory;
  }

  private async writeHistory(history: ChatHistoryStore): Promise<void> {
    await mkdir(this.historyDir, { recursive: true });
    await writeFile(this.config.chatHistoryFile, `${JSON.stringify(history, null, 2)}\n`, "utf8");
  }
}

function getOrCreateChat(history: ChatHistoryStore, chatId: string): ChatHistory {
  let chat = history.chats[chatId];

  if (!chat) {
    chat = { messages: [] };
    history.chats[chatId] = chat;
  }

  return chat;
}

function getRetainedMessages(messages: RecentChatMessage[]): RecentChatMessage[] {
  return messages.slice(-SUMMARY_MESSAGE_LIMIT);
}

function isChatHistoryStore(value: unknown): value is ChatHistoryStore {
  if (!isRecord(value) || value.version !== CHAT_HISTORY_STORE_VERSION || !isRecord(value.chats)) {
    return false;
  }

  return Object.values(value.chats).every(isChatHistory);
}

function isChatHistory(value: unknown): value is ChatHistory {
  return isRecord(value) && Array.isArray(value.messages) && value.messages.every(isRecentChatMessage);
}

function isRecentChatMessage(value: unknown): value is RecentChatMessage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.text === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.senderJid === "string" &&
    typeof value.contentType === "string" &&
    (value.senderName === undefined || typeof value.senderName === "string")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
