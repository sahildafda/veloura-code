import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AgentEngine } from "../agent/engine.js";
import { LocalDatabase } from "../db/database.js";
import { ModelRegistry } from "../ai/models.js";
import { ProjectDetector } from "../project/detector.js";
import { GitManager } from "../git/git.js";
import { VelouraConfig, ConfigManager } from "../config/config.js";
import { CredentialManager } from "../auth/credentials.js";

export interface WebServerOptions {
  port?: number;
  engine: AgentEngine;
  db: LocalDatabase;
  registry: ModelRegistry;
  detector: ProjectDetector;
  gitManager: GitManager;
  config: VelouraConfig;
  configManager?: ConfigManager;
  credentialManager?: CredentialManager;
  projectRoot: string;
  autoOpenBrowser?: boolean;
}

export class VelouraWebServer {
  private server: http.Server | null = null;
  private port: number;
  private options: WebServerOptions;

  constructor(options: WebServerOptions) {
    this.options = options;
    this.port = options.port || 3456;
  }

  public async start(): Promise<string> {
    const url = `http://localhost:${this.port}`;

    this.server = http.createServer(async (req, res) => {
      // CORS headers
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url || "/", `http://${req.headers.host}`);
      const pathname = parsedUrl.pathname;

      try {
        // === STATIC UI ===
        if (pathname === "/" || pathname === "/index.html") {
          const htmlContent = await this.getWebAppHtml();
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(htmlContent);
          return;
        }

        // === REST API ===

        // 1. GET /api/profile
        if (pathname === "/api/profile" && req.method === "GET") {
          const user = os.userInfo().username || "Developer";
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              username: user,
              projectName: path.basename(this.options.projectRoot),
              projectPath: this.options.projectRoot,
              privacyMode: this.options.config.privacyMode,
              activeModel: this.options.engine.getActiveModel(),
            })
          );
          return;
        }

        // 2. GET /api/project
        if (pathname === "/api/project" && req.method === "GET") {
          const meta = this.options.detector.detect();
          const git = await this.options.gitManager.getStatus();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              metadata: meta,
              git: {
                isGit: git.isGit,
                branch: git.branch,
                isClean: git.modified.length === 0 && git.not_added.length === 0,
              },
            })
          );
          return;
        }

        // 3. GET /api/conversations
        if (pathname === "/api/conversations" && req.method === "GET") {
          const list = this.options.db.listConversations(50);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(list));
          return;
        }

        // 4. GET /api/conversations/:id
        const convMatch = pathname.match(/^\/api\/conversations\/([a-zA-Z0-9_-]+)$/);
        if (convMatch && req.method === "GET") {
          const id = convMatch[1];
          const conv = this.options.db.getConversation(id);
          const messages = this.options.db.getMessages(id);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ conversation: conv, messages }));
          return;
        }

        // 5. DELETE /api/conversations/:id
        if (convMatch && req.method === "DELETE") {
          const id = convMatch[1];
          this.options.db.deleteConversation(id);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, deleted: id }));
          return;
        }

        // 6. GET /api/diff
        if (pathname === "/api/diff" && req.method === "GET") {
          const diffText = await this.options.gitManager.getDiff();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ diff: diffText }));
          return;
        }

        // 7. GET /api/models
        if (pathname === "/api/models" && req.method === "GET") {
          const allModels = this.options.registry.getCachedModels();
          const freeModels = this.options.registry.getFreeModels();
          const active = this.options.engine.getActiveModel();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              activeModel: active,
              freeModels,
              allModels,
            })
          );
          return;
        }

        // 8. GET /api/settings
        if (pathname === "/api/settings" && req.method === "GET") {
          const credStatus = this.options.credentialManager
            ? this.options.credentialManager.getStatus()
            : { hasKey: false, maskedKey: "Not configured", source: "none" };
          const cfg = this.options.configManager
            ? this.options.configManager.get()
            : this.options.config;

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              hasApiKey: credStatus.hasKey,
              maskedKey: credStatus.maskedKey || "Not configured",
              storageSource: credStatus.source,
              defaultModel: cfg.defaultModel,
              provider: cfg.provider,
              baseUrl: cfg.baseUrl || "https://openrouter.ai/api/v1",
              privacyMode: cfg.privacyMode,
            })
          );
          return;
        }

        // 9. POST /api/settings
        if (pathname === "/api/settings" && req.method === "POST") {
          const body = await this.readJsonBody(req);

          if (body.apiKey && typeof body.apiKey === "string" && body.apiKey.trim().length > 0) {
            if (this.options.credentialManager) {
              this.options.credentialManager.setApiKey(body.apiKey.trim());
            }
            this.options.engine.updateCredentials(body.apiKey.trim(), body.baseUrl);
          }

          if (body.defaultModel) {
            if (this.options.configManager) {
              this.options.configManager.save({ defaultModel: body.defaultModel });
            }
            this.options.engine.setActiveModel(body.defaultModel);
          }

          if (body.baseUrl !== undefined) {
            const cleanUrl = body.baseUrl ? body.baseUrl.trim() : undefined;
            if (this.options.configManager) {
              this.options.configManager.save({ baseUrl: cleanUrl });
            }
            const currentKey = this.options.credentialManager
              ? this.options.credentialManager.getApiKey() || ""
              : "";
            this.options.engine.updateCredentials(currentKey, cleanUrl);
          }

          if (body.privacyMode && this.options.configManager) {
            this.options.configManager.setPrivacyMode(body.privacyMode);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, message: "Settings updated successfully" }));
          return;
        }

        // 10. POST /api/chat
        if (pathname === "/api/chat" && req.method === "POST") {
          const body = await this.readJsonBody(req);
          const prompt = body.prompt;
          const convId = body.conversationId || undefined;
          const model = body.model || undefined;

          if (!prompt) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Prompt is required" }));
            return;
          }

          if (model) {
            this.options.engine.setActiveModel(model);
          }

          const executedTools: Array<{ name: string; arguments: any }> = [];
          this.options.engine.setCallbacks({
            onToolStart: (name, args) => {
              executedTools.push({ name, arguments: args });
            },
          });

          try {
            const summary = await this.options.engine.runTask(prompt, {
              conversationId: convId,
              manualModel: model,
            });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                conversationId: summary.conversationId,
                taskId: summary.taskId,
                response: summary.finalResponse,
                filesModified: summary.filesModified,
                iterations: summary.iterations,
                toolCalls: executedTools,
                state: summary.state,
              })
            );
            return;
          } catch (chatErr: any) {
            const msg = String(chatErr.message || "");
            const isFreeDailyCap =
              msg.includes("free-models-per-day") ||
              (msg.includes("429") && msg.includes("free-models"));

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: false,
                error: msg,
                rateLimit: isFreeDailyCap
                  ? {
                      type: "free-models-per-day",
                      title: "OpenRouter Daily Free Limit Exceeded",
                      details:
                        "OpenRouter accounts with $0 balance have a daily cap on free models. To keep coding right now, switch to an ultra-low-cost model, update your API key, or use local Ollama.",
                    }
                  : null,
              })
            );
            return;
          }
        }

        // 404 for unknown endpoints
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Endpoint not found" }));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    return new Promise((resolve) => {
      this.server!.listen(this.port, () => {
        if (this.options.autoOpenBrowser !== false) {
          this.openBrowser(url);
        }
        resolve(url);
      });
    });
  }

  public stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private async getWebAppHtml(): Promise<string> {
    // Try reading local file from src/server/webApp.html or dist
    const possiblePaths = [
      path.join(path.dirname(fileURLToPath(import.meta.url)), "webApp.html"),
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/server/webApp.html"),
      path.join(process.cwd(), "src/server/webApp.html"),
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, "utf8");
      }
    }

    throw new Error("webApp.html template not found");
  }

  private openBrowser(url: string): void {
    const platform = process.platform;
    let cmd = "";

    if (platform === "win32") {
      cmd = `start "" "${url}"`;
    } else if (platform === "darwin") {
      cmd = `open "${url}"`;
    } else {
      cmd = `xdg-open "${url}"`;
    }

    try {
      exec(cmd);
    } catch {
      // Ignored
    }
  }

  private readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      req.on("end", () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }
}
