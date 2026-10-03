import { serve } from "@hono/node-server";
import { once } from "node:events";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHonoApp, localhostHostValidation } from "@modelcontextprotocol/hono";
import { createMcpHandler, fromJsonSchema, McpServer, type JsonSchemaType } from "@modelcontextprotocol/server";

type IntegrationConfig = { id: string; name: string; url: string };

export async function startGatewayServer({
  port,
  gitlabUrl,
  analyticsUrl,
}: {
  port: number;
  gitlabUrl: string;
  analyticsUrl?: string;
}) {
  const configs: IntegrationConfig[] = [{ id: "gitlab", name: "GitLab", url: gitlabUrl }];
  if (analyticsUrl) configs.push({ id: "analytics", name: "Analytics", url: analyticsUrl });

  const connected: Array<{
    config: IntegrationConfig;
    client: Client;
    tools: Awaited<ReturnType<Client["listTools"]>>["tools"];
  }> = [];
  try {
    for (const config of configs) {
      const client = new Client(
        { name: `gateway-${config.id}`, version: "0.1.0" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } },
      );
      await client.connect(new StreamableHTTPClientTransport(new URL(config.url)));
      try {
        const { tools } = await client.listTools();
        connected.push({ config, client, tools });
      } catch (error) {
        await client.close();
        throw error;
      }
    }

    const handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: "mcp-gateway", version: "0.1.0" });
        for (const { config, client, tools } of connected) {
          for (const tool of tools) {
            server.registerTool(
              `${config.id}__${tool.name}`,
              {
                description: tool.description,
                inputSchema: fromJsonSchema(tool.inputSchema as unknown as JsonSchemaType),
                annotations: tool.annotations,
              },
              async (args) => client.callTool({ name: tool.name, arguments: args as Record<string, unknown> }),
            );
          }
        }
        return server;
      },
      { legacy: "reject" },
    );

    const app = createMcpHonoApp();
    app.use("*", localhostHostValidation());
    app.get("/api/catalog", (context) =>
      context.json({
        integrations: connected.map(({ config, tools }) => ({
          id: config.id,
          name: config.name,
          status: "available",
          tools: tools.map((tool) => ({
            name: `${config.id}__${tool.name}`,
            originalName: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            behavior: "read",
          })),
        })),
      }),
    );
    app.all("/mcp", (context) => handler.fetch(context.req.raw));

    const httpServer = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
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
        await Promise.all(connected.map(({ client }) => client.close()));
      },
    };
  } catch (error) {
    await Promise.all(connected.map(({ client }) => client.close()));
    throw error;
  }
}
