# Repository Guidelines

## Project Structure & Module Organization

This is a Node.js 20+ TypeScript project that runs as an ES module app. Source lives in `src/`, with `src/index.ts` as the entry point and `src/config.ts` as the centralized configuration loader. Long-lived integrations belong in `src/services/` (`whatsapp-service`, `ollama-service`, `memory-service`, `chat-history-service`, `personality-service`), WhatsApp parsing, slash command parsing, image/media preparation, and identity helpers belong in `src/whatsapp/`, and shared helpers belong in `src/utils/`.

Prompt files live in `personalities/`. Treat `personalities/_default.md` as required shared instructions, and treat other non-empty `*.md` files as selectable personalities whose filename stems are used as personality IDs. Adding or renaming selectable personality files can change `/personality` numbering because prompts are sorted by filename.

Generated or local runtime state is not source: `dist/` is compiler output, `auth/` stores Baileys login credentials, and `data/` stores local memory, summary chat history, plus per-chat personality selections. Keep `.env` private.

## Build, Test, and Development Commands

Use npm and the scripts in `package.json` as the command source of truth.

- `npm install`: install dependencies from `package-lock.json`.
- `npm run build`: compile TypeScript from `src/` into `dist/`.
- `npm start`: build, then run `node dist/index.js`.
- `npm test`: build, then run Node's built-in test runner over `test/**/*.test.js`.

Run Ollama locally with the model configured by `OLLAMA_MODEL` before starting the bot. Use a vision-capable model when image prompts should be analyzed. If `OLLAMA_CONTEXT_SIZE` is set, it must be a positive integer and is passed to Ollama as `num_ctx`. `DEFAULT_PERSONALITY` must match a non-empty selectable `personalities/<id>.md` filename stem. On first WhatsApp startup, scan the terminal QR code to create `auth/`; deleting `auth/` forces a fresh link.

Image prompts require `OLLAMA_MODEL` to be vision-capable. WhatsApp images are downloaded only for accepted prompts, resized with `sharp` so the widest edge is at most 1536px, capped at 5 MB after preparation, and passed transiently to Ollama. Keep this image pipeline in `src/whatsapp/media-message.ts` and the socket/download orchestration in `src/services/whatsapp-service.ts`.

## Coding Style & Naming Conventions

Use strict TypeScript and ES module imports. Because `tsconfig.json` uses `module: "nodenext"`, local imports should include `.js` extensions, for example `import { loadConfig } from "./config.js"`.

Follow the existing style: two-space indentation, double quotes, semicolons, `camelCase` functions and variables, `PascalCase` classes and types, and kebab-case filenames such as `memory-service.ts`. Keep service boundaries clear and prefer small pure helpers in `src/utils/` or `src/whatsapp/` when logic is easy to test independently.

## Runtime Behavior Notes

The bot is group-only. It ignores direct messages and replies only when someone directly mentions the bot or replies to a remembered bot message. Replies to old or unremembered bot messages are ignored.

Slash commands are parsed before Ollama. Any triggered prompt beginning with `/` is handled as a command, and unknown slash commands do not fall through to model generation. Current commands include `/personality` for per-group personality selection and `/summarize <number>` for summaries of recent tracked group messages.

Image support intentionally uses one image per accepted prompt, not albums, stickers, videos, documents, or images in `/summarize`. Summary history is separate from threaded reply memory; image bytes are transient and are not stored in `data/memory.json` or `data/chat-history.json`.

## Testing Guidelines

Use `npm test` as the standard local validation command. Tests are JavaScript files under `test/` that use `node:test` and import compiled modules from `dist/`, so the build step is part of test execution. Name tests as `*.test.js` files that mirror the module under test, such as `message-parser.test.js`.

Prioritize pure parsing, slash command parsing, image/media selection and preparation, personality loading and selection, threaded memory, persistent summary chat history, reply-thread resolution, Ollama prompt composition, and error-handling logic before integration tests that require WhatsApp or Ollama. There is currently no configured lint, format, separate typecheck, or CI command in this checkout; do not cite one unless the manifest or CI files are added.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, for example `Normalize default response style`, `Update example Ollama model`, and `Add configurable Ollama context size`. Keep that pattern: capitalized, present tense, and focused on one change.

Pull requests should include a brief description, testing performed, and relevant configuration or environment changes. Include manual WhatsApp/Ollama checks when bot runtime behavior is affected. If screenshots or logs clarify QR/login or message-flow behavior, redact sender identifiers, push names, auth identity details, message metadata, full prompts, full replies, and any media URLs or payloads.

## Security & Configuration Tips

Runtime configuration comes from `.env`, loaded through `dotenv/config`. Supported keys are `OLLAMA_MODEL`, `OLLAMA_CONTEXT_SIZE`, `DEFAULT_PERSONALITY`, `BAILEYS_LOG_LEVEL`, and `LOG_LEVEL`. When adding or changing environment variables or sample defaults, update `src/config.ts`, `.env.example`, and README configuration docs together.

Use `.env.example` only for non-secret sample values. Never commit `.env`, `auth/`, `data/`, chat memory, summary chat history, personality selection state, downloaded image bytes, phone numbers, tokens, JIDs, private identifiers, or debug logs.

Keep `BAILEYS_LOG_LEVEL=silent` and `LOG_LEVEL=info` for normal use. Use debug logging only for diagnostics because it can include full prompts, full replies, sender identifiers, push names, auth identity details, and message metadata. Image bytes, base64 payloads, media keys, direct paths, and WhatsApp media URLs must not be logged.
