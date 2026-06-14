import "dotenv/config";

import { loadConfig } from "./config.js";
import { MemoryService } from "./services/memory-service.js";
import { OllamaService } from "./services/ollama-service.js";
import { startWhatsAppService } from "./services/whatsapp-service.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const memoryService = new MemoryService(config);
  const ollamaService = new OllamaService(config, memoryService);

  await memoryService.init();
  await startWhatsAppService({ config, ollamaService });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
