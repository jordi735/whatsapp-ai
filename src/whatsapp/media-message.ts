import { extractMessageContent, type WAContextInfo, type WAMessage, type WAMessageContent } from "baileys";
import sharp from "sharp";

export const DEFAULT_IMAGE_PROMPT = "Analyze the attached image.";
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_LONG_EDGE = 1536;

export type ImageAttachmentInfo = {
  contentType: "imageMessage";
  fileLength?: number;
  height?: number;
  mimeType?: string;
  width?: number;
};

export type PromptImageSource = {
  imageAttachment: ImageAttachmentInfo;
  message: WAMessage;
  source: "current" | "quoted";
};

export type PromptImageSourceInput = {
  chatId: string;
  contextInfo?: WAContextInfo | undefined;
  currentImageAttachment?: ImageAttachmentInfo | undefined;
  currentMessage: WAMessage;
  quotedImageAttachment?: ImageAttachmentInfo | undefined;
  triggerType?: "mention" | "reply" | undefined;
};

export type PreparedImageForVision = {
  bytes: Uint8Array;
  inputByteSize: number;
  outputByteSize: number;
  resized: boolean;
  inputHeight?: number;
  inputWidth?: number;
  outputHeight?: number;
  outputWidth?: number;
};

type PreparedImageForVisionInput = Omit<
  PreparedImageForVision,
  "inputHeight" | "inputWidth" | "outputHeight" | "outputWidth"
> & {
  inputHeight?: number | undefined;
  inputWidth?: number | undefined;
  outputHeight?: number | undefined;
  outputWidth?: number | undefined;
};

export function extractImageAttachmentInfo(
  message: WAMessageContent | undefined | null,
): ImageAttachmentInfo | undefined {
  const imageMessage = extractMessageContent(message)?.imageMessage;

  if (!imageMessage) {
    return undefined;
  }

  const imageInfo: ImageAttachmentInfo = {
    contentType: "imageMessage",
  };
  const fileLength = parseMediaFileLength(imageMessage.fileLength);
  const height = normalizePositiveNumber(imageMessage.height ?? undefined);
  const mimeType = imageMessage.mimetype?.trim();
  const width = normalizePositiveNumber(imageMessage.width ?? undefined);

  if (fileLength !== undefined) {
    imageInfo.fileLength = fileLength;
  }

  if (height !== undefined) {
    imageInfo.height = height;
  }

  if (mimeType) {
    imageInfo.mimeType = mimeType;
  }

  if (width !== undefined) {
    imageInfo.width = width;
  }

  return imageInfo;
}

export function isImageByteSizeTooLarge(byteSize: number | undefined, maxBytes = MAX_IMAGE_BYTES): boolean {
  return byteSize !== undefined && byteSize > maxBytes;
}

export function selectPromptImageSource(input: PromptImageSourceInput): PromptImageSource | undefined {
  if (!input.triggerType) {
    return undefined;
  }

  if (input.currentImageAttachment) {
    return {
      imageAttachment: input.currentImageAttachment,
      message: input.currentMessage,
      source: "current",
    };
  }

  if (input.triggerType !== "mention" || !input.quotedImageAttachment) {
    return undefined;
  }

  const quotedMessage = createQuotedImageMessage(input.contextInfo, input.chatId);
  if (!quotedMessage) {
    return undefined;
  }

  return {
    imageAttachment: input.quotedImageAttachment,
    message: quotedMessage,
    source: "quoted",
  };
}

export async function prepareImageForVision(
  bytes: Uint8Array,
  maxLongEdge = MAX_IMAGE_LONG_EDGE,
): Promise<PreparedImageForVision> {
  const inputByteSize = bytes.byteLength;
  const metadata = await sharp(bytes).metadata();
  const inputWidth = normalizePositiveNumber(metadata.width);
  const inputHeight = normalizePositiveNumber(metadata.height);
  const longestEdge = Math.max(inputWidth ?? 0, inputHeight ?? 0);

  if (longestEdge <= maxLongEdge) {
    return createPreparedImage({
      bytes,
      inputByteSize,
      outputByteSize: inputByteSize,
      resized: false,
      inputHeight,
      inputWidth,
      outputHeight: inputHeight,
      outputWidth: inputWidth,
    });
  }

  const resized = await sharp(bytes)
    .rotate()
    .resize({
      width: maxLongEdge,
      height: maxLongEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toBuffer({ resolveWithObject: true });

  return createPreparedImage({
    bytes: resized.data,
    inputByteSize,
    outputByteSize: resized.data.byteLength,
    resized: true,
    inputHeight,
    inputWidth,
    outputHeight: normalizePositiveNumber(resized.info.height),
    outputWidth: normalizePositiveNumber(resized.info.width),
  });
}

function createQuotedImageMessage(
  contextInfo: WAContextInfo | undefined,
  chatId: string,
): WAMessage | undefined {
  if (!contextInfo?.quotedMessage) {
    return undefined;
  }

  const key: WAMessage["key"] = {
    remoteJid: contextInfo.remoteJid ?? chatId,
  };

  if (contextInfo.stanzaId) {
    key.id = contextInfo.stanzaId;
  }

  if (contextInfo.participant) {
    key.participant = contextInfo.participant;
  }

  return {
    key,
    message: contextInfo.quotedMessage,
  };
}

function parseMediaFileLength(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }

  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }

  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number(value.toString());
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER) {
      return parsed;
    }
  }

  return undefined;
}

function normalizePositiveNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function createPreparedImage(input: PreparedImageForVisionInput): PreparedImageForVision {
  const preparedImage: PreparedImageForVision = {
    bytes: input.bytes,
    inputByteSize: input.inputByteSize,
    outputByteSize: input.outputByteSize,
    resized: input.resized,
  };

  if (input.inputHeight !== undefined) {
    preparedImage.inputHeight = input.inputHeight;
  }

  if (input.inputWidth !== undefined) {
    preparedImage.inputWidth = input.inputWidth;
  }

  if (input.outputHeight !== undefined) {
    preparedImage.outputHeight = input.outputHeight;
  }

  if (input.outputWidth !== undefined) {
    preparedImage.outputWidth = input.outputWidth;
  }

  return preparedImage;
}
