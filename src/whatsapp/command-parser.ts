export type SlashCommand =
  | { type: "list-personalities" }
  | { type: "set-personality"; number: number }
  | { type: "invalid-personality"; value: string }
  | { type: "unknown"; name: string };

const personalityCommand = "personality";

export function parseSlashCommand(text: string): SlashCommand | undefined {
  const trimmedText = text.trim();
  if (!trimmedText.startsWith("/")) {
    return undefined;
  }

  const [rawCommand = "", ...args] = trimmedText.split(/\s+/);
  const commandName = rawCommand.slice(1).toLowerCase();

  if (commandName !== personalityCommand) {
    return { type: "unknown", name: commandName };
  }

  if (args.length === 0) {
    return { type: "list-personalities" };
  }

  if (args.length === 1 && /^[1-9]\d*$/.test(args[0] ?? "")) {
    return { type: "set-personality", number: Number(args[0]) };
  }

  return { type: "invalid-personality", value: args.join(" ") };
}
