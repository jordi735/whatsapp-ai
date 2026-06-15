import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import {
  DEFAULT_IMAGE_PROMPT,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_LONG_EDGE,
  extractImageAttachmentInfo,
  isImageByteSizeTooLarge,
  prepareImageForVision,
  selectPromptImageSource,
} from "../dist/whatsapp/media-message.js";

test("extractImageAttachmentInfo reads current image metadata", () => {
  assert.deepEqual(
    extractImageAttachmentInfo({
      imageMessage: {
        mimetype: "image/jpeg",
        fileLength: 1234,
        height: 480,
        width: 640,
      },
    }),
    {
      contentType: "imageMessage",
      fileLength: 1234,
      height: 480,
      mimeType: "image/jpeg",
      width: 640,
    },
  );
});

test("extractImageAttachmentInfo reads wrapped view-once images", () => {
  assert.deepEqual(
    extractImageAttachmentInfo({
      viewOnceMessageV2: {
        message: {
          imageMessage: {
            mimetype: "image/png",
            fileLength: { toString: () => "2048" },
          },
        },
      },
    }),
    {
      contentType: "imageMessage",
      fileLength: 2048,
      mimeType: "image/png",
    },
  );
});

test("extractImageAttachmentInfo ignores unsupported media", () => {
  assert.equal(
    extractImageAttachmentInfo({
      documentMessage: {
        mimetype: "image/jpeg",
        fileLength: 1234,
      },
    }),
    undefined,
  );
});

test("selectPromptImageSource selects the current image first", () => {
  const currentMessage = {
    key: { id: "current-1", remoteJid: "chat@g.us" },
    message: {
      imageMessage: {
        mimetype: "image/jpeg",
      },
    },
  };
  const currentImageAttachment = extractImageAttachmentInfo(currentMessage.message);
  const quotedImageAttachment = extractImageAttachmentInfo({
    imageMessage: {
      mimetype: "image/png",
    },
  });

  const selected = selectPromptImageSource({
    chatId: "chat@g.us",
    currentImageAttachment,
    currentMessage,
    quotedImageAttachment,
    triggerType: "mention",
  });

  assert.equal(selected?.source, "current");
  assert.equal(selected?.message, currentMessage);
});

test("selectPromptImageSource selects quoted images for mentions", () => {
  const quotedMessage = {
    imageMessage: {
      caption: "yellow banana",
      mimetype: "image/jpeg",
    },
  };
  const quotedImageAttachment = extractImageAttachmentInfo(quotedMessage);

  const selected = selectPromptImageSource({
    chatId: "chat@g.us",
    contextInfo: {
      participant: "alice@s.whatsapp.net",
      quotedMessage,
      stanzaId: "quoted-1",
    },
    currentMessage: {
      key: { id: "current-1", remoteJid: "chat@g.us" },
      message: {
        extendedTextMessage: {
          text: "@12345 what color is this?",
        },
      },
    },
    quotedImageAttachment,
    triggerType: "mention",
  });

  assert.equal(selected?.source, "quoted");
  assert.deepEqual(selected?.message.key, {
    id: "quoted-1",
    participant: "alice@s.whatsapp.net",
    remoteJid: "chat@g.us",
  });
  assert.equal(selected?.message.message, quotedMessage);
});

test("selectPromptImageSource ignores quoted images without a mention trigger", () => {
  const quotedMessage = {
    imageMessage: {
      mimetype: "image/jpeg",
    },
  };

  assert.equal(
    selectPromptImageSource({
      chatId: "chat@g.us",
      contextInfo: {
        quotedMessage,
        stanzaId: "quoted-1",
      },
      currentMessage: {
        key: { id: "current-1", remoteJid: "chat@g.us" },
        message: {
          extendedTextMessage: {
            text: "what color is this?",
          },
        },
      },
      quotedImageAttachment: extractImageAttachmentInfo(quotedMessage),
    }),
    undefined,
  );
  assert.equal(
    selectPromptImageSource({
      chatId: "chat@g.us",
      contextInfo: {
        quotedMessage,
        stanzaId: "quoted-1",
      },
      currentMessage: {
        key: { id: "current-1", remoteJid: "chat@g.us" },
        message: {
          extendedTextMessage: {
            text: "thread follow-up",
          },
        },
      },
      quotedImageAttachment: extractImageAttachmentInfo(quotedMessage),
      triggerType: "reply",
    }),
    undefined,
  );
});

test("isImageByteSizeTooLarge enforces the v1 byte cap", () => {
  assert.equal(DEFAULT_IMAGE_PROMPT, "Analyze the attached image.");
  assert.equal(isImageByteSizeTooLarge(undefined), false);
  assert.equal(isImageByteSizeTooLarge(MAX_IMAGE_BYTES), false);
  assert.equal(isImageByteSizeTooLarge(MAX_IMAGE_BYTES + 1), true);
});

test("prepareImageForVision resizes images to the maximum long edge", async () => {
  const source = await sharp({
    create: {
      width: 2000,
      height: 1000,
      channels: 3,
      background: "#facc15",
    },
  })
    .jpeg()
    .toBuffer();

  const prepared = await prepareImageForVision(source);
  const metadata = await sharp(prepared.bytes).metadata();

  assert.equal(prepared.resized, true);
  assert.equal(prepared.inputWidth, 2000);
  assert.equal(prepared.inputHeight, 1000);
  assert.equal(prepared.outputWidth, MAX_IMAGE_LONG_EDGE);
  assert.equal(prepared.outputHeight, 768);
  assert.equal(metadata.width, MAX_IMAGE_LONG_EDGE);
  assert.equal(metadata.height, 768);
  assert.equal(Math.max(metadata.width ?? 0, metadata.height ?? 0), MAX_IMAGE_LONG_EDGE);
});

test("prepareImageForVision does not enlarge images already under the limit", async () => {
  const source = await sharp({
    create: {
      width: 640,
      height: 320,
      channels: 3,
      background: "#22c55e",
    },
  })
    .jpeg()
    .toBuffer();

  const prepared = await prepareImageForVision(source);

  assert.equal(prepared.resized, false);
  assert.equal(prepared.inputWidth, 640);
  assert.equal(prepared.inputHeight, 320);
  assert.equal(prepared.outputWidth, 640);
  assert.equal(prepared.outputHeight, 320);
  assert.equal(prepared.outputByteSize, source.byteLength);
});
