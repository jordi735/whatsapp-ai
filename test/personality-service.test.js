import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PersonalityService } from "../dist/services/personality-service.js";

test("init loads default prompt and markdown personalities in filename order", async (t) => {
  const config = await createPersonalityConfig(t);
  await writePersonality(config.personalitiesDir, "zeta.md", "Zeta prompt");
  await writePersonality(config.personalitiesDir, "alpha.md", "Alpha prompt");

  const service = new PersonalityService(config);
  await service.init();

  assert.deepEqual(
    service.listPersonalities().map(({ index, name, prompt }) => ({ index, name, prompt })),
    [
      { index: 1, name: "alpha", prompt: "Alpha prompt" },
      { index: 2, name: "zeta", prompt: "Zeta prompt" },
    ],
  );
  assert.equal(service.getDefaultPrompt(), "Default prompt");
  assert.equal((await service.getActivePersonality("chat-a")).name, "alpha");
});

test("setActivePersonalityByNumber persists per-chat selection", async (t) => {
  const config = await createPersonalityConfig(t);
  await writePersonality(config.personalitiesDir, "alpha.md", "Alpha prompt");
  await writePersonality(config.personalitiesDir, "zeta.md", "Zeta prompt");

  const service = new PersonalityService(config);
  await service.init();
  assert.equal((await service.setActivePersonalityByNumber("chat-a", 2))?.name, "zeta");

  const reloadedService = new PersonalityService(config);
  await reloadedService.init();

  assert.equal((await reloadedService.getActivePersonality("chat-a")).name, "zeta");
  assert.equal((await reloadedService.getActivePersonality("chat-b")).name, "alpha");
});

test("setActivePersonalityByNumber returns undefined for an unknown number", async (t) => {
  const config = await createPersonalityConfig(t);
  await writePersonality(config.personalitiesDir, "alpha.md", "Alpha prompt");

  const service = new PersonalityService(config);
  await service.init();

  assert.equal(await service.setActivePersonalityByNumber("chat-a", 2), undefined);
  assert.deepEqual(JSON.parse(await readFile(config.personalitySelectionsFile, "utf8")), {
    chats: {},
  });
});

test("init fails when the default prompt is missing or empty", async (t) => {
  const missingConfig = await createPersonalityConfig(t, { createDefaultPrompt: false });
  await writePersonality(missingConfig.personalitiesDir, "alpha.md", "Alpha prompt");
  await assert.rejects(new PersonalityService(missingConfig).init(), /Default prompt file ".+" was not found/);

  const emptyConfig = await createPersonalityConfig(t, { defaultPrompt: "" });
  await writePersonality(emptyConfig.personalitiesDir, "alpha.md", "Alpha prompt");
  await assert.rejects(new PersonalityService(emptyConfig).init(), /Default prompt file ".+" is empty/);
});

test("init fails when there are no selectable personality markdown files", async (t) => {
  const config = await createPersonalityConfig(t);
  await assert.rejects(new PersonalityService(config).init(), /No personality markdown files/);
});

test("init fails when the default personality is not present", async (t) => {
  const config = await createPersonalityConfig(t, { defaultPersonalityId: "missing" });
  await writePersonality(config.personalitiesDir, "alpha.md", "Alpha prompt");

  await assert.rejects(new PersonalityService(config).init(), /Default personality "missing" was not found/);
});

async function createPersonalityConfig(t, options = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "whatsapp-ai-personalities-"));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  const personalitiesDir = path.join(rootDir, "personalities");
  const defaultPromptFile = path.join(personalitiesDir, "_default.md");
  if (options.createPersonalitiesDir !== false) {
    await mkdir(personalitiesDir, { recursive: true });
    if (options.createDefaultPrompt !== false) {
      await writeFile(defaultPromptFile, `${options.defaultPrompt ?? "Default prompt"}\n`, "utf8");
    }
  }

  return {
    defaultPersonalityId: options.defaultPersonalityId ?? "alpha",
    defaultPromptFile,
    personalitiesDir,
    personalitySelectionsFile: path.join(rootDir, "data", "personality-selections.json"),
  };
}

async function writePersonality(personalitiesDir, filename, prompt) {
  await mkdir(personalitiesDir, { recursive: true });
  await writeFile(path.join(personalitiesDir, filename), `${prompt}\n`, "utf8");
}
