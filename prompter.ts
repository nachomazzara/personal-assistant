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
export interface TrendInput {
  title: string;
  description?: string;
  source: string;
  url?: string;
  relatedTerms?: string[];
  category?: string;
}

export interface VideoPromptResult {
  hook: string;
  concept: string;
  prompt: string;
  hashtags: string[];
}

// ---------------------------------------------------------------------------
// Generate a creative video prompt connecting a trend to a target topic
// ---------------------------------------------------------------------------
export async function generateVideoPrompt(
  trend: TrendInput,
  userTopic: string,
): Promise<VideoPromptResult> {
  const promptPath = join(ROOT, "skills", "trends", "PROMPTER.md");
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

  // Build the user message with trend context
  const related = trend.relatedTerms?.length
    ? `\nRelated terms: ${trend.relatedTerms.join(", ")}`
    : "";
  const desc = trend.description ? `\nDescription: ${trend.description}` : "";
  const cat = trend.category ? `\nCategory: ${trend.category}` : "";

  const userMessage = `TRENDING TOPIC:
Title: ${trend.title}
Platform: ${trend.source}${desc}${cat}${related}

TARGET TOPIC to connect it to:
${userTopic}`;

  try {
    await session.prompt(userMessage);
    const text = session.getLastAssistantText() || "";
    try {
      return JSON.parse(text.trim());
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      console.error(`[prompter] Failed to parse LLM response: ${text.slice(0, 200)}`);
      throw new Error("Failed to generate prompt — unexpected response format");
    }
  } finally {
    session.dispose();
  }
}
