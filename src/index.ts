import "dotenv/config";

import { loadConfig } from "./config.js";
import { ChatHistoryService } from "./services/chat-history-service.js";
import { MemoryService } from "./services/memory-service.js";
import { OllamaService } from "./services/ollama-service.js";
import { PersonalityService } from "./services/personality-service.js";
import { startWhatsAppService } from "./services/whatsapp-service.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const chatHistoryService = new ChatHistoryService(config);
  const memoryService = new MemoryService(config);
  const personalityService = new PersonalityService(config);
  const ollamaService = new OllamaService(config, memoryService, personalityService);

  await chatHistoryService.init();
  await memoryService.init();
  await personalityService.init();
  await startWhatsAppService({ chatHistoryService, config, ollamaService, personalityService });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
