import { createServer } from "node:http";
import { readFileSync, existsSync, watch } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { Orchestrator } from "./orchestrator.js";

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

// Static file server — no caching in dev
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
  res.writeHead(200, {
    "Content-Type": mime,
    "Cache-Control": "no-store",
  });
  res.end(readFileSync(filePath));
});

// WebSocket server — two paths: /ws for app, /livereload for hot reload
const wss = new WebSocketServer({ noServer: true });
const liveReloadWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/livereload") {
    liveReloadWss.handleUpgrade(req, socket, head, (ws) => liveReloadWss.emit("connection", ws));
  } else {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  }
});

// Live reload — watch web/ and web/dist/ for changes
function notifyReload() {
  for (const client of liveReloadWss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send("reload");
    }
  }
}

let debounce: ReturnType<typeof setTimeout> | null = null;
function onFileChange() {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(notifyReload, 200);
}

watch(WEB_DIR, { recursive: false }, onFileChange);
if (existsSync(DIST_DIR)) watch(DIST_DIR, { recursive: false }, onFileChange);

// App WebSocket
let running = false;

wss.on("connection", (ws: WebSocket) => {
  console.error("[server] Client connected");

  ws.on("message", async (raw: Buffer) => {
    let msg: { type: string; text?: string };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    if (msg.type !== "prompt" || !msg.text) {
      ws.send(JSON.stringify({ type: "error", message: "Expected { type: 'prompt', text: '...' }" }));
      return;
    }

    if (running) {
      ws.send(JSON.stringify({ type: "error", message: "A search is already running" }));
      return;
    }

    running = true;
    console.error(`[server] Prompt: ${msg.text.slice(0, 100)}`);

    try {
      const orchestrator = new Orchestrator();

      orchestrator.on("skill:start", (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "skill:start", ...e }));
        }
      });

      orchestrator.on("skill:done", (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "skill:done", ...e }));
        }
      });

      orchestrator.on("skill:error", (e) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "skill:error", ...e }));
        }
      });

      const results = await orchestrator.run(msg.text);

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "done", results }));
      }
    } catch (err) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: (err as Error).message }));
      }
    } finally {
      running = false;
    }
  });

  ws.on("close", () => console.error("[server] Client disconnected"));
});

server.listen(PORT, () => {
  console.error(`[server] http://localhost:${PORT}`);
  console.error(`[server] Live reload enabled — watching web/`);
});
