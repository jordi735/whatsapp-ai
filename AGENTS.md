# Repository Guidelines

## Project Structure & Module Organization

This is a Node.js 20+ TypeScript project that runs as an ES module app. Source lives in `src/`, with `src/index.ts` as the entry point. Configuration is centralized in `src/config.ts`. Long-lived integrations belong in `src/services/` (`whatsapp-service`, `ollama-service`, `memory-service`, `chat-history-service`, `personality-service`), WhatsApp parsing, slash command parsing, and identity helpers belong in `src/whatsapp/`, and shared helpers belong in `src/utils/`.

Prompt files live in `personalities/`. Treat `personalities/_default.md` as required shared instructions, and treat other non-empty `*.md` files as selectable personalities whose filename stems are used as personality IDs.

Generated or local runtime state is not source: `dist/` is compiler output, `auth/` stores Baileys login credentials, and `data/` stores local memory, summary chat history, plus per-chat personality selections. Keep `.env` private and update `.env.example` when adding new settings.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run build`: compile TypeScript from `src/` into `dist/`.
- `npm start`: build, then run `node dist/index.js`.
- `npm test`: build, then run Node's built-in test runner over `test/**/*.test.js`.

Run Ollama locally with the model configured by `OLLAMA_MODEL` before starting the bot. `DEFAULT_PERSONALITY` must match a selectable `personalities/<id>.md` filename stem. On first WhatsApp startup, scan the terminal QR code to create `auth/`.

## Coding Style & Naming Conventions

Use strict TypeScript and ES module imports. Because `tsconfig.json` uses `module: "nodenext"`, local imports should include `.js` extensions, for example `import { loadConfig } from "./config.js"`.

Follow the existing style: two-space indentation, double quotes, semicolons, `camelCase` functions and variables, `PascalCase` classes and types, and kebab-case filenames such as `memory-service.ts`. Keep service boundaries clear and prefer small pure helpers in `src/utils/` or `src/whatsapp/` when logic is easy to test independently.

## Testing Guidelines

Use `npm test` as the minimum pre-commit check. Tests are JavaScript files under `test/` that use `node:test` and import compiled modules from `dist/`, so the build step is part of test execution. Name tests as `*.test.js` files that mirror the module under test, such as `message-parser.test.js`.

Prioritize pure parsing, slash command parsing, personality loading and selection, threaded memory, persistent summary chat history, reply-thread resolution, Ollama prompt composition, and error-handling logic before integration tests that require WhatsApp or Ollama.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, for example `Add environment example` and `Build WhatsApp Ollama group bot`. Keep that pattern: capitalized, present tense, and focused on one change.

Pull requests should include a brief description, testing performed (`npm test`, manual WhatsApp/Ollama check), configuration changes, and any screenshots or logs that clarify QR/login or message-flow behavior. Link related issues when available.

## Security & Configuration Tips

Never commit `.env`, `auth/`, `data/`, chat memory, summary chat history, or personality selection state. Avoid logging full message contents unless needed for debugging, and prefer `.env.example` placeholders over real model names, phone numbers, tokens, or JIDs. Be aware that debug logging can include full prompts, full replies, sender identifiers, push names, auth identity details, and message metadata.
