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
import { previewText } from "../utils/text.js";
import { getBotIdentity } from "../whatsapp/bot-identity.js";
import {
  extractMessage,
  getBotTrigger,
  getMessageContentType,
  isGroupJid,
  stripBotMentions,
} from "../whatsapp/message-parser.js";
import type { OllamaService } from "./ollama-service.js";

type WhatsAppServiceConfig = Pick<AppConfig, "authDir" | "baileysLogLevel" | "logLevel">;

type StartWhatsAppServiceOptions = {
  config: WhatsAppServiceConfig;
  ollamaService: OllamaService;
};

export async function startWhatsAppService({
  config,
  ollamaService,
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
        startWhatsAppService({ config, ollamaService }).catch((error) => logger.error("Reconnect failed", error));
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
        await handleIncomingMessage(sock, msg, ollamaService, chatQueues, logger);
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
  ollamaService: OllamaService,
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
  const mentionedJids = contextInfo?.mentionedJid ?? [];
  const trigger = getBotTrigger(group, contextInfo, botIdentity.jids);

  logger.debug("Parsed message", {
    messageId: msg.key.id,
    chatId,
    sender: msg.key.participant ?? msg.key.remoteJid,
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
    logger.debug("Ignoring message because it did not trigger the bot", {
      messageId: msg.key.id,
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
      messageId: msg.key.id,
      chatId,
      incomingText,
      botJids: botIdentity.jids,
    });
    return;
  }

  logger.debug("Sending prompt to Ollama", {
    chatId,
    sender: msg.key.participant ?? msg.key.remoteJid,
    isGroup: group,
    triggerType: trigger.type,
    promptLength: prompt.length,
    prompt,
  });

  logger.info("Accepted message", {
    chatId,
    sender: msg.key.participant ?? msg.key.remoteJid,
    isGroup: group,
    triggerType: trigger.type,
    messageId: msg.key.id,
    promptLength: prompt.length,
    promptPreview: previewText(prompt),
  });

  await chatQueues.enqueue(chatId, () =>
    generateSendAndRememberReply(sock, msg, ollamaService, logger, {
      chatId,
      sender: msg.key.participant ?? msg.key.remoteJid,
      isGroup: group,
      triggerType: trigger.type,
      prompt,
    }),
  );
}

type AcceptedPrompt = {
  chatId: string;
  sender: string | null | undefined;
  isGroup: boolean;
  triggerType: "mention" | "reply";
  prompt: string;
};

async function generateSendAndRememberReply(
  sock: WASocket,
  msg: WAMessage,
  ollamaService: OllamaService,
  logger: AppLogger,
  acceptedPrompt: AcceptedPrompt,
): Promise<void> {
  const { chatId, sender, isGroup, triggerType, prompt } = acceptedPrompt;
  const startTime = Date.now();
  const reply = await ollamaService.generateReply(chatId, prompt);
  const elapsedMs = Date.now() - startTime;
  logger.debug("Received Ollama reply", {
    chatId,
    messageId: msg.key.id,
    elapsedMs,
    replyLength: reply.length,
    reply,
  });

  if (!reply) {
    logger.warn("Not sending an empty Ollama reply", {
      chatId,
      messageId: msg.key.id,
    });
    return;
  }

  await sock.sendMessage(chatId, { text: reply }, { quoted: msg });
  logger.info("Sent reply", {
    chatId,
    sender,
    isGroup,
    triggerType,
    elapsedMs,
    quotedMessageId: msg.key.id,
    promptLength: prompt.length,
    replyLength: reply.length,
  });

  try {
    await ollamaService.rememberExchange(chatId, prompt, reply);
  } catch (error) {
    logger.error("Failed to remember sent reply", {
      chatId,
      messageId: msg.key.id,
      error,
    });
  }
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
