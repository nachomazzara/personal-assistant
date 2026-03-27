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

export interface ProviderPriority {
  top: string[];
  medium: string[];
  low: string[];
}

export interface RouteResult {
  suggestions: Suggestion[];
  providerPriority?: ProviderPriority;
}

// ---------------------------------------------------------------------------
// Discover available skill categories + their arg schemas
// ---------------------------------------------------------------------------
interface CategorySchema {
  name: string;
  description: string;
  args: Record<string, string>;
  routerHints?: string;
  providers: string[];
}

function discoverCategorySchemas(): CategorySchema[] {
  const skillsDir = join(ROOT, "skills");
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, "config.json")))
    .map((d) => {
      const config = JSON.parse(readFileSync(join(skillsDir, d.name, "config.json"), "utf-8"));
      const catDir = join(skillsDir, d.name);
      const providers = readdirSync(catDir, { withFileTypes: true })
        .filter((s) => s.isDirectory() && existsSync(join(catDir, s.name, "SKILL.md")))
        .map((s) => s.name);
      return {
        name: d.name,
        description: config.description || "",
        args: config.args || {},
        routerHints: config.routerHints || "",
        providers,
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
    const providerList = c.providers.length ? `\n  Providers: ${c.providers.join(", ")}` : "";
    return `- "${c.name}": ${c.description}\n  Required args:\n${argsDesc}${providerList}`;
  }).join("\n\n");

  const today = new Date().toISOString().split("T")[0];
  const systemPrompt = `You are a search assistant router. Given a user's message, determine which skill category to use, extract the required arguments, suggest 3 search variations, and rank providers by expected relevance for this route.

Today is ${today}.

Available categories:
${categoryList}

Rules:
- Suggest 3 variations: the most likely interpretation, and 2 useful alternatives
- Each suggestion needs a short human-readable label
- Only include optional args if the user explicitly mentions them
- For multi-airport cities: ALWAYS use comma-separated codes with ALL airports for that city. Example: Buenos Aires → "EZE,AEP", Tokyo → "NRT,HND", New York → "JFK,EWR,LGA", London → "LHR,LGW,STN". The system will automatically search every airport combination. Vary the suggestions by other factors (dates, one-way vs round-trip, etc.), NOT by airports.
- Rank providers into top/medium/low based on the route:
  - "top": providers most likely to have the best results (aggregators with good coverage for this route, airlines that fly this route directly)
  - "medium": providers that may have results but aren't the best for this route
  - "low": providers unlikely to have good results (e.g. a regional airline for an intercontinental route it doesn't serve)
  - Provider knowledge: "google" and "skyscanner" are global aggregators (usually top). "kayak" is a global aggregator (usually top/medium). "aerolineas" is Aerolíneas Argentinas (top for Argentina/South America routes, low for routes they don't fly). "turismocity" is an Argentine aggregator (good for flights from Argentina, low otherwise).

${categories.filter((c) => c.routerHints).map((c) => `Category "${c.name}" hints:\n${c.routerHints}`).join("\n\n")}

Respond with ONLY this JSON, no other text:
{"suggestions": [
  {"label": "Short description", "category": "...", "args": {"key": "value"}},
  {"label": "Short description", "category": "...", "args": {"key": "value"}},
  {"label": "Short description", "category": "...", "args": {"key": "value"}}
],
"providerPriority": {"top": ["..."], "medium": ["..."], "low": ["..."]}}`;

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
