import path from "node:path";

import { parseLogLevel, type LogLevel } from "./utils/logger.js";

export type AppConfig = {
  authDir: string;
  baileysLogLevel: string;
  dataDir: string;
  logLevel: LogLevel;
  memoryFile: string;
  memoryLimit: number;
  ollamaModel: string;
  systemPrompt: string;
};

const DATA_DIR = "./data";

export function loadConfig(): AppConfig {
  return {
    authDir: "./auth",
    baileysLogLevel: process.env.BAILEYS_LOG_LEVEL ?? "silent",
    dataDir: DATA_DIR,
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    memoryFile: path.join(DATA_DIR, "memory.json"),
    memoryLimit: 20,
    ollamaModel: process.env.OLLAMA_MODEL ?? "phi",
    systemPrompt:
      "You are a friendly WhatsApp assistant for Jordi and his friends. Keep replies conversational, helpful, and concise.",
  };
}
