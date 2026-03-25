import { Orchestrator } from "./orchestrator.js";

const prompt = process.argv.slice(2).join(" ");
if (!prompt) {
  console.error("Usage: npx tsx agent.ts <prompt>");
  process.exit(1);
}

const orchestrator = new Orchestrator({ model: process.env.MODEL });
const results = await orchestrator.run(prompt);
console.log(JSON.stringify(results, null, 2));
