import { SUMMARY_MESSAGE_LIMIT } from "../utils/summary.js";

export type SlashCommand =
  | { type: "list-personalities" }
  | { type: "set-personality"; number: number }
  | { type: "invalid-personality"; value: string }
  | { type: "summarize"; count: number; instructions?: string }
  | { type: "invalid-summarize"; value: string }
  | { type: "unknown"; name: string };

const personalityCommand = "personality";
const summarizeCommand = "summarize";

export function parseSlashCommand(text: string): SlashCommand | undefined {
  const trimmedText = text.trim();
  if (!trimmedText.startsWith("/")) {
    return undefined;
  }

  const commandMatch = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(trimmedText);
  const commandName = commandMatch?.[1]?.toLowerCase() ?? "";
  const rawArgs = commandMatch?.[2]?.trim() ?? "";

  if (commandName === personalityCommand) {
    return parsePersonalityCommand(rawArgs);
  }

  if (commandName === summarizeCommand) {
    return parseSummarizeCommand(rawArgs);
  }

  return { type: "unknown", name: commandName };
}

function parsePersonalityCommand(rawArgs: string): SlashCommand {
  if (!rawArgs) {
    return { type: "list-personalities" };
  }

  const args = rawArgs.split(/\s+/);
  if (args.length === 1 && /^[1-9]\d*$/.test(args[0] ?? "")) {
    return { type: "set-personality", number: Number(args[0]) };
  }

  return { type: "invalid-personality", value: rawArgs };
}

function parseSummarizeCommand(rawArgs: string): SlashCommand {
  if (!rawArgs) {
    return { type: "invalid-summarize", value: "" };
  }

  const countMatch = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rawArgs);
  const rawCount = countMatch?.[1] ?? "";
  if (!/^[1-9]\d*$/.test(rawCount)) {
    return { type: "invalid-summarize", value: rawArgs };
  }

  const count = Number(rawCount);
  if (!Number.isSafeInteger(count) || count > SUMMARY_MESSAGE_LIMIT) {
    return { type: "invalid-summarize", value: rawCount };
  }

  const instructions = countMatch?.[2]?.trim();
  if (instructions) {
    return { type: "summarize", count, instructions };
  }

  return { type: "summarize", count };
}
