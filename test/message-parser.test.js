import assert from "node:assert/strict";
import test from "node:test";

import { extractMessage, getBotTrigger } from "../dist/whatsapp/message-parser.js";

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
