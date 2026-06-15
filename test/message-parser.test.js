import assert from "node:assert/strict";
import test from "node:test";

import {
  extractMessage,
  extractQuotedMessageContext,
  formatPromptWithQuotedMessage,
  getBotTrigger,
} from "../dist/whatsapp/message-parser.js";

const botJid = "12345@s.whatsapp.net";

test("extractMessage reads top-level document captions and mention context", () => {
  const contextInfo = { mentionedJid: [botJid] };
  const message = {
    documentMessage: {
      caption: "@12345 summarize this",
      contextInfo,
    },
  };

  const extracted = extractMessage(message);

  assert.equal(extracted.text, "@12345 summarize this");
  assert.equal(extracted.contextInfo, contextInfo);
  assert.equal(extracted.contentType, "documentMessage");
  assert.equal(getBotTrigger(true, extracted.contextInfo, [botJid])?.type, "mention");
});

test("extractMessage reads wrapped document captions", () => {
  const message = {
    documentWithCaptionMessage: {
      message: {
        documentMessage: {
          caption: "wrapped document caption",
        },
      },
    },
  };

  const extracted = extractMessage(message);

  assert.equal(extracted.text, "wrapped document caption");
  assert.equal(extracted.contentType, "documentMessage");
});

test("extractMessage reads document reply context", () => {
  const contextInfo = {
    participant: botJid,
    quotedMessage: { conversation: "previous bot reply" },
  };
  const message = {
    documentMessage: {
      caption: "follow-up with attachment",
      contextInfo,
    },
  };

  const extracted = extractMessage(message);

  assert.equal(extracted.text, "follow-up with attachment");
  assert.equal(getBotTrigger(true, extracted.contextInfo, [botJid])?.type, "reply");
});

test("extractQuotedMessageContext reads quoted conversation text", () => {
  assert.deepEqual(
    extractQuotedMessageContext({
      stanzaId: "quoted-1",
      participant: "alice@s.whatsapp.net",
      quotedMessage: { conversation: " what is the weather today? " },
    }),
    {
      text: "what is the weather today?",
      contentType: "conversation",
      stanzaId: "quoted-1",
      participant: "alice@s.whatsapp.net",
    },
  );
});

test("extractQuotedMessageContext reads quoted extended text and media captions", () => {
  assert.equal(
    extractQuotedMessageContext({
      quotedMessage: {
        extendedTextMessage: {
          text: "should I bring an umbrella?",
        },
      },
    })?.text,
    "should I bring an umbrella?",
  );
  assert.deepEqual(
    extractQuotedMessageContext({
      quotedMessage: {
        imageMessage: {
          caption: "clouds over the city",
        },
      },
    }),
    {
      text: "clouds over the city",
      contentType: "imageMessage",
      stanzaId: undefined,
      participant: undefined,
    },
  );
});

test("extractQuotedMessageContext ignores blank or non-text quotes", () => {
  assert.equal(
    extractQuotedMessageContext({
      quotedMessage: { conversation: "   " },
    }),
    undefined,
  );
  assert.equal(
    extractQuotedMessageContext({
      quotedMessage: { imageMessage: {} },
    }),
    undefined,
  );
});

test("formatPromptWithQuotedMessage includes quoted context when present", () => {
  assert.equal(
    formatPromptWithQuotedMessage("can you answer that?", {
      text: "what is the weather today?",
      contentType: "conversation",
      stanzaId: "quoted-1",
      participant: "alice@s.whatsapp.net",
    }),
    [
      "Quoted WhatsApp message:",
      "what is the weather today?",
      "",
      "User request:",
      "can you answer that?",
    ].join("\n"),
  );
  assert.equal(formatPromptWithQuotedMessage("can you answer that?", undefined), "can you answer that?");
});
