import ollama, { type ChatRequest, type ChatResponse } from "ollama";

import type { AppConfig } from "../config.js";
import type { RecentChatMessage } from "./chat-history-service.js";
import type { MemoryMessage, MemoryService } from "./memory-service.js";
import type { PersonalityService } from "./personality-service.js";

type OllamaConfig = Pick<AppConfig, "ollamaContextSize" | "ollamaModel">;
type OllamaChatClient = {
  chat: (request: ChatRequest & { stream?: false }) => Promise<ChatResponse>;
};

export type GenerateReplyOptions = {
  threadId: string;
  images?: readonly Uint8Array[];
  senderName?: string;
};

export type GenerateSummaryOptions = {
  count: number;
  instructions?: string;
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
        createUserMessage(prompt, options),
      ],
      ...(this.config.ollamaContextSize === undefined
        ? {}
        : { options: { num_ctx: this.config.ollamaContextSize } }),
    });

    return response.message.content.trim();
  }

  async generateSummary(
    chatId: string,
    messages: readonly RecentChatMessage[],
    options: GenerateSummaryOptions,
  ): Promise<string> {
    const personality = await this.personalityService.getActivePersonality(chatId);
    const systemPrompt = [
      personality.prompt,
      this.personalityService.getDefaultPrompt(),
      [
        "You are summarizing recent WhatsApp chat messages.",
        "Use only the provided transcript.",
        "Do not invent details that are not present in the transcript.",
      ].join(" "),
    ].join("\n\n");

    const response = await this.ollamaClient.chat({
      model: this.config.ollamaModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: formatSummaryPrompt(messages, options) },
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

function createUserMessage(
  prompt: string,
  options: GenerateReplyOptions,
): { role: "user"; content: string; images?: Uint8Array[] } {
  const message: { role: "user"; content: string; images?: Uint8Array[] } = {
    role: "user",
    content: formatUserContent(prompt, options.senderName),
  };

  if (options.images && options.images.length > 0) {
    message.images = [...options.images];
  }

  return message;
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

function formatSummaryPrompt(
  messages: readonly RecentChatMessage[],
  options: GenerateSummaryOptions,
): string {
  const instructionLines = options.instructions
    ? ["", "Additional summary instructions:", options.instructions]
    : [];

  return [
    `Summarize the recent WhatsApp chat transcript below. The user requested the last ${options.count} messages; ${messages.length} messages are available.`,
    ...instructionLines,
    "",
    "Transcript:",
    ...messages.map(formatRecentChatMessage),
  ].join("\n");
}

function formatRecentChatMessage(message: RecentChatMessage): string {
  const speaker = message.senderName?.trim() || (message.role === "assistant" ? "Bot" : message.senderJid);
  return `[${message.timestamp}] ${speaker}: ${message.text}`;
}
