# WhatsApp AI

A small WhatsApp group bot powered by [Baileys](https://github.com/WhiskeySockets/Baileys) and local [Ollama](https://ollama.com/).

The bot links to a WhatsApp account, listens in group chats, and replies with an Ollama model when someone directly mentions it or replies to one of its messages.

## Requirements

- Node.js 20+
- npm
- Ollama running locally
- A WhatsApp account that can be linked as a device

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Make sure the configured Ollama model is available. The default is `phi`:

```bash
ollama pull phi
```

Start the bot:

```bash
npm start
```

On first run, scan the QR code in the terminal with WhatsApp:

```text
WhatsApp > Linked devices > Link a device
```

## Configuration

Environment variables:

```env
OLLAMA_MODEL=phi
BAILEYS_LOG_LEVEL=silent
LOG_LEVEL=info
```

- `OLLAMA_MODEL`: Ollama model used for replies.
- `BAILEYS_LOG_LEVEL`: Baileys internal log level. Keep `silent` unless debugging connection issues.
- `LOG_LEVEL`: app log level: `debug`, `info`, `warn`, `error`, or `silent`.

## Behavior

The bot is group-only. It does not reply to direct messages.

In group chats, it replies when:

- someone directly mentions the bot, or
- someone replies to a message sent by the bot.

The bot detects both WhatsApp phone-number JIDs and LID JIDs dynamically from Baileys auth state, so it should keep working if the linked account identity changes.

## Memory

Conversation memory is stored in:

```text
data/memory.json
```

The current implementation keeps a short per-chat history in JSON. Delete `data/memory.json` to reset memory.

## Auth State

WhatsApp auth credentials are stored in:

```text
auth/
```

Delete `auth/` if you need to link the WhatsApp account again from scratch.

## Scripts

```bash
npm run build
npm start
npm test
```

- `npm run build`: compile TypeScript into `dist/`.
- `npm start`: build and run the bot.
- `npm test`: currently runs the TypeScript build.

## Logging

At `LOG_LEVEL=info`, the bot logs lifecycle events, accepted messages, and sent replies.

Use debug logging when diagnosing trigger detection:

```env
LOG_LEVEL=debug
```

Debug logs include parsed message details, mention/reply matching, bot identity candidates, and ignored-message reasons.
