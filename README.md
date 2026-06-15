# WhatsApp AI

A small WhatsApp group bot powered by [Baileys](https://github.com/WhiskeySockets/Baileys) and local [Ollama](https://ollama.com/).

The bot links to a WhatsApp account, listens in group chats, and replies with an Ollama model when someone directly mentions it or replies to one of its remembered messages.

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

Make sure the configured Ollama model is available. The default is `gemma4:e4b`:

```bash
ollama pull gemma4:e4b
```

To analyze WhatsApp images, configure `OLLAMA_MODEL` to a vision-capable Ollama model.

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
OLLAMA_MODEL=gemma4:e4b
OLLAMA_CONTEXT_SIZE=32768
DEFAULT_PERSONALITY=assistant
BAILEYS_LOG_LEVEL=silent
LOG_LEVEL=info
```

- `OLLAMA_MODEL`: Ollama model used for replies. Use a vision-capable model if you want the bot to analyze images.
- `OLLAMA_CONTEXT_SIZE`: optional Ollama context window size, passed as `num_ctx`. Use `32768` for 32k.
- `DEFAULT_PERSONALITY`: default personality id from `personalities/<id>.md`, without the `.md` extension. Startup fails if this file is missing or empty.
- `BAILEYS_LOG_LEVEL`: Baileys internal log level. Keep `silent` unless debugging connection issues.
- `LOG_LEVEL`: app log level: `debug`, `info`, `warn`, `error`, or `silent`.

## Behavior

The bot is group-only. It does not reply to direct messages.

In group chats, it replies when:

- someone directly mentions the bot, or
- someone replies to a remembered message sent by the bot.

If the triggering message contains a WhatsApp photo, the bot sends the current image plus the prompt text to Ollama. If someone mentions the bot while quoting another person’s image, the bot uses that quoted image, the quoted image caption/message, and the mentioner’s request. If the image prompt has no text beyond the bot mention, the bot uses `Analyze the attached image.` as the request. Before sending an image to Ollama, the bot resizes it so the widest edge is at most 1536px and enforces a 5 MB prepared-image limit. Image support is intentionally narrow in this version: it uses one image per prompt, not albums, stickers, videos, documents, or images in `/summarize`.

The bot detects both WhatsApp phone-number JIDs and LID JIDs dynamically from Baileys auth state, so it should keep working if the linked account identity changes.

## Personalities

Character prompts live as markdown files in:

```text
personalities/
```

The shared default prompt lives at:

```text
personalities/_default.md
```

The bot appends `_default.md` to every active personality prompt. Use it for global rules like language, response length, WhatsApp formatting, and safety behavior. This file is required at startup.

The bot loads other non-empty `*.md` files on startup, sorts them by filename, and uses the filename without `.md` as the personality name. `_default.md` is not selectable with `/personality`. With the bundled prompts, the command order is:

```text
1. alex-jones
2. assistant
3. dr-manhattan
4. rich-piana
```

Adding or renaming personality files can change the numbers shown by `/personality`. The active personality is stored per WhatsApp group in:

```text
data/personality-selections.json
```

Use slash commands in a group by mentioning the bot or replying to one of its remembered messages:

```text
/personality
/personality 2
/summarize 20
/summarize 20 only bullet points
```

- `/personality`: shows numbered personalities and marks the current one.
- `/personality <number>`: sets that group's active personality.
- `/summarize <number>`: summarizes up to the last `<number>` tracked messages in the group.
- `/summarize <number> <instructions>`: summarizes those messages with extra guidance, such as bullet points or a sentence limit.

Command replies are operational bot replies, not Ollama/personality responses. Any prompted text that starts with `/` is treated as a command; unknown slash commands do not fall through to Ollama.

## Memory

Conversation memory is stored in:

```text
data/memory.json
```

The current implementation keeps short versioned per-thread histories in JSON. Mentioning the bot starts a new thread keyed by that message. Replying to a remembered bot message continues that thread; replying to an old or unremembered bot message is ignored.

Invalid or legacy memory files reset to an empty store. Delete `data/memory.json` to reset memory manually.

Summary history is stored separately in:

```text
data/chat-history.json
```

The summary history keeps up to 1000 recent non-command text or caption messages per group. It includes normal user messages and normal Ollama replies, but excludes slash command invocations and slash command replies. Invalid or legacy summary history files reset to an empty store. Delete `data/chat-history.json` to reset summary history manually.

Image bytes are transient. They are downloaded from WhatsApp for the active request, sent to the configured local Ollama service, and not stored in `data/memory.json` or `data/chat-history.json`.

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
- `npm test`: build, then run Node's built-in test runner over `test/**/*.test.js`.

## Logging

At `LOG_LEVEL=info`, the bot logs lifecycle events, accepted messages, and sent replies.

Use debug logging when diagnosing trigger detection:

```env
LOG_LEVEL=debug
```

Debug logs include parsed message details, mention/reply matching, bot identity candidates, ignored-message reasons, full prompts, full Ollama replies, sender IDs, push names, auth identity details, and message metadata. Image bytes, base64 payloads, and WhatsApp media URLs are not logged.
