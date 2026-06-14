import ollama from "ollama";

import type { AppConfig } from "../config.js";
import type { MemoryService } from "./memory-service.js";

type OllamaConfig = Pick<AppConfig, "ollamaModel" | "systemPrompt">;

export class OllamaService {
  constructor(
    private readonly config: OllamaConfig,
    private readonly memoryService: MemoryService,
  ) {}

  async reply(chatId: string, prompt: string): Promise<string> {
    const history = await this.memoryService.getHistory(chatId);
    const response = await ollama.chat({
      model: this.config.ollamaModel,
      messages: [
        { role: "system", content: this.config.systemPrompt },
        ...history.map(({ role, content }) => ({ role, content })),
        { role: "user", content: prompt },
      ],
    });

    const reply = response.message.content.trim();
    const timestamp = new Date().toISOString();

    await this.memoryService.append(chatId, [
      { role: "user", content: prompt, timestamp },
      { role: "assistant", content: reply, timestamp },
    ]);

    return reply;
  }
}
