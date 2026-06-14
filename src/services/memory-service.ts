import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "../config.js";
import { isNodeError } from "../utils/errors.js";

export type MemoryRole = "user" | "assistant";

export type MemoryMessage = {
  role: MemoryRole;
  content: string;
  timestamp: string;
};

export type MemoryStore = {
  chats: Record<string, MemoryMessage[]>;
};

type MemoryConfig = Pick<AppConfig, "memoryFile" | "memoryLimit">;

export class MemoryService {
  private readonly memoryDir: string;

  constructor(private readonly config: MemoryConfig) {
    this.memoryDir = path.dirname(config.memoryFile);
  }

  async init(): Promise<void> {
    await this.readMemory();
  }

  async getHistory(chatId: string): Promise<MemoryMessage[]> {
    const memory = await this.readMemory();
    return memory.chats[chatId] ?? [];
  }

  async append(chatId: string, messages: MemoryMessage[]): Promise<void> {
    const memory = await this.readMemory();
    const existingMessages = memory.chats[chatId] ?? [];

    memory.chats[chatId] = [...existingMessages, ...messages].slice(-this.config.memoryLimit);

    await this.writeMemory(memory);
  }

  private async readMemory(): Promise<MemoryStore> {
    await mkdir(this.memoryDir, { recursive: true });

    try {
      const raw = await readFile(this.config.memoryFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<MemoryStore>;

      if (!parsed.chats || typeof parsed.chats !== "object") {
        const emptyMemory: MemoryStore = { chats: {} };
        await this.writeMemory(emptyMemory);
        return emptyMemory;
      }

      return { chats: parsed.chats as Record<string, MemoryMessage[]> };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        const emptyMemory: MemoryStore = { chats: {} };
        await this.writeMemory(emptyMemory);
        return emptyMemory;
      }

      throw error;
    }
  }

  private async writeMemory(memory: MemoryStore): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });
    await writeFile(this.config.memoryFile, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
  }
}
