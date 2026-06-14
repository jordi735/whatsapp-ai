# Repository Guidelines

## Project Structure & Module Organization

This is a Node.js 20+ TypeScript project that runs as an ES module app. Source lives in `src/`, with `src/index.ts` as the entry point. Configuration is centralized in `src/config.ts`. Long-lived integrations belong in `src/services/` (`whatsapp-service`, `ollama-service`, `memory-service`), WhatsApp parsing and identity helpers belong in `src/whatsapp/`, and shared helpers belong in `src/utils/`.

Generated or local runtime state is not source: `dist/` is compiler output, `auth/` stores Baileys login credentials, and `data/` stores local memory. Keep `.env` private and update `.env.example` when adding new settings.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run build`: compile TypeScript from `src/` into `dist/`.
- `npm start`: build, then run `node dist/index.js`.
- `npm test`: currently aliases `npm run build`, so it verifies type safety and compilation.

Run Ollama locally with the model configured by `OLLAMA_MODEL` before starting the bot. On first WhatsApp startup, scan the terminal QR code to create `auth/`.

## Coding Style & Naming Conventions

Use strict TypeScript and ES module imports. Because `tsconfig.json` uses `module: "nodenext"`, local imports should include `.js` extensions, for example `import { loadConfig } from "./config.js"`.

Follow the existing style: two-space indentation, double quotes, semicolons, `camelCase` functions and variables, `PascalCase` classes and types, and kebab-case filenames such as `memory-service.ts`. Keep service boundaries clear and prefer small pure helpers in `src/utils/` or `src/whatsapp/` when logic is easy to test independently.

## Testing Guidelines

There is no dedicated test runner yet. Treat `npm test` as the minimum pre-commit check. When adding behavioral tests, add a real test script and use `*.test.ts` names that mirror the module under test, such as `message-parser.test.ts`. Prioritize pure parsing, trigger, memory, and error-handling logic before integration tests that require WhatsApp or Ollama.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, for example `Add environment example` and `Build WhatsApp Ollama group bot`. Keep that pattern: capitalized, present tense, and focused on one change.

Pull requests should include a brief description, testing performed (`npm test`, manual WhatsApp/Ollama check), configuration changes, and any screenshots or logs that clarify QR/login or message-flow behavior. Link related issues when available.

## Security & Configuration Tips

Never commit `.env`, `auth/`, `data/`, or chat memory. Avoid logging full message contents unless needed for debugging, and prefer `.env.example` placeholders over real model names, phone numbers, tokens, or JIDs.
