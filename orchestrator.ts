import { spawn, ChildProcess } from "node:child_process";
import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";

const ROOT = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
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
interface CategoryConfig {
  maxConcurrent?: number;
  requiredFields?: string[];
  items?: string;
  [key: string]: unknown;
}

function readCategoryConfig(category: string): CategoryConfig {
  const configPath = join(ROOT, "skills", category, "config.json");
  if (!existsSync(configPath)) return {};
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

function discoverSkills(category: string): Skill[] {
  const catDir = join(ROOT, "skills", category);
  if (!existsSync(catDir)) return [];

  return readdirSync(catDir, { withFileTypes: true })
    .filter((s) => s.isDirectory() && existsSync(join(catDir, s.name, "SKILL.md")))
    .map((s) => ({ name: s.name, dir: join("skills", category, s.name), category }));
}

// ---------------------------------------------------------------------------
// Script extraction — pulls code from SKILL.md ## Script block
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
// Direct script execution with streaming
// ---------------------------------------------------------------------------
function runScriptDirect(
  skill: Skill,
  args: Record<string, string>,
  onUpdate: (data: SkillResult) => void,
  config: CategoryConfig = {},
  trackChild?: (child: ChildProcess) => void,
): Promise<SkillResult> {
  return new Promise((resolve) => {
    const source = `${skill.category}/${skill.name}`;
    const scriptPath = join(ROOT, skill.dir, "search.mjs");

    if (!existsSync(scriptPath)) {
      resolve({ source, error: "Script not found" });
      return;
    }

    const cliArgs: string[] = [];
    for (const [k, v] of Object.entries(args)) {
      cliArgs.push(`--${k}`, v);
    }

    const child = spawn("node", [scriptPath, ...cliArgs], {
      cwd: ROOT,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });

    if (trackChild) trackChild(child);

    let lastResult: SkillResult | null = null;
    let stderr = "";

    const rl = createInterface({ input: child.stdout! });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) return;
      try {
        const data = JSON.parse(trimmed);
        const result = { source, ...data } as SkillResult;
        lastResult = result;
        if (data.partial) onUpdate(result);
      } catch {}
    });

    child.stderr?.on("data", (chunk) => {
      const msg = chunk.toString();
      stderr += msg;
      process.stderr.write(`[${skill.name}] ${msg}`);
    });

    child.on("close", (code) => {
      if (lastResult && !lastResult.error) {
        // Sanity check: validate required fields from config
        const required = config.requiredFields || [];
        const itemsKey = config.items || "items";
        const items = (lastResult as any)[itemsKey];
        if (required.length > 0 && Array.isArray(items) && items.length > 0) {
          const isMissing = (v: any) => v === undefined || v === null || v === "";
          const isNumericField = (k: string) => required.includes(k) && typeof items.find((i: any) => i[k] !== undefined)?.[k] === "number";
          const broken = items.filter((item: any) =>
            required.some((k) => isNumericField(k) ? (item[k] === undefined || item[k] === null) : isMissing(item[k]))
          );
          const brokenPct = broken.length / items.length;
          if (brokenPct > 0.5) {
            // Log which specific fields are missing for debugging
            const fieldStats: Record<string, number> = {};
            for (const k of required) {
              fieldStats[k] = items.filter((item: any) => isNumericField(k) ? (item[k] === undefined || item[k] === null) : isMissing(item[k])).length;
            }
            const fieldReport = Object.entries(fieldStats).filter(([, v]) => v > 0).map(([k, v]) => `${k}:${v}/${items.length}`).join(", ");
            console.error(`[orchestrator] ${source}: ${broken.length}/${items.length} items missing required fields — ${fieldReport}`);
            console.error(`[orchestrator] ${source}: sample broken item: ${JSON.stringify(broken[0]).slice(0, 300)}`);
            resolve({ source, error: `${Math.round(brokenPct * 100)}% missing required fields (${fieldReport})`, [itemsKey]: items, stderr: stderr.slice(-500) });
            return;
          }
          if (broken.length > 0) {
            console.error(`[orchestrator] ${source}: filtered ${broken.length} incomplete items`);
            (lastResult as any)[itemsKey] = items.filter((item: any) =>
              !required.some((k) => isNumericField(k) ? (item[k] === undefined || item[k] === null) : isMissing(item[k]))
            );
          }
        }
        resolve(lastResult);
      } else if (code !== 0) {
        const lastLine = stderr.trim().split("\n").pop() || "";
        console.error(`[orchestrator] ${source} FAILED (code ${code}): ${lastLine}`);
        resolve({ source, error: `Script failed: ${lastLine || `exit code ${code}`}` });
      } else {
        const lastLine = stderr.trim().split("\n").pop() || "";
        console.error(`[orchestrator] ${source} NO OUTPUT: ${lastLine}`);
        resolve({ source, error: `No results: ${lastLine || "script produced no output"}` });
      }
    });

    child.on("error", (err) => {
      resolve({ source, error: err.message });
    });
  });
}

// ---------------------------------------------------------------------------
// Orchestrator — pure execution, no routing logic
// ---------------------------------------------------------------------------
export interface ProviderPriority {
  top: string[];
  medium: string[];
  low: string[];
}

export class Orchestrator extends EventEmitter {
  private children = new Set<ChildProcess>();
  private aborted = false;

  abort() {
    this.aborted = true;
    for (const child of this.children) {
      try { child.kill("SIGTERM"); } catch {}
    }
    this.children.clear();
    console.error("[orchestrator] Aborted — killed all child processes");
  }

  async run(category: string, args: Record<string, string>, providerPriority?: ProviderPriority): Promise<SkillResult[]> {
    let skills = discoverSkills(category);
    if (skills.length === 0) throw new Error(`No skills found for category: ${category}`);

    // Filter skills by providers arg if specified
    if (args.providers) {
      const allowed = args.providers.split(",").map((s) => s.trim().toLowerCase());
      skills = skills.filter((s) => allowed.includes(s.name.toLowerCase()));
      console.error(`[orchestrator] Filtered to providers: ${skills.map((s) => s.name).join(", ")}`);
      // Remove providers from args passed to scripts
      delete args.providers;
    }

    const config = readCategoryConfig(category);
    const maxConcurrent = config.maxConcurrent || skills.length;
    extractScripts(skills);

    // Expand comma-separated from/to into airport combos
    const origins = (args.from || "").split(",").map((s) => s.trim()).filter(Boolean);
    const destinations = (args.to || "").split(",").map((s) => s.trim()).filter(Boolean);
    const combos: { from: string; to: string; label: string }[] = [];
    for (const from of origins.length ? origins : [args.from || ""]) {
      for (const to of destinations.length ? destinations : [args.to || ""]) {
        combos.push({ from, to, label: origins.length + destinations.length > 2 ? `${from}→${to}` : "" });
      }
    }

    // Build priority lookup: skill name → "top" | "medium" | "low"
    const priorityOf = (name: string): string => {
      if (!providerPriority) return "top";
      if (providerPriority.top.includes(name)) return "top";
      if (providerPriority.medium.includes(name)) return "medium";
      if (providerPriority.low.includes(name)) return "low";
      return "medium";
    };

    // Build all (skill, combo) jobs
    const jobs: { skill: Skill; args: Record<string, string>; label: string; priority: string }[] = [];
    for (const skill of skills) {
      for (const combo of combos) {
        jobs.push({ skill, args: { ...args, from: combo.from, to: combo.to }, label: combo.label, priority: priorityOf(skill.name) });
      }
    }

    // Sort jobs by priority: top first, then medium, then low
    const priorityOrder: Record<string, number> = { top: 0, medium: 1, low: 2 };
    jobs.sort((a, b) => (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1));

    const topCount = jobs.filter(j => j.priority === "top").length;
    const midCount = jobs.filter(j => j.priority === "medium").length;
    const lowCount = jobs.filter(j => j.priority === "low").length;
    console.error(`[orchestrator] "${category}": ${jobs.length} jobs (${topCount} top, ${midCount} mid, ${lowCount} low), max ${maxConcurrent} concurrent`);

    const MAX_RETRIES = 2;

    const runJob = (job: typeof jobs[0]): Promise<SkillResult> => {
      const skillName = job.label ? `${job.skill.name} (${job.label})` : job.skill.name;
      const source = `${job.skill.category}/${skillName}`;
      console.error(`[orchestrator] ${source} [${job.priority}]: direct script (0 tokens)`);
      this.emit("skill:start", { category: job.skill.category, skill: skillName, priority: job.priority });

      const attempt = async (retry: number): Promise<SkillResult> => {
        try {
          const result = await runScriptDirect(job.skill, job.args, (partial) => {
            this.emit("skill:update", { category: job.skill.category, skill: skillName, data: partial });
          }, config, (child) => this.children.add(child));

          // Retry on error or empty results (if we have retries left)
          if (result.error && retry < MAX_RETRIES && !this.aborted) {
            console.error(`[orchestrator] ${source}: retry ${retry + 1}/${MAX_RETRIES} — ${result.error}`);
            return attempt(retry + 1);
          }

          this.emit("skill:done", { category: job.skill.category, skill: skillName, data: result });
          return result;
        } catch (err) {
          if (retry < MAX_RETRIES && !this.aborted) {
            console.error(`[orchestrator] ${source}: retry ${retry + 1}/${MAX_RETRIES} — ${(err as Error).message}`);
            return attempt(retry + 1);
          }
          const error = (err as Error).message;
          this.emit("skill:error", { category: job.skill.category, skill: skillName, error });
          return { source, error } as SkillResult;
        }
      };

      return attempt(0);
    };

    // Run in batches of maxConcurrent, respecting priority order (jobs already sorted).
    // Batches are filled sequentially: all tops first, then mediums, then lows.
    // A batch may mix tiers only when a tier doesn't fill the remaining slots.
    const allResults: SkillResult[] = [];
    for (let i = 0; i < jobs.length; i += maxConcurrent) {
      if (this.aborted) { console.error("[orchestrator] Aborted, skipping remaining jobs"); break; }
      const batch = jobs.slice(i, i + maxConcurrent);
      const batchResults = await Promise.all(batch.map(runJob));
      allResults.push(...batchResults.filter((r): r is SkillResult => r !== null));
    }

    this.emit("done", { results: allResults });
    return allResults;
  }
}
