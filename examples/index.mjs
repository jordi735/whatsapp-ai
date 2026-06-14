import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
} from "baileys";

import P from "pino";
import QRCode from "qrcode";

const AUTH_DIR = "./auth";

// Super simpele text extractor.
// Genoeg voor normale tekstberichten en captions.
function getText(message) {
  return (
    message?.conversation ||
    message?.extendedTextMessage?.text ||
    message?.imageMessage?.caption ||
    message?.videoMessage?.caption ||
    ""
  );
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    logger: P({ level: "silent" }),
    markOnlineOnConnect: false,

    // Voor deze test mag dit undefined returnen.
    // In productie zou je berichten opslaan en hier kunnen terughalen.
    getMessage: async () => undefined,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\nScan deze QR met WhatsApp > Linked devices:\n");
      console.log(await QRCode.toString(qr, { type: "terminal", small: true }));
    }

    if (connection === "open") {
      console.log("Connected.");
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log("Connection closed:", statusCode);

      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        console.log("Reconnecting...");
        start().catch(console.error);
      } else {
        console.log("Logged out. Delete ./auth and scan again.");
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message) continue;
      if (msg.key.fromMe) continue;

      const chatId = msg.key.remoteJid;
      const sender = msg.key.participant || msg.key.remoteJid;
      const text = getText(msg.message).trim();

      console.log({
        chatId,
        sender,
        text,
        isGroup: chatId?.endsWith("@g.us"),
      });

      // Alleen in groepen reageren op !ping
      if (chatId?.endsWith("@g.us") && text === "!ping") {
        await sock.sendMessage(
          chatId,
          { text: "pong" },
          { quoted: msg }
        );
      }

      // In 1-op-1 chats kun je eventueel ook testen:
      if (!chatId?.endsWith("@g.us") && text === "!ping") {
        await sock.sendMessage(
          chatId,
          { text: "pong" },
          { quoted: msg }
        );
      }
    }
  });
}

start().catch(console.error);