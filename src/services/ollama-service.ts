import ollama, { type ChatRequest, type ChatResponse } from "ollama";

import type { AppConfig } from "../config.js";
import type { MemoryMessage, MemoryService } from "./memory-service.js";
import type { PersonalityService } from "./personality-service.js";

type OllamaConfig = Pick<AppConfig, "ollamaContextSize" | "ollamaModel">;
type OllamaChatClient = {
  chat: (request: ChatRequest & { stream?: false }) => Promise<ChatResponse>;
};

export type GenerateReplyOptions = {
  threadId: string;
  senderName?: string;
};

export type RememberExchangeInput = {
  threadId: string;
  rootMessageId: string;
  user: Omit<MemoryMessage, "role">;
  assistant: Omit<MemoryMessage, "role">;
};

export class OllamaService {
  constructor(
    private readonly config: OllamaConfig,
    private readonly memoryService: MemoryService,
    private readonly personalityService: PersonalityService,
    private readonly ollamaClient: OllamaChatClient = ollama,
  ) {}

  async getThreadIdForMessage(chatId: string, messageId: string): Promise<string | undefined> {
    return this.memoryService.getThreadIdForMessage(chatId, messageId);
  }

  async generateReply(chatId: string, prompt: string, options: GenerateReplyOptions): Promise<string> {
    const [history, personality] = await Promise.all([
      this.memoryService.getThreadHistory(chatId, options.threadId),
      this.personalityService.getActivePersonality(chatId),
    ]);
    const systemPrompt = [personality.prompt, this.personalityService.getDefaultPrompt()].join("\n\n");

    const response = await this.ollamaClient.chat({
      model: this.config.ollamaModel,
      messages: [
        { role: "system", content: systemPrompt },
        ...history.map(formatMemoryMessage),
        { role: "user", content: formatUserContent(prompt, options.senderName) },
      ],
      ...(this.config.ollamaContextSize === undefined
        ? {}
        : { options: { num_ctx: this.config.ollamaContextSize } }),
    });

    return response.message.content.trim();
  }

  async rememberExchange(chatId: string, exchange: RememberExchangeInput): Promise<void> {
    await this.memoryService.appendThreadMessages(chatId, {
      threadId: exchange.threadId,
      rootMessageId: exchange.rootMessageId,
      messages: [
        { role: "user", ...exchange.user },
        { role: "assistant", ...exchange.assistant },
      ],
    });
  }
}

function formatMemoryMessage({ role, content, senderName }: MemoryMessage): { role: MemoryMessage["role"]; content: string } {
  return {
    role,
    content: role === "user" ? formatUserContent(content, senderName) : content,
  };
}

function formatUserContent(content: string, senderName: string | undefined): string {
  const speaker = senderName?.trim();
  return speaker ? `${speaker}: ${content}` : content;
}
