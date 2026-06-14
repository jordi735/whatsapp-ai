import assert from "node:assert/strict";
import test from "node:test";

import { parseSlashCommand } from "../dist/whatsapp/command-parser.js";

test("parseSlashCommand ignores normal prompts", () => {
  assert.equal(parseSlashCommand("hello there"), undefined);
});

test("parseSlashCommand parses personality list command", () => {
  assert.deepEqual(parseSlashCommand("/personality"), { type: "list-personalities" });
});

test("parseSlashCommand parses personality selection command", () => {
  assert.deepEqual(parseSlashCommand("/personality 5"), { type: "set-personality", number: 5 });
});

test("parseSlashCommand rejects invalid personality arguments", () => {
  assert.deepEqual(parseSlashCommand("/personality nope"), {
    type: "invalid-personality",
    value: "nope",
  });
  assert.deepEqual(parseSlashCommand("/personality 0"), {
    type: "invalid-personality",
    value: "0",
  });
});

test("parseSlashCommand parses unknown slash commands", () => {
  assert.deepEqual(parseSlashCommand("/help"), { type: "unknown", name: "help" });
});
