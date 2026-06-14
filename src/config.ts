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
  ollamaContextSize?: number;
  ollamaModel: string;
  personalitiesDir: string;
  personalitySelectionsFile: string;
};

const DATA_DIR = "./data";
const PERSONALITIES_DIR = "./personalities";

export function loadConfig(): AppConfig {
  const ollamaContextSize = parseOptionalPositiveInteger(
    process.env.OLLAMA_CONTEXT_SIZE,
    "OLLAMA_CONTEXT_SIZE",
  );

  return {
    authDir: "./auth",
    baileysLogLevel: process.env.BAILEYS_LOG_LEVEL ?? "silent",
    dataDir: DATA_DIR,
    defaultPersonalityId: process.env.DEFAULT_PERSONALITY ?? "alex-jones",
    defaultPromptFile: path.join(PERSONALITIES_DIR, "_default.md"),
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    memoryFile: path.join(DATA_DIR, "memory.json"),
    memoryLimit: 20,
    ...(ollamaContextSize === undefined ? {} : { ollamaContextSize }),
    ollamaModel: process.env.OLLAMA_MODEL ?? "phi",
    personalitiesDir: PERSONALITIES_DIR,
    personalitySelectionsFile: path.join(DATA_DIR, "personality-selections.json"),
  };
}

function parseOptionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}
