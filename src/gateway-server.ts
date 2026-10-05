import { serve } from "@hono/node-server";
import { once } from "node:events";
import { createMcpHonoApp, localhostHostValidation } from "@modelcontextprotocol/hono";
import { createMcpHandler, fromJsonSchema, McpServer, type JsonSchemaType } from "@modelcontextprotocol/server";
import { getCookie, setCookie } from "hono/cookie";
import { GatewayStore, type UserId } from "./gateway-store.js";
import { AuditLog } from "./audit-log.js";
import { EffectiveTools } from "./effective-tools.js";
import { IntegrationCatalog, type IntegrationConfig } from "./integration-catalog.js";
import { makeClient } from "./mcp-client.js";
import { ToolCallOutcomes } from "./tool-call-outcomes.js";

type GatewayOptions = {
  port: number;
  gitlabUrl: string;
  analyticsUrl?: string;
  stateFile: string;
  encryptionKey: Buffer;
  seedPasswords: Record<UserId, string>;
  downstreamTimeoutMs?: number;
  portalSessionTtlMs?: number;
};

function bearerToken(request: Request) {
  return request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
}

export async function startGatewayServer(options: GatewayOptions) {
  const store = await GatewayStore.open({
    file: options.stateFile,
    key: options.encryptionKey,
    seedPasswords: options.seedPasswords,
    sessionTtlMs: options.portalSessionTtlMs,
  });
  const audit = await AuditLog.open(`${options.stateFile}.audit.jsonl`);
  const downstreamTimeoutMs = options.downstreamTimeoutMs ?? 2_000;
  const outcomes = new ToolCallOutcomes(audit, store, downstreamTimeoutMs);
  const configs: IntegrationConfig[] = [{ id: "gitlab", name: "GitLab", url: options.gitlabUrl }];
  if (options.analyticsUrl) configs.push({ id: "analytics", name: "Analytics", url: options.analyticsUrl });

  const catalog = await IntegrationCatalog.open(configs, store);
  const discovered = catalog.all();
  const effectiveTools = new EffectiveTools(discovered, store);

  try {
    const handler = createMcpHandler(
      ({ requestInfo }) => {
        const userId = requestInfo && store.resolveGatewayToken(bearerToken(requestInfo));
        if (!userId) throw new Error("Unauthenticated MCP request");
        const server = new McpServer(
          { name: "mcp-gateway", version: "0.1.0" },
          { capabilities: { tools: {} } },
        );
        for (const { integration, tool, exposedName } of effectiveTools.forUser(userId)) {
          server.registerTool(
            exposedName,
            {
              description: tool.description,
              inputSchema: fromJsonSchema(tool.inputSchema as unknown as JsonSchemaType),
              annotations: tool.annotations,
            },
            async (args) => outcomes.execute(userId, integration, tool, args as Record<string, unknown>),
          );
        }
        return server;
      },
      { legacy: "reject" },
    );

    const app = createMcpHonoApp();
    app.use("*", localhostHostValidation());
    const portalUser = (cookie: string | undefined) => store.resolveSession(cookie);

    app.post("/api/login", async (context) => {
      const body = await context.req.json() as { username?: string; password?: string };
      const userId = store.authenticate(body.username ?? "", body.password ?? "");
      if (!userId) return context.json({ error: "Invalid username or password" }, 401);
      setCookie(context, "gateway_session", store.createSession(userId), {
        httpOnly: true, sameSite: "Strict", path: "/", maxAge: Math.ceil((options.portalSessionTtlMs ?? 8 * 60 * 60 * 1000) / 1000),
      });
      return context.json({ user: { id: userId, role: userId } });
    });

    app.post("/api/logout", (context) => {
      store.revokeSession(getCookie(context, "gateway_session"));
      setCookie(context, "gateway_session", "", { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 0 });
      return context.json({ ok: true });
    });

    app.get("/api/me", (context) => {
      const userId = portalUser(getCookie(context, "gateway_session"));
      return userId ? context.json({ user: { id: userId, role: userId } }) : context.json({ error: "Sign in required" }, 401);
    });

    app.post("/api/token", async (context) => {
      const userId = portalUser(getCookie(context, "gateway_session"));
      if (!userId) return context.json({ error: "Sign in required" }, 401);
      return context.json({ token: await store.issueGatewayToken(userId) });
    });

    app.put("/api/integrations/:id/credential", async (context) => {
      const userId = portalUser(getCookie(context, "gateway_session"));
      if (!userId) return context.json({ error: "Sign in required" }, 401);
      const config = catalog.find(context.req.param("id"))?.config;
      if (!config) return context.json({ error: "Unknown integration" }, 404);
      const body = await context.req.json() as { token?: string };
      if (!body.token?.trim()) return context.json({ error: "Credential is required" }, 400);

      const { client, transport } = makeClient(`gateway-credential-check-${config.id}`, config.url, body.token);
      try {
        await client.connect(transport);
        await client.listTools();
      } catch {
        return context.json({ error: "Integration credential was rejected" }, 400);
      } finally {
        await client.close();
      }
      await store.setCredential(userId, config.id, body.token);
      return context.json({ connected: true });
    });

    app.put("/api/tools/:name/enabled", async (context) => {
      const userId = portalUser(getCookie(context, "gateway_session"));
      if (!userId) return context.json({ error: "Sign in required" }, 401);
      const name = context.req.param("name");
      const decision = effectiveTools.resolve(userId, name);
      if (!decision) return context.json({ error: "Unknown tool" }, 404);
      if (!decision.policy) return context.json({ error: "Tool has no gateway policy" }, 403);
      if (!decision.eligible) {
        return context.json({ error: "Admin access required" }, 403);
      }
      const body = await context.req.json() as { enabled?: boolean };
      if (typeof body.enabled !== "boolean") return context.json({ error: "Enabled must be a boolean" }, 400);
      await store.setEnabled(userId, name, body.enabled);
      return context.json({ enabled: body.enabled });
    });

    app.post("/api/integrations/:id/refresh", async (context) => {
      const userId = portalUser(getCookie(context, "gateway_session"));
      if (!userId) return context.json({ error: "Sign in required" }, 401);
      const integration = catalog.find(context.req.param("id"));
      if (!integration) return context.json({ error: "Unknown integration" }, 404);
      return context.json({ status: await catalog.refresh(integration.config.id) });
    });

    app.get("/api/catalog", (context) => {
      const userId = portalUser(getCookie(context, "gateway_session"));
      if (!userId) return context.json({ error: "Sign in required" }, 401);
      return context.json({
        integrations: discovered.map((integration) => ({
          id: integration.config.id,
          name: integration.config.name,
          status: integration.status,
          stale: integration.status === "unavailable" && Boolean(integration.capturedAt),
          lastRefreshedAt: integration.capturedAt,
          connected: store.hasCredential(userId, integration.config.id),
          tools: effectiveTools.catalogFor(userId, integration),
        })),
      });
    });

    app.get("/api/calls", (context) => {
      const userId = portalUser(getCookie(context, "gateway_session"));
      if (!userId) return context.json({ error: "Sign in required" }, 401);
      return context.json({ calls: audit.list(userId) });
    });

    app.all("/mcp", async (context) => {
      const userId = store.resolveGatewayToken(bearerToken(context.req.raw));
      if (!userId) {
        return context.text("Gateway token required", 401);
      }
      if (context.req.method === "POST" && context.req.header("Mcp-Method") === "tools/call") {
        const request = await context.req.raw.clone().json().catch(() => null) as {
          jsonrpc?: string; id?: string | number; method?: string;
          params?: { name?: string; arguments?: unknown };
        } | null;
        const name = request?.params?.name;
        if (request?.method === "tools/call" && typeof name === "string" && context.req.header("Mcp-Name") === name) {
          const decision = effectiveTools.resolve(userId, name);
          if (!decision?.effective) {
            return context.json(await outcomes.reject({
              userId, exposedTool: name,
              integrationId: decision?.integration.config.id ?? "unknown",
              downstreamTool: decision?.tool.name ?? "unknown",
              requestId: request.id, reason: "denied",
            }));
          }
          const { integration, tool } = decision;
          const validation = await fromJsonSchema(tool.inputSchema as JsonSchemaType)["~standard"].validate(request.params?.arguments ?? {});
          if (validation.issues) {
            return context.json(await outcomes.reject({
              userId, exposedTool: name,
              integrationId: integration.config.id, downstreamTool: tool.name,
              requestId: request.id, reason: "invalid_arguments",
            }));
          }
        }
      }
      return await handler.fetch(context.req.raw);
    });

    const httpServer = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: options.port });
    if (!httpServer.listening) await once(httpServer, "listening");
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Could not determine gateway server address");

    return {
      url: `http://127.0.0.1:${address.port}/mcp`,
      close: async () => {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
        await handler.close();
      },
    };
  } catch (error) {
    throw error;
  }
}
