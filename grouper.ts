import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface TrendItem {
  title: string;
  description?: string;
  source: string;
  url?: string;
  volume?: number;
  volumeLabel?: string;
  category?: string;
  relatedTerms?: string[];
  timestamp?: string;
}

export interface TrendGroup {
  label: string;
  description: string;
  items: number[]; // indices into the flat list
}

// ---------------------------------------------------------------------------
// Group trends via LLM
// ---------------------------------------------------------------------------
export async function groupTrends(trends: TrendItem[]): Promise<TrendGroup[]> {
  if (trends.length === 0) return [];

  // Build a compact list for the LLM — index + title + source + volume
  const compact = trends.map((t, i) => {
    const vol = t.volume ? ` (${t.volume.toLocaleString()})` : "";
    return `${i}. [${t.source}]${vol} ${t.title}`;
  }).join("\n");

  const promptPath = join(ROOT, "skills", "trends", "GROUPER.md");
  const systemPrompt = readFileSync(promptPath, "utf-8");

  const authPath = join(ROOT, ".auth.json");
  if (!existsSync(authPath)) {
    const token = process.env.ANTHROPIC_OAUTH_REFRESH_TOKEN;
    if (!token) throw new Error("No auth");
    writeFileSync(authPath, JSON.stringify({
      anthropic: { type: "oauth", refresh: token, access: "", expires: 0 },
    }));
  }

  const authStorage = AuthStorage.create(authPath);
  const modelRegistry = new ModelRegistry(authStorage);
  const model = modelRegistry.find("anthropic", "claude-haiku-4-5-20251001");
  if (!model) throw new Error("Model not found");

  const resourceLoader = new DefaultResourceLoader({
    cwd: ROOT,
    systemPrompt,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await resourceLoader.reload();

  const { session } = await createAgentSession({
    cwd: ROOT,
    authStorage,
    modelRegistry,
    model,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(),
    resourceLoader,
    tools: [],
  });

  try {
    await session.prompt(`Here are ${trends.length} trending items from multiple platforms:\n\n${compact}`);
    const text = session.getLastAssistantText() || "";
    try {
      return JSON.parse(text.trim());
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
      console.error(`[grouper] Failed to parse LLM response: ${text.slice(0, 200)}`);
      return [];
    }
  } finally {
    session.dispose();
  }
}
