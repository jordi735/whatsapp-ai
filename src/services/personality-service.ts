import { type Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "../config.js";
import { AsyncQueue } from "../utils/async-queue.js";
import { isNodeError } from "../utils/errors.js";

export type Personality = {
  id: string;
  index: number;
  name: string;
  filePath: string;
  prompt: string;
};

export type PersonalitySelectionStore = {
  chats: Record<string, string>;
};

type PersonalityConfig = Pick<
  AppConfig,
  "defaultPersonalityId" | "defaultPromptFile" | "personalitiesDir" | "personalitySelectionsFile"
>;

export class PersonalityService {
  private readonly queue = new AsyncQueue();
  private readonly selectionsDir: string;
  private defaultPrompt = "";
  private personalities: Personality[] = [];
  private personalitiesById = new Map<string, Personality>();

  constructor(private readonly config: PersonalityConfig) {
    this.selectionsDir = path.dirname(config.personalitySelectionsFile);
  }

  async init(): Promise<void> {
    await this.loadDefaultPrompt();
    await this.loadPersonalities();
    await this.queue.enqueue(() => this.readSelections());
  }

  getDefaultPrompt(): string {
    return this.defaultPrompt;
  }

  listPersonalities(): readonly Personality[] {
    return this.personalities;
  }

  async getActivePersonality(chatId: string): Promise<Personality> {
    return this.queue.enqueue(async () => {
      const selections = await this.readSelections();
      const selectedPersonalityId = selections.chats[chatId];

      if (selectedPersonalityId) {
        const selectedPersonality = this.personalitiesById.get(selectedPersonalityId);
        if (selectedPersonality) {
          return selectedPersonality;
        }
      }

      return this.getDefaultPersonality();
    });
  }

  async setActivePersonalityByNumber(chatId: string, personalityNumber: number): Promise<Personality | undefined> {
    const personality = this.personalities[personalityNumber - 1];
    if (!personality) {
      return undefined;
    }

    await this.queue.enqueue(async () => {
      const selections = await this.readSelections();
      selections.chats[chatId] = personality.id;
      await this.writeSelections(selections);
    });

    return personality;
  }

  getDefaultPersonality(): Personality {
    const defaultPersonality = this.personalitiesById.get(this.config.defaultPersonalityId);
    if (!defaultPersonality) {
      throw new Error(
        `Default personality "${this.config.defaultPersonalityId}" was not found in ${this.config.personalitiesDir}.`,
      );
    }

    return defaultPersonality;
  }

  private async loadDefaultPrompt(): Promise<void> {
    try {
      const prompt = (await readFile(this.config.defaultPromptFile, "utf8")).trim();
      if (!prompt) {
        throw new Error(`Default prompt file "${this.config.defaultPromptFile}" is empty.`);
      }

      this.defaultPrompt = prompt;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new Error(`Default prompt file "${this.config.defaultPromptFile}" was not found.`);
      }

      throw error;
    }
  }

  private async loadPersonalities(): Promise<void> {
    const entries = await this.readPersonalityEntries();
    const defaultPromptFilename = path.basename(this.config.defaultPromptFile);
    const markdownEntries = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== defaultPromptFilename)
      .sort((left, right) => left.name.localeCompare(right.name));

    if (markdownEntries.length === 0) {
      throw new Error(`No personality markdown files found in ${this.config.personalitiesDir}.`);
    }

    const personalities = await Promise.all(
      markdownEntries.map(async (entry, index) => {
        const filePath = path.join(this.config.personalitiesDir, entry.name);
        const prompt = (await readFile(filePath, "utf8")).trim();
        const name = path.basename(entry.name, ".md");

        if (!prompt) {
          throw new Error(`Personality "${name}" in ${filePath} is empty.`);
        }

        return {
          id: name,
          index: index + 1,
          name,
          filePath,
          prompt,
        };
      }),
    );

    this.personalities = personalities;
    this.personalitiesById = new Map(personalities.map((personality) => [personality.id, personality]));
    this.getDefaultPersonality();
  }

  private async readPersonalityEntries(): Promise<Dirent[]> {
    try {
      return await readdir(this.config.personalitiesDir, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new Error(`No personality markdown files found in ${this.config.personalitiesDir}.`);
      }

      throw error;
    }
  }

  private async readSelections(): Promise<PersonalitySelectionStore> {
    await mkdir(this.selectionsDir, { recursive: true });

    try {
      const raw = await readFile(this.config.personalitySelectionsFile, "utf8");
      const parsed = JSON.parse(raw) as Partial<PersonalitySelectionStore>;

      if (!parsed.chats || typeof parsed.chats !== "object") {
        return this.resetSelections();
      }

      return { chats: parsed.chats as Record<string, string> };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return this.resetSelections();
      }

      throw error;
    }
  }

  private async resetSelections(): Promise<PersonalitySelectionStore> {
    const emptySelections: PersonalitySelectionStore = { chats: {} };
    await this.writeSelections(emptySelections);
    return emptySelections;
  }

  private async writeSelections(selections: PersonalitySelectionStore): Promise<void> {
    await mkdir(this.selectionsDir, { recursive: true });
    await writeFile(this.config.personalitySelectionsFile, `${JSON.stringify(selections, null, 2)}\n`, "utf8");
  }
}
