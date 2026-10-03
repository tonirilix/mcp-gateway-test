import { serve } from "@hono/node-server";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHonoApp, localhostHostValidation } from "@modelcontextprotocol/hono";
import { createMcpHandler, fromJsonSchema, McpServer, type JsonSchemaType, type Tool } from "@modelcontextprotocol/server";
import { getCookie, setCookie } from "hono/cookie";
import { GatewayStore, type UserId } from "./gateway-store.js";

type IntegrationConfig = { id: string; name: string; url: string };
type IntegrationRuntime = {
  config: IntegrationConfig;
  tools: Tool[];
  status: "available" | "unavailable";
  capturedAt?: string;
};

type GatewayOptions = {
  port: number;
  gitlabUrl: string;
  analyticsUrl?: string;
  stateFile: string;
  encryptionKey: Buffer;
  seedPasswords: Record<UserId, string>;
};

function policyFor(integrationId: string, toolName: string) {
  const read = integrationId === "gitlab" && toolName === "list_issues" ||
    integrationId === "analytics" && (toolName === "list_issues" || toolName === "list_users");
  const adminOnly = integrationId === "analytics" && (toolName === "create_user" || toolName === "deactivate_user");
  return { behavior: read ? "read" as const : "write" as const, adminOnly };
}

function bearerToken(request: Request) {
  return request.headers.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
}

function makeClient(name: string, url: string, token?: string) {
  const client = new Client(
    { name, version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(url), token ? {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  } : undefined);
  return { client, transport };
}

export async function startGatewayServer(options: GatewayOptions) {
  const store = await GatewayStore.open({
    file: options.stateFile,
    key: options.encryptionKey,
    seedPasswords: options.seedPasswords,
  });
  const configs: IntegrationConfig[] = [{ id: "gitlab", name: "GitLab", url: options.gitlabUrl }];
  if (options.analyticsUrl) configs.push({ id: "analytics", name: "Analytics", url: options.analyticsUrl });

  const discovered: IntegrationRuntime[] = configs.map((config) => {
    const cached = store.getCatalog(config.id);
    return { config, tools: cached?.tools ?? [], status: "unavailable", capturedAt: cached?.capturedAt };
  });

  async function refresh(integration: IntegrationRuntime) {
    const { config } = integration;
    const { client, transport } = makeClient(`gateway-discovery-${config.id}`, config.url);
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const fingerprints = Object.fromEntries(tools.map((tool) => [
        `${config.id}__${tool.name}`,
        createHash("sha256").update(JSON.stringify({
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          policy: policyFor(config.id, tool.name),
        })).digest("hex"),
      ]));
      await store.replaceCatalog(config.id, tools, fingerprints);
      integration.tools = tools;
      integration.status = "available";
      integration.capturedAt = store.getCatalog(config.id)?.capturedAt;
    } catch {
      integration.status = "unavailable";
    } finally {
      await client.close();
    }
    return integration.status;
  }

  try {
    for (const integration of discovered) await refresh(integration);

    const handler = createMcpHandler(
      ({ requestInfo }) => {
        const userId = requestInfo && store.resolveGatewayToken(bearerToken(requestInfo));
        if (!userId) throw new Error("Unauthenticated MCP request");
        const server = new McpServer(
          { name: "mcp-gateway", version: "0.1.0" },
          { capabilities: { tools: {} } },
        );
        for (const integration of discovered) {
          const { config, tools } = integration;
          if (!store.hasCredential(userId, config.id)) continue;
          for (const tool of tools) {
            if (policyFor(config.id, tool.name).adminOnly && userId !== "admin") continue;
            if (!store.isEnabled(userId, `${config.id}__${tool.name}`)) continue;
            server.registerTool(
              `${config.id}__${tool.name}`,
              {
                description: tool.description,
                inputSchema: fromJsonSchema(tool.inputSchema as unknown as JsonSchemaType),
                annotations: tool.annotations,
              },
              async (args) => {
                if (integration.status === "unavailable") throw new Error("Downstream integration is unavailable");
                const credential = store.getCredential(userId, config.id);
                if (!credential) throw new Error("Integration is not connected");
                const { client, transport } = makeClient(`gateway-call-${config.id}`, config.url, credential);
                try {
                  await client.connect(transport);
                  return await client.callTool({ name: tool.name, arguments: args as Record<string, unknown> });
                } finally {
                  await client.close();
                }
              },
            );
          }
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
        httpOnly: true, sameSite: "Strict", path: "/", maxAge: 8 * 60 * 60,
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
      const config = configs.find((item) => item.id === context.req.param("id"));
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
      const integration = discovered.find(({ config, tools }) =>
        tools.some((tool) => `${config.id}__${tool.name}` === name),
      );
      if (!integration) return context.json({ error: "Unknown tool" }, 404);
      const originalName = integration.tools.find((tool) => `${integration.config.id}__${tool.name}` === name)!.name;
      if (policyFor(integration.config.id, originalName).adminOnly && userId !== "admin") {
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
      const integration = discovered.find(({ config }) => config.id === context.req.param("id"));
      if (!integration) return context.json({ error: "Unknown integration" }, 404);
      return context.json({ status: await refresh(integration) });
    });

    app.get("/api/catalog", (context) => {
      const userId = portalUser(getCookie(context, "gateway_session"));
      if (!userId) return context.json({ error: "Sign in required" }, 401);
      return context.json({
        integrations: discovered.map(({ config, tools, status, capturedAt }) => ({
          id: config.id,
          name: config.name,
          status,
          stale: status === "unavailable" && Boolean(capturedAt),
          lastRefreshedAt: capturedAt,
          connected: store.hasCredential(userId, config.id),
          tools: tools.map((tool) => ({
            name: `${config.id}__${tool.name}`,
            originalName: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            ...policyFor(config.id, tool.name),
            eligible: !policyFor(config.id, tool.name).adminOnly || userId === "admin",
            enabled: store.isEnabled(userId, `${config.id}__${tool.name}`),
          })),
        })),
      });
    });

    app.all("/mcp", async (context) => {
      if (!store.resolveGatewayToken(bearerToken(context.req.raw))) {
        return context.text("Gateway token required", 401);
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
