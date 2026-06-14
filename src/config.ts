import path from "node:path";

import { parseLogLevel, type LogLevel } from "./utils/logger.js";

export type AppConfig = {
  authDir: string;
  baileysLogLevel: string;
  dataDir: string;
  defaultPersonalityId: string;
  defaultPromptFile: string;
  logLevel: LogLevel;
  memoryFile: string;
  memoryLimit: number;
  ollamaModel: string;
  personalitiesDir: string;
  personalitySelectionsFile: string;
};

const DATA_DIR = "./data";
const PERSONALITIES_DIR = "./personalities";

export function loadConfig(): AppConfig {
  return {
    authDir: "./auth",
    baileysLogLevel: process.env.BAILEYS_LOG_LEVEL ?? "silent",
    dataDir: DATA_DIR,
    defaultPersonalityId: process.env.DEFAULT_PERSONALITY ?? "alex-jones",
    defaultPromptFile: path.join(PERSONALITIES_DIR, "_default.md"),
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    memoryFile: path.join(DATA_DIR, "memory.json"),
    memoryLimit: 20,
    ollamaModel: process.env.OLLAMA_MODEL ?? "phi",
    personalitiesDir: PERSONALITIES_DIR,
    personalitySelectionsFile: path.join(DATA_DIR, "personality-selections.json"),
  };
}
