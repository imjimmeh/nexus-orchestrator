import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginPlatformService } from "../service/plugin-platform-service";
import type { PluginLifecycleService } from "./plugin-lifecycle.service";
import type { PluginLifecycleRequest } from "./plugin-lifecycle.types";

/**
 * Lightweight HTTP controller for the plugin lifecycle API.
 *
 * Does NOT depend on NestJS — uses Node.js built-in `http` module.
 * Accepts the hosting service and lifecycle service via constructor injection.
 */
export class PluginLifecycleController {
  private readonly hosting: PluginPlatformService;
  private readonly lifecycle: PluginLifecycleService;

  constructor(
    hosting: PluginPlatformService,
    lifecycle: PluginLifecycleService,
  ) {
    this.hosting = hosting;
    this.lifecycle = lifecycle;
  }

  /**
   * Route an incoming HTTP request to the appropriate handler.
   */
  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const method = req.method ?? "";
    const url = req.url ?? "/";

    try {
      await this.route(method, url, req, res);
    } catch {
      this.sendJson(res, 500, { error: "Internal Server Error" });
    }
  }

  /**
   * Route by method and URL path.
   */
  private async route(
    method: string,
    url: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // GET /health
    if (method === "GET" && url === "/health") {
      this.sendJson(res, 200, this.hosting.getHealth());
      return;
    }

    // GET /plugins
    if (method === "GET" && url === "/plugins") {
      this.sendJson(res, 200, this.lifecycle.list());
      return;
    }

    // POST /plugins/install
    if (method === "POST" && url === "/plugins/install") {
      await this.handleLifecycleAction(req, res, "install");
      return;
    }

    // POST /plugins/enable
    if (method === "POST" && url === "/plugins/enable") {
      await this.handleLifecycleAction(req, res, "enable");
      return;
    }

    // POST /plugins/disable
    if (method === "POST" && url === "/plugins/disable") {
      await this.handleLifecycleAction(req, res, "disable");
      return;
    }

    // POST /plugins/uninstall
    if (method === "POST" && url === "/plugins/uninstall") {
      await this.handleLifecycleAction(req, res, "uninstall");
      return;
    }

    // 404 for unknown routes
    this.sendJson(res, 404, { error: "Not Found" });
  }

  /**
   * Handle a lifecycle action request (install/enable/disable/uninstall).
   */
  private async handleLifecycleAction(
    req: IncomingMessage,
    res: ServerResponse,
    operation: PluginLifecycleRequest["operation"],
  ): Promise<void> {
    const body = await this.parseBody<{ pluginId?: string }>(req);

    if (!body.pluginId || typeof body.pluginId !== "string") {
      this.sendJson(res, 400, {
        success: false,
        pluginId: "",
        operation,
        state: "unknown",
        error: 'Missing or invalid "pluginId" in request body',
      });
      return;
    }

    const pluginId = body.pluginId;

    let result;

    switch (operation) {
      case "install":
        result = await this.lifecycle.install(pluginId);
        break;
      case "enable":
        result = await this.lifecycle.enable(pluginId);
        break;
      case "disable":
        result = await this.lifecycle.disable(pluginId);
        break;
      case "uninstall":
        result = await this.lifecycle.uninstall(pluginId);
        break;
      default:
        this.sendJson(res, 400, {
          success: false,
          pluginId,
          operation,
          state: "unknown",
          error: `Unknown operation: ${operation}`,
        });
        return;
    }

    if (!result.success) {
      const statusCode = this.errorToStatusCode(result.error);
      this.sendJson(res, statusCode, result);
      return;
    }

    this.sendJson(res, 200, result);
  }

  /**
   * Map an error message to an appropriate HTTP status code.
   */
  private errorToStatusCode(error?: string): number {
    if (!error) {
      return 400;
    }
    if (error.startsWith("Plugin not found")) {
      return 404;
    }
    if (error.startsWith("Invalid state transition")) {
      return 409;
    }
    return 400;
  }

  /**
   * Parse JSON request body from an IncomingMessage.
   */
  private async parseBody<T>(req: IncomingMessage): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const chunks: Uint8Array[] = [];

      req.on("data", (chunk: Uint8Array) => {
        chunks.push(chunk);
      });

      req.on("end", () => {
        if (chunks.length === 0) {
          resolve({} as T);
          return;
        }

        const raw = Buffer.concat(chunks).toString("utf-8");
        try {
          resolve(JSON.parse(raw) as T);
        } catch {
          resolve({} as T);
        }
      });

      req.on("error", reject);
    });
  }

  /**
   * Send a JSON response with the given status code.
   */
  private sendJson(
    res: ServerResponse,
    statusCode: number,
    body: unknown,
  ): void {
    const json = JSON.stringify(body);
    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(json),
    });
    res.end(json);
  }
}
