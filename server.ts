import { createServer } from "node:http";
import { readFileSync, existsSync, watch } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { Orchestrator } from "./orchestrator.js";
import { routePrompt } from "./router.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(ROOT, "web");
const DIST_DIR = join(WEB_DIR, "dist");
const PORT = parseInt(process.env.PORT || "3000", 10);

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

const server = createServer((req, res) => {
  const url = req.url === "/" ? "/index.html" : req.url!;
  const distPath = join(DIST_DIR, url);
  const webPath = join(WEB_DIR, url);
  const filePath = existsSync(distPath) ? distPath : webPath;

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const mime = MIME[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" });
  res.end(readFileSync(filePath));
});

const wss = new WebSocketServer({ noServer: true });
const liveReloadWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/livereload") {
    liveReloadWss.handleUpgrade(req, socket, head, (ws) => liveReloadWss.emit("connection", ws));
  } else {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  }
});

function notifyReload() {
  for (const client of liveReloadWss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send("reload");
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null;
function onFileChange() {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(notifyReload, 200);
}

watch(WEB_DIR, { recursive: false }, onFileChange);
if (existsSync(DIST_DIR)) watch(DIST_DIR, { recursive: false }, onFileChange);

// ---------------------------------------------------------------------------
// WebSocket — two-step flow
// ---------------------------------------------------------------------------
let running = false;
let currentOrchestrator: Orchestrator | null = null;

const send = (ws: WebSocket, data: any) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
};

wss.on("connection", (ws: WebSocket) => {
  console.error("[server] Client connected");

  ws.on("message", async (raw: Buffer) => {
    let msg: { type: string; text?: string; category?: string; args?: Record<string, string>; providerPriority?: Record<string, string[]> };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", message: "Invalid JSON" });
      return;
    }

    // Cancel running search
    if (msg.type === "cancel") {
      if (currentOrchestrator) {
        console.error("[server] Cancelling running search");
        currentOrchestrator.abort();
        currentOrchestrator = null;
        running = false;
      }
      return;
    }

    // Step 1: User sends a prompt → route it and return suggestions
    if (msg.type === "prompt" && msg.text) {
      // Cancel any running search first
      if (running && currentOrchestrator) {
        console.error("[server] Cancelling previous search for new prompt");
        currentOrchestrator.abort();
        currentOrchestrator = null;
        running = false;
      }

      console.error(`[server] Prompt: ${msg.text.slice(0, 100)}`);
      send(ws, { type: "routing" });

      try {
        const result = await routePrompt(msg.text);
        console.error(`[server] Suggestions: ${result.suggestions.map((s) => s.label).join(", ")}`);
        if (result.providerPriority) console.error(`[server] Provider priority: top=${result.providerPriority.top}, mid=${result.providerPriority.medium}, low=${result.providerPriority.low}`);
        send(ws, { type: "suggestions", suggestions: result.suggestions, providerPriority: result.providerPriority });
      } catch (err) {
        send(ws, { type: "error", message: (err as Error).message });
      }
      return;
    }

    // Step 2: User selects a suggestion → run the orchestrator
    if (msg.type === "execute" && msg.category && msg.args) {
      const providerPriority = msg.providerPriority as Record<string, string[]> | undefined;

      // Cancel previous search if still running
      if (running && currentOrchestrator) {
        console.error("[server] Cancelling previous search for new execute");
        currentOrchestrator.abort();
        currentOrchestrator = null;
        running = false;
      }

      running = true;
      console.error(`[server] Execute: ${msg.category} → ${JSON.stringify(msg.args)}`);

      try {
        const orchestrator = new Orchestrator();
        currentOrchestrator = orchestrator;

        orchestrator.on("skill:start", (e) => send(ws, { type: "skill:start", ...e }));
        orchestrator.on("skill:update", (e) => send(ws, { type: "skill:update", ...e }));
        orchestrator.on("skill:done", (e) => {
          if (e.data?.error) console.error(`[server] skill:done with error ${e.category}/${e.skill}: ${e.data.error}`);
          send(ws, { type: "skill:done", ...e });
        });
        orchestrator.on("skill:error", (e) => {
          console.error(`[server] skill:error ${e.category}/${e.skill}: ${e.error}`);
          send(ws, { type: "skill:error", ...e });
        });

        const results = await orchestrator.run(msg.category, msg.args, providerPriority as any);
        send(ws, { type: "done", results });
      } catch (err) {
        send(ws, { type: "error", message: (err as Error).message });
      } finally {
        currentOrchestrator = null;
        running = false;
      }
      return;
    }

    send(ws, { type: "error", message: "Unknown message type" });
  });

  ws.on("close", () => console.error("[server] Client disconnected"));
});

server.listen(PORT, () => {
  console.error(`[server] http://localhost:${PORT}`);
  console.error(`[server] Live reload enabled — watching web/`);
});
