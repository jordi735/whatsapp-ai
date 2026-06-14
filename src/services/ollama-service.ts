import ollama, { type ChatRequest, type ChatResponse } from "ollama";

import type { AppConfig } from "../config.js";
import type { MemoryService } from "./memory-service.js";

type OllamaConfig = Pick<AppConfig, "ollamaModel" | "systemPrompt">;
type OllamaChatClient = {
  chat: (request: ChatRequest & { stream?: false }) => Promise<ChatResponse>;
};

export class OllamaService {
  constructor(
    private readonly config: OllamaConfig,
    private readonly memoryService: MemoryService,
    private readonly ollamaClient: OllamaChatClient = ollama,
  ) {}

  async generateReply(chatId: string, prompt: string): Promise<string> {
    const history = await this.memoryService.getHistory(chatId);
    const response = await this.ollamaClient.chat({
      model: this.config.ollamaModel,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        ...history.map(({ role, content }) => ({ role, content })),
        { role: "user", content: prompt },
      ],
    });

    return response.message.content.trim();
  }

  async rememberExchange(chatId: string, prompt: string, reply: string): Promise<void> {
    const timestamp = new Date().toISOString();

    await this.memoryService.append(chatId, [
      { role: "user", content: prompt, timestamp },
      { role: "assistant", content: reply, timestamp },
    ]);
  }
}
