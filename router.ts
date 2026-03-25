import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  AuthStorage,
  ModelRegistry,
} from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Suggestion {
  label: string;
  category: string;
  args: Record<string, string>;
}

export interface RouteResult {
  suggestions: Suggestion[];
}

// ---------------------------------------------------------------------------
// Discover available skill categories + their arg schemas
// ---------------------------------------------------------------------------
function discoverCategorySchemas(): { name: string; description: string; args: Record<string, string>; routerHints?: string }[] {
  const skillsDir = join(ROOT, "skills");
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, "config.json")))
    .map((d) => {
      const config = JSON.parse(readFileSync(join(skillsDir, d.name, "config.json"), "utf-8"));
      return {
        name: d.name,
        description: config.description || "",
        args: config.args || {},
        routerHints: config.routerHints || "",
      };
    });
}

// ---------------------------------------------------------------------------
// Route prompt via LLM → returns 3 suggestions
// ---------------------------------------------------------------------------
export async function routePrompt(prompt: string): Promise<RouteResult> {
  const categories = discoverCategorySchemas();
  if (categories.length === 0) throw new Error("No skill categories found");

  const categoryList = categories.map((c) => {
    const argsDesc = Object.entries(c.args)
      .map(([k, v]) => `  - ${k}: ${v}`)
      .join("\n");
    return `- "${c.name}": ${c.description}\n  Required args:\n${argsDesc}`;
  }).join("\n\n");

  const today = new Date().toISOString().split("T")[0];
  const systemPrompt = `You are a search assistant router. Given a user's message, determine which skill category to use, extract the required arguments, and suggest 3 search variations.

Today is ${today}.

Available categories:
${categoryList}

Rules:
- Suggest 3 variations: the most likely interpretation, and 2 useful alternatives
- Each suggestion needs a short human-readable label
- Only include optional args if the user explicitly mentions them

${categories.filter((c) => c.routerHints).map((c) => `Category "${c.name}" hints:\n${c.routerHints}`).join("\n\n")}

Respond with ONLY this JSON, no other text:
{"suggestions": [
  {"label": "Short description", "category": "...", "args": {"key": "value"}},
  {"label": "Short description", "category": "...", "args": {"key": "value"}},
  {"label": "Short description", "category": "...", "args": {"key": "value"}}
]}`;

  const authPath = join(ROOT, ".auth.json");
  if (!existsSync(authPath)) {
    const token = process.env.ANTHROPIC_OAUTH_REFRESH_TOKEN;
    if (!token) throw new Error("No auth. Set ANTHROPIC_OAUTH_REFRESH_TOKEN or create .auth.json");
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
    await session.prompt(prompt);
    const text = session.getLastAssistantText() || "";
    try {
      return JSON.parse(text.trim());
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error(`Router returned invalid JSON: ${text.slice(0, 200)}`);
    }
  } finally {
    session.dispose();
  }
}
