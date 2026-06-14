import { type WAContextInfo, type WAMessageContent } from "baileys";

import { escapeRegExp } from "../utils/text.js";
import { findBotMentionMatch, getJidUser, type MentionMatch } from "./bot-identity.js";

export type ExtractedMessage = {
  text: string;
  contextInfo: WAContextInfo | undefined;
  contentType: string | undefined;
};

export type BotTrigger =
  | { type: "mention"; match: MentionMatch }
  | { type: "reply"; match: MentionMatch };

export function getMessageContent(
  message: WAMessageContent | undefined | null,
): WAMessageContent | undefined {
  if (!message) return undefined;

  return (
    message.ephemeralMessage?.message ??
    message.viewOnceMessage?.message ??
    message.viewOnceMessageV2?.message ??
    message.documentWithCaptionMessage?.message ??
    message
  );
}

export function extractMessage(message: WAMessageContent | undefined | null): ExtractedMessage {
  const content = getMessageContent(message);

  if (!content) return { text: "", contextInfo: undefined, contentType: undefined };

  const text =
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    "";

  const contextInfo =
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    undefined;

  return { text, contextInfo, contentType: getMessageContentType(content) };
}

export function getMessageContentType(content: WAMessageContent): string | undefined {
  return Object.keys(content).find((key) => content[key as keyof WAMessageContent] != null);
}

export function isGroupJid(jid: string | null | undefined): boolean {
  return jid?.endsWith("@g.us") ?? false;
}

export function stripBotMentions(text: string, botJids: readonly string[]): string {
  let strippedText = text;

  for (const botJid of botJids) {
    const botUser = getJidUser(botJid);
    if (!botUser) continue;

    strippedText = strippedText.replace(new RegExp(`@${escapeRegExp(botUser)}\\b`, "g"), "");
  }

  return strippedText.trim();
}

export function wasBotMentioned(
  contextInfo: WAContextInfo | undefined,
  botJids: readonly string[],
): boolean {
  return Boolean(getBotMentionMatch(contextInfo, botJids));
}

export function getBotMentionMatch(
  contextInfo: WAContextInfo | undefined,
  botJids: readonly string[],
): MentionMatch | undefined {
  const mentions = contextInfo?.mentionedJid ?? [];
  return findBotMentionMatch(mentions, botJids);
}

export function getBotReplyMatch(
  contextInfo: WAContextInfo | undefined,
  botJids: readonly string[],
): MentionMatch | undefined {
  const quotedParticipant = contextInfo?.participant ?? undefined;

  if (!contextInfo?.quotedMessage || !quotedParticipant) {
    return undefined;
  }

  return findBotMentionMatch([quotedParticipant], botJids);
}

export function getBotTrigger(
  isGroup: boolean,
  contextInfo: WAContextInfo | undefined,
  botJids: readonly string[],
): BotTrigger | undefined {
  if (!isGroup) {
    return undefined;
  }

  const mentionMatch = getBotMentionMatch(contextInfo, botJids);
  if (mentionMatch) {
    return { type: "mention", match: mentionMatch };
  }

  const replyMatch = getBotReplyMatch(contextInfo, botJids);
  if (replyMatch) {
    return { type: "reply", match: replyMatch };
  }

  return undefined;
}
