import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from "baileys";
import P from "pino";
import QRCode from "qrcode";

import type { AppConfig } from "../config.js";
import { KeyedAsyncQueue } from "../utils/async-queue.js";
import { getDisconnectStatusCode } from "../utils/errors.js";
import { createLogger, type AppLogger } from "../utils/logger.js";
import { SUMMARY_MESSAGE_LIMIT } from "../utils/summary.js";
import { previewText } from "../utils/text.js";
import { getBotIdentity } from "../whatsapp/bot-identity.js";
import { parseSlashCommand, type SlashCommand } from "../whatsapp/command-parser.js";
import {
  extractMessage,
  extractQuotedMessageContext,
  formatPromptWithQuotedMessage,
  getBotTrigger,
  getMessageContentType,
  isGroupJid,
  stripBotMentions,
} from "../whatsapp/message-parser.js";
import type { ChatHistoryService, RecentChatMessage } from "./chat-history-service.js";
import type {
  GenerateReplyOptions,
  GenerateSummaryOptions,
  OllamaService,
  RememberExchangeInput,
} from "./ollama-service.js";
import type { Personality, PersonalityService } from "./personality-service.js";

type WhatsAppServiceConfig = Pick<AppConfig, "authDir" | "baileysLogLevel" | "logLevel">;

type StartWhatsAppServiceOptions = {
  chatHistoryService: ChatHistoryService;
  config: WhatsAppServiceConfig;
  ollamaService: OllamaService;
  personalityService: PersonalityService;
};

export async function startWhatsAppService({
  chatHistoryService,
  config,
  ollamaService,
  personalityService,
}: StartWhatsAppServiceOptions): Promise<void> {
  const logger = createLogger("whatsapp", config.logLevel);
  const chatQueues = new KeyedAsyncQueue<string>();

  logger.info("Starting service", {
    authDir: config.authDir,
    baileysLogLevel: config.baileysLogLevel,
    logLevel: config.logLevel,
  });

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: config.baileysLogLevel }),
    markOnlineOnConnect: false,
    getMessage: async () => undefined,
  });

  sock.ev.on("creds.update", (creds) => {
    logger.debug("Credentials updated", {
      hasMe: Boolean(creds.me),
      nextPreKeyId: creds.nextPreKeyId,
      accountSyncCounter: creds.accountSyncCounter,
    });

    saveCreds();
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    const statusCode = getDisconnectStatusCode(lastDisconnect?.error);

    logger.debug("Connection update", {
      connection,
      hasQr: Boolean(qr),
      statusCode,
      isNewLogin: update.isNewLogin,
      isOnline: update.isOnline,
      receivedPendingNotifications: update.receivedPendingNotifications,
      userId: sock.user?.id,
      user: sock.user,
      authUser: sock.authState.creds.me,
      botIdentity: getBotIdentity(sock),
    });

    if (qr) {
      logger.info("QR code received. Scan it with WhatsApp > Linked devices.");
      console.log(await QRCode.toString(qr, { type: "terminal", small: true }));
    }

    if (connection === "open") {
      logger.info("Connected", {
        userId: sock.user?.id ?? "unknown WhatsApp user",
      });
      logger.debug("Bot identity candidates", getBotIdentity(sock));
    }

    if (connection === "close") {
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      logger.warn("Connection closed", {
        statusCode: statusCode ?? "unknown",
        shouldReconnect,
      });

      if (shouldReconnect) {
        logger.info("Reconnecting");
        startWhatsAppService({ chatHistoryService, config, ollamaService, personalityService }).catch((error) =>
          logger.error("Reconnect failed", error),
        );
      } else {
        logger.warn(`Logged out. Delete ${config.authDir} and scan again.`);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    logger.debug("messages.upsert", {
      type,
      count: messages.length,
      messages: messages.map(summarizeMessage),
    });

    if (type !== "notify") {
      logger.debug("Ignoring message batch because type is not notify", { type });
      return;
    }

    for (const msg of messages) {
      try {
        await handleIncomingMessage(
          sock,
          msg,
          chatHistoryService,
          ollamaService,
          personalityService,
          chatQueues,
          logger,
        );
      } catch (error) {
        logger.error("Failed to handle message", {
          message: summarizeMessage(msg),
          error,
        });
      }
    }
  });
}

async function handleIncomingMessage(
  sock: WASocket,
  msg: WAMessage,
  chatHistoryService: ChatHistoryService,
  ollamaService: OllamaService,
  personalityService: PersonalityService,
  chatQueues: KeyedAsyncQueue<string>,
  logger: AppLogger,
): Promise<void> {
  const summary = summarizeMessage(msg);
  logger.debug("Handling incoming message", summary);

  if (!msg.message) {
    logger.debug("Ignoring message because it has no message payload", summary);
    return;
  }

  if (msg.key.fromMe) {
    logger.debug("Ignoring message because it was sent by this socket", summary);
    return;
  }

  const chatId = msg.key.remoteJid;
  if (!chatId) {
    logger.debug("Ignoring message because remoteJid is missing", summary);
    return;
  }

  const messageId = msg.key.id;
  if (!messageId) {
    logger.debug("Ignoring message because message id is missing", summary);
    return;
  }

  const botIdentity = getBotIdentity(sock);
  if (botIdentity.jids.length === 0) {
    logger.warn("Received a message before the bot JID was available", {
      socketUser: sock.user,
      authUser: sock.authState.creds.me,
      message: summary,
    });
    return;
  }

  const { text, contextInfo, contentType } = extractMessage(msg.message);
  const incomingText = text.trim();
  const group = isGroupJid(chatId);
  const sender = msg.key.participant ?? msg.key.remoteJid;
  const mentionedJids = contextInfo?.mentionedJid ?? [];
  const trigger = getBotTrigger(group, contextInfo, botIdentity.jids);

  logger.debug("Parsed message", {
    messageId,
    chatId,
    sender,
    botJids: botIdentity.jids,
    botIdentitySources: botIdentity.sources,
    socketUserId: sock.user?.id,
    contentType,
    topLevelContentType: getMessageContentType(msg.message),
    messageKeys: Object.keys(msg.message),
    isGroup: group,
    textLength: incomingText.length,
    text: incomingText,
    contextInfoKeys: contextInfo ? Object.keys(contextInfo) : [],
    quotedParticipant: contextInfo?.participant,
    quotedStanzaId: contextInfo?.stanzaId,
    hasQuotedMessage: Boolean(contextInfo?.quotedMessage),
    mentionedJids,
    trigger,
  });

  if (!incomingText) {
    logger.debug("Ignoring message because no text or caption was extracted", {
      message: summary,
      contentType,
      topLevelContentType: getMessageContentType(msg.message),
    });
    return;
  }

  if (!trigger) {
    if (group && !parseSlashCommand(incomingText)) {
      await rememberIncomingChatHistoryMessage(chatHistoryService, logger, {
        chatId,
        contentType,
        messageId,
        sender,
        senderName: normalizeText(msg.pushName),
        text: incomingText,
        timestamp: getMessageTimestampIso(msg),
      });
    }

    logger.debug("Ignoring message because it did not trigger the bot", {
      messageId,
      chatId,
      isGroup: group,
      botJids: botIdentity.jids,
      botIdentitySources: botIdentity.sources,
      mentionedJids,
      text: incomingText,
    });
    return;
  }

  const prompt = trigger.type === "mention" ? stripBotMentions(incomingText, botIdentity.jids) : incomingText;
  if (!prompt) {
    logger.debug("Ignoring message because prompt is empty after stripping bot mention", {
      messageId,
      chatId,
      incomingText,
      botJids: botIdentity.jids,
    });
    return;
  }

  const command = parseSlashCommand(prompt);
  const quotedMessageContext =
    !command && trigger.type === "mention" ? extractQuotedMessageContext(contextInfo) : undefined;
  const acceptedPromptText = formatPromptWithQuotedMessage(prompt, quotedMessageContext);
  const acceptedPrompt = createAcceptedPrompt({
    chatId,
    sender,
    isGroup: group,
    triggerType: trigger.type,
    prompt: acceptedPromptText,
    messageId,
    parentMessageId: contextInfo?.stanzaId ?? undefined,
    senderName: normalizeText(msg.pushName),
    timestamp: getMessageTimestampIso(msg),
  });

  if (command) {
    logger.info("Accepted command", {
      chatId,
      sender,
      isGroup: group,
      triggerType: trigger.type,
      messageId,
      commandType: command.type,
      promptPreview: previewText(prompt),
    });

    await chatQueues.enqueue(chatId, () =>
      handleSlashCommand(sock, msg, chatHistoryService, ollamaService, personalityService, logger, {
        ...acceptedPrompt,
        command,
      }),
    );
    return;
  }

  await rememberIncomingChatHistoryMessage(chatHistoryService, logger, {
    chatId,
    contentType,
    messageId,
    sender,
    senderName: acceptedPrompt.senderName,
    text: prompt,
    timestamp: acceptedPrompt.timestamp,
  });

  logger.debug("Sending prompt to Ollama", {
    chatId,
    sender,
    isGroup: group,
    triggerType: trigger.type,
    messageId,
    parentMessageId: acceptedPrompt.parentMessageId,
    senderName: acceptedPrompt.senderName,
    quotedMessageContentType: quotedMessageContext?.contentType,
    quotedMessageTextLength: quotedMessageContext?.text.length,
    promptLength: acceptedPrompt.prompt.length,
    prompt: acceptedPrompt.prompt,
  });

  logger.info("Accepted message", {
    chatId,
    sender,
    isGroup: group,
    triggerType: trigger.type,
    messageId,
    hasQuotedMessageContext: Boolean(quotedMessageContext),
    promptLength: acceptedPrompt.prompt.length,
    promptPreview: previewText(acceptedPrompt.prompt),
  });

  await chatQueues.enqueue(chatId, () =>
    generateSendAndRememberReply(sock, msg, chatHistoryService, ollamaService, logger, {
      ...acceptedPrompt,
    }),
  );
}

type AcceptedPrompt = {
  chatId: string;
  sender: string | null | undefined;
  isGroup: boolean;
  triggerType: "mention" | "reply";
  prompt: string;
  messageId: string;
  timestamp: string;
  parentMessageId?: string;
  senderName?: string;
};

type AcceptedCommand = AcceptedPrompt & {
  command: SlashCommand;
};

type AcceptedPromptInput = Omit<AcceptedPrompt, "parentMessageId" | "senderName"> & {
  parentMessageId?: string | undefined;
  senderName?: string | undefined;
};

async function handleSlashCommand(
  sock: WASocket,
  msg: WAMessage,
  chatHistoryService: ChatHistoryService,
  ollamaService: OllamaService,
  personalityService: PersonalityService,
  logger: AppLogger,
  acceptedCommand: AcceptedCommand,
): Promise<void> {
  const { chatId, sender, isGroup, triggerType, command } = acceptedCommand;
  const reply = await createSlashCommandReply(
    chatHistoryService,
    ollamaService,
    personalityService,
    chatId,
    command,
  );

  await sock.sendMessage(chatId, { text: reply }, { quoted: msg });
  logger.info("Handled command", {
    chatId,
    sender,
    isGroup,
    triggerType,
    commandType: command.type,
    quotedMessageId: msg.key.id,
    replyLength: reply.length,
  });
}

async function createSlashCommandReply(
  chatHistoryService: ChatHistoryService,
  ollamaService: OllamaService,
  personalityService: PersonalityService,
  chatId: string,
  command: SlashCommand,
): Promise<string> {
  switch (command.type) {
    case "list-personalities": {
      const currentPersonality = await personalityService.getActivePersonality(chatId);
      return formatPersonalityList(personalityService.listPersonalities(), currentPersonality);
    }
    case "set-personality": {
      const personality = await personalityService.setActivePersonalityByNumber(chatId, command.number);
      if (!personality) {
        return `No personality ${command.number}. Use /personality to see available options.`;
      }

      return `Personality set to ${personality.index}. ${personality.name}`;
    }
    case "invalid-personality":
      return "Invalid personality number. Use /personality to see available options.";
    case "summarize": {
      const messages = await chatHistoryService.getRecentMessages(chatId, command.count);
      if (messages.length === 0) {
        return "No recent chat messages to summarize yet.";
      }

      const summaryOptions: GenerateSummaryOptions = { count: command.count };
      if (command.instructions) {
        summaryOptions.instructions = command.instructions;
      }

      const summary = await ollamaService.generateSummary(chatId, messages, summaryOptions);
      return summary || "I could not generate a summary for those messages.";
    }
    case "invalid-summarize":
      return `Invalid summarize command. Use /summarize <1-${SUMMARY_MESSAGE_LIMIT}> [instructions].`;
    case "unknown":
      return "Unknown command. Available commands: /personality, /summarize";
  }
}

function formatPersonalityList(personalities: readonly Personality[], currentPersonality: Personality): string {
  const personalityLines = personalities.map((personality) => {
    const currentSuffix = personality.id === currentPersonality.id ? " (current)" : "";
    return `${personality.index}. ${personality.name}${currentSuffix}`;
  });

  return ["Personalities:", ...personalityLines, "", "Use /personality <number> to switch."].join("\n");
}

async function generateSendAndRememberReply(
  sock: WASocket,
  msg: WAMessage,
  chatHistoryService: ChatHistoryService,
  ollamaService: OllamaService,
  logger: AppLogger,
  acceptedPrompt: AcceptedPrompt,
): Promise<void> {
  const { chatId, sender, isGroup, triggerType, prompt, messageId, senderName } = acceptedPrompt;
  const threadTarget = await resolveThreadTarget(ollamaService, acceptedPrompt);

  if (!threadTarget) {
    logger.debug("Ignoring reply because quoted message is not in memory", {
      chatId,
      messageId,
      parentMessageId: acceptedPrompt.parentMessageId,
    });
    return;
  }

  const generateOptions: GenerateReplyOptions = { threadId: threadTarget.threadId };
  if (senderName) {
    generateOptions.senderName = senderName;
  }

  const startTime = Date.now();
  const reply = await ollamaService.generateReply(chatId, prompt, generateOptions);
  const elapsedMs = Date.now() - startTime;
  logger.debug("Received Ollama reply", {
    chatId,
    messageId,
    threadId: threadTarget.threadId,
    elapsedMs,
    replyLength: reply.length,
    reply,
  });

  if (!reply) {
    logger.warn("Not sending an empty Ollama reply", {
      chatId,
      messageId,
      threadId: threadTarget.threadId,
    });
    return;
  }

  const sentMessage = await sock.sendMessage(chatId, { text: reply }, { quoted: msg });
  const sentMessageId = sentMessage?.key.id;
  logger.info("Sent reply", {
    chatId,
    sender,
    isGroup,
    triggerType,
    threadId: threadTarget.threadId,
    elapsedMs,
    quotedMessageId: messageId,
    sentMessageId,
    promptLength: prompt.length,
    replyLength: reply.length,
  });

  if (!sentMessageId) {
    logger.warn("Sent reply was not remembered because Baileys did not return a message id", {
      chatId,
      messageId,
      threadId: threadTarget.threadId,
    });
    return;
  }

  await rememberAssistantChatHistoryMessage(chatHistoryService, logger, {
    chatId,
    content: reply,
    id: sentMessageId,
    senderJid: sock.user?.id ?? "bot",
  });

  try {
    await ollamaService.rememberExchange(chatId, {
      threadId: threadTarget.threadId,
      rootMessageId: threadTarget.rootMessageId,
      user: createUserMemoryMessage(acceptedPrompt),
      assistant: createAssistantMemoryMessage({
        id: sentMessageId,
        content: reply,
        parentMessageId: messageId,
      }),
    });
  } catch (error) {
    logger.error("Failed to remember sent reply", {
      chatId,
      messageId,
      sentMessageId,
      threadId: threadTarget.threadId,
      error,
    });
  }
}

async function rememberIncomingChatHistoryMessage(
  chatHistoryService: ChatHistoryService,
  logger: AppLogger,
  input: {
    chatId: string;
    contentType: string | undefined;
    messageId: string;
    sender: string | null | undefined;
    senderName: string | undefined;
    text: string;
    timestamp: string;
  },
): Promise<void> {
  if (!input.sender) {
    return;
  }

  const message: RecentChatMessage = {
    id: input.messageId,
    role: "user",
    text: input.text,
    timestamp: input.timestamp,
    senderJid: input.sender,
    contentType: input.contentType ?? "unknown",
  };

  if (input.senderName) {
    message.senderName = input.senderName;
  }

  await rememberChatHistoryMessage(chatHistoryService, logger, input.chatId, message);
}

async function rememberAssistantChatHistoryMessage(
  chatHistoryService: ChatHistoryService,
  logger: AppLogger,
  input: {
    chatId: string;
    content: string;
    id: string;
    senderJid: string;
  },
): Promise<void> {
  await rememberChatHistoryMessage(chatHistoryService, logger, input.chatId, {
    id: input.id,
    role: "assistant",
    text: input.content,
    timestamp: new Date().toISOString(),
    senderJid: input.senderJid,
    contentType: "conversation",
  });
}

async function rememberChatHistoryMessage(
  chatHistoryService: ChatHistoryService,
  logger: AppLogger,
  chatId: string,
  message: RecentChatMessage,
): Promise<void> {
  try {
    await chatHistoryService.appendMessage(chatId, message);
  } catch (error) {
    logger.error("Failed to remember chat history message", {
      chatId,
      messageId: message.id,
      error,
    });
  }
}

type ThreadTarget = {
  threadId: string;
  rootMessageId: string;
};

function createAcceptedPrompt(input: AcceptedPromptInput): AcceptedPrompt {
  const acceptedPrompt: AcceptedPrompt = {
    chatId: input.chatId,
    sender: input.sender,
    isGroup: input.isGroup,
    triggerType: input.triggerType,
    prompt: input.prompt,
    messageId: input.messageId,
    timestamp: input.timestamp,
  };

  if (input.parentMessageId) {
    acceptedPrompt.parentMessageId = input.parentMessageId;
  }

  if (input.senderName) {
    acceptedPrompt.senderName = input.senderName;
  }

  return acceptedPrompt;
}

async function resolveThreadTarget(
  ollamaService: OllamaService,
  acceptedPrompt: AcceptedPrompt,
): Promise<ThreadTarget | undefined> {
  if (acceptedPrompt.triggerType === "mention") {
    return {
      threadId: acceptedPrompt.messageId,
      rootMessageId: acceptedPrompt.messageId,
    };
  }

  if (!acceptedPrompt.parentMessageId) {
    return undefined;
  }

  const threadId = await ollamaService.getThreadIdForMessage(
    acceptedPrompt.chatId,
    acceptedPrompt.parentMessageId,
  );

  if (!threadId) {
    return undefined;
  }

  return {
    threadId,
    rootMessageId: threadId,
  };
}

function createUserMemoryMessage(acceptedPrompt: AcceptedPrompt): RememberExchangeInput["user"] {
  const message: RememberExchangeInput["user"] = {
    id: acceptedPrompt.messageId,
    content: acceptedPrompt.prompt,
    timestamp: acceptedPrompt.timestamp,
  };

  if (acceptedPrompt.parentMessageId) {
    message.parentMessageId = acceptedPrompt.parentMessageId;
  }

  if (acceptedPrompt.sender) {
    message.senderJid = acceptedPrompt.sender;
  }

  if (acceptedPrompt.senderName) {
    message.senderName = acceptedPrompt.senderName;
  }

  return message;
}

function createAssistantMemoryMessage(input: {
  id: string;
  content: string;
  parentMessageId: string;
}): RememberExchangeInput["assistant"] {
  return {
    id: input.id,
    content: input.content,
    timestamp: new Date().toISOString(),
    parentMessageId: input.parentMessageId,
  };
}

function getMessageTimestampIso(msg: WAMessage): string {
  const timestamp = msg.messageTimestamp?.toString();
  const seconds = timestamp ? Number(timestamp) : NaN;

  if (!Number.isFinite(seconds)) {
    return new Date().toISOString();
  }

  return new Date(seconds * 1000).toISOString();
}

function normalizeText(text: string | null | undefined): string | undefined {
  const trimmedText = text?.trim();
  return trimmedText || undefined;
}

function summarizeMessage(msg: WAMessage): Record<string, unknown> {
  return {
    id: msg.key.id,
    remoteJid: msg.key.remoteJid,
    participant: msg.key.participant,
    fromMe: msg.key.fromMe,
    pushName: msg.pushName,
    messageTimestamp: msg.messageTimestamp?.toString(),
    broadcast: msg.broadcast,
    messageKeys: msg.message ? Object.keys(msg.message) : [],
  };
}
