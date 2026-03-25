import {
  createAgentSession,
  SessionManager,
  SettingsManager,
  DefaultResourceLoader,
  AuthStorage,
  ModelRegistry,
  createCodingTools,
} from "@mariozechner/pi-coding-agent";
import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";

const ROOT = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CategoryConfig {
  description: string;
  maxConcurrent: number;
}

export interface Skill {
  name: string;
  dir: string;
  category: string;
}

export interface SkillResult {
  source: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
function discoverCategories() {
  const skillsDir = join(ROOT, "skills");
  if (!existsSync(skillsDir)) return [];

  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(skillsDir, d.name, "config.json")))
    .map((d) => {
      const config: CategoryConfig = JSON.parse(
        readFileSync(join(skillsDir, d.name, "config.json"), "utf-8")
      );
      const skills = readdirSync(join(skillsDir, d.name), { withFileTypes: true })
        .filter((s) => s.isDirectory() && existsSync(join(skillsDir, d.name, s.name, "SKILL.md")))
        .map((s) => ({ name: s.name, dir: join("skills", d.name, s.name), category: d.name }));
      return { name: d.name, config, skills };
    });
}

// ---------------------------------------------------------------------------
// Script extraction
// ---------------------------------------------------------------------------
function extractScripts(skills: Skill[]) {
  for (const skill of skills) {
    const md = readFileSync(join(ROOT, skill.dir, "SKILL.md"), "utf-8");
    const match = md.match(/## Script\s*\n+```javascript\n([\s\S]*?)```/);
    if (!match) continue;

    const scriptPath = join(ROOT, skill.dir, "search.mjs");
    const code = match[1];
    if (existsSync(scriptPath) && readFileSync(scriptPath, "utf-8") === code) continue;

    writeFileSync(scriptPath, code);
    console.error(`[orchestrator] Extracted → ${skill.dir}/search.mjs`);
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export function initAuth(): AuthStorage {
  const authPath = join(ROOT, ".auth.json");
  if (!existsSync(authPath)) {
    const token = process.env.ANTHROPIC_OAUTH_REFRESH_TOKEN;
    if (!token) throw new Error("No auth. Set ANTHROPIC_OAUTH_REFRESH_TOKEN or create .auth.json");
    writeFileSync(authPath, JSON.stringify({
      anthropic: { type: "oauth", refresh: token, access: "", expires: 0 },
    }));
  }
  return AuthStorage.create(authPath);
}

// ---------------------------------------------------------------------------
// Extract JSON from agent response
// ---------------------------------------------------------------------------
function extractJSON(text: string): Record<string, unknown> {
  const trimmed = text.trim();

  // Try raw parse
  try { return JSON.parse(trimmed); } catch {}

  // Try fenced code block
  const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) try { return JSON.parse(fenced[1].trim()); } catch {}

  // Try to find a JSON object that starts with {"site" or {"error" or {"skipped" or {"url"
  const jsonPattern = trimmed.match(/(\{"(?:site|error|skipped|url|flights)[\s\S]*\})\s*$/);
  if (jsonPattern) try { return JSON.parse(jsonPattern[1]); } catch {}

  // Last resort: find first { to last }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try { return JSON.parse(trimmed.slice(first, last + 1)); } catch {}
  }

  return { error: "Could not parse agent response", raw: trimmed.slice(0, 500) };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = readFileSync(join(ROOT, "prompts", "system.md"), "utf-8").trim();

export class Orchestrator extends EventEmitter {
  private authStorage: AuthStorage;
  private modelRegistry: ModelRegistry;
  private model: ReturnType<ModelRegistry["find"]>;

  constructor(opts: { model?: string } = {}) {
    super();
    this.authStorage = initAuth();
    this.modelRegistry = new ModelRegistry(this.authStorage);
    const modelId = opts.model || process.env.MODEL || "claude-sonnet-4-6";
    this.model = this.modelRegistry.find("anthropic", modelId);
    if (!this.model) throw new Error(`Model "anthropic/${modelId}" not found`);
  }

  async run(prompt: string): Promise<SkillResult[]> {
    const categories = discoverCategories();
    if (categories.length === 0) throw new Error("No skill categories found");

    const results: SkillResult[] = [];

    for (const { config, skills, name } of categories) {
      extractScripts(skills);
      console.error(`[orchestrator] "${name}": ${skills.length} skills, max ${config.maxConcurrent} concurrent`);

      for (let i = 0; i < skills.length; i += config.maxConcurrent) {
        const batch = skills.slice(i, i + config.maxConcurrent);
        const batchResults = await Promise.all(
          batch.map((skill) => this.runSkill(skill, prompt))
        );
        results.push(...batchResults.filter((r): r is SkillResult => r !== null));
      }
    }

    this.emit("done", { results });
    return results;
  }

  private async runSkill(skill: Skill, prompt: string): Promise<SkillResult | null> {
    const source = `${skill.category}/${skill.name}`;
    this.emit("skill:start", { category: skill.category, skill: skill.name });

    try {
      const text = await this.runSkillAgent(skill, prompt);
      const data = extractJSON(text);

      if (data.error && data.raw) {
        console.error(`[orchestrator] ${source} parse failed, raw: ${String(data.raw).slice(0, 300)}`);
      }

      if (data.skipped) return null;

      const result = { source, ...data } as SkillResult;
      this.emit("skill:done", { category: skill.category, skill: skill.name, data: result });
      return result;
    } catch (err) {
      const error = (err as Error).message;
      console.error(`[orchestrator] ${source} exception: ${error}`);
      this.emit("skill:error", { category: skill.category, skill: skill.name, error });
      return { source, error } as SkillResult;
    }
  }

  private async runSkillAgent(skill: Skill, prompt: string): Promise<string> {
    const resourceLoader = new DefaultResourceLoader({
      cwd: ROOT,
      additionalSkillPaths: [join(ROOT, skill.dir)],
      systemPrompt: SYSTEM_PROMPT,
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd: ROOT,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      model: this.model!,
      sessionManager: SessionManager.inMemory(),
      settingsManager: SettingsManager.inMemory(),
      resourceLoader,
      tools: createCodingTools(ROOT),
    });

    try {
      const label = `${skill.category}/${skill.name}`;
      console.error(`[orchestrator] Starting ${label}...`);
      await session.prompt(prompt);
      let text = session.getLastAssistantText() || "";

      // Self-correction: if the response isn't valid JSON, nudge the agent in the same session
      const MAX_CORRECTIONS = 2;
      for (let i = 0; i < MAX_CORRECTIONS; i++) {
        const trimmed = text.trim();
        // Try to parse as-is
        try { JSON.parse(trimmed); break; } catch {}
        // Try extracting from code fence
        const fenced = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
        if (fenced) try { JSON.parse(fenced[1].trim()); break; } catch {}
        // Try first { to last }
        const first = trimmed.indexOf("{"), last = trimmed.lastIndexOf("}");
        if (first !== -1 && last > first) try { JSON.parse(trimmed.slice(first, last + 1)); break; } catch {}

        console.error(`[orchestrator] ${label} returned non-JSON (correction ${i + 1}), nudging...`);
        console.error(`[orchestrator] response was: ${trimmed.slice(0, 150)}`);
        await session.prompt(
          "ERROR: Your response is not valid JSON. Your output goes directly to a JSON parser. " +
          "Return ONLY the raw JSON from the command stdout. No text, no markdown, no code fences. Just the JSON object starting with { and ending with }."
        );
        text = session.getLastAssistantText() || "";
      }

      console.error(`[orchestrator] ${label} done (${text.length} chars)`);
      return text;
    } finally {
      session.dispose();
    }
  }
}
