import { routePrompt } from "./router.js";
import { Orchestrator } from "./orchestrator.js";

const prompt = process.argv.slice(2).join(" ");
if (!prompt) {
  console.error("Usage: npx tsx agent.ts <prompt>");
  process.exit(1);
}

// Step 1: Route
const { suggestions } = await routePrompt(prompt);
console.error(`Suggestions:`);
suggestions.forEach((s, i) => console.error(`  ${i + 1}. ${s.label} → ${s.category} ${JSON.stringify(s.args)}`));

// Auto-select first suggestion for CLI
const pick = suggestions[0];
console.error(`\nRunning: ${pick.label}\n`);

// Step 2: Execute
const orchestrator = new Orchestrator();
const results = await orchestrator.run(pick.category, pick.args);
console.log(JSON.stringify(results, null, 2));
