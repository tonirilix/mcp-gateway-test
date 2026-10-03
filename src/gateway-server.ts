import { serve } from "@hono/node-server";
import { once } from "node:events";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHonoApp, localhostHostValidation } from "@modelcontextprotocol/hono";
import { createMcpHandler, fromJsonSchema, McpServer, type JsonSchemaType } from "@modelcontextprotocol/server";

export async function startGatewayServer({ port, gitlabUrl }: { port: number; gitlabUrl: string }) {
  const downstream = new Client(
    { name: "mcp-gateway", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await downstream.connect(new StreamableHTTPClientTransport(new URL(gitlabUrl)));

  try {
    const { tools } = await downstream.listTools();
    const handler = createMcpHandler(
      () => {
        const server = new McpServer({ name: "mcp-gateway", version: "0.1.0" });
        for (const tool of tools) {
          server.registerTool(
            `gitlab__${tool.name}`,
            {
              description: tool.description,
              inputSchema: fromJsonSchema(tool.inputSchema as unknown as JsonSchemaType),
              annotations: tool.annotations,
            },
            async (args) =>
              downstream.callTool({
                name: tool.name,
                arguments: args as Record<string, unknown>,
              }),
          );
        }
        return server;
      },
      { legacy: "reject" },
    );

    const app = createMcpHonoApp();
    app.use("*", localhostHostValidation());
    app.all("/mcp", (context) => handler.fetch(context.req.raw));

    const httpServer = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
    if (!httpServer.listening) await once(httpServer, "listening");
    const address = httpServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Could not determine gateway server address");
    }

    return {
      url: `http://127.0.0.1:${address.port}/mcp`,
      close: async () => {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => (error ? reject(error) : resolve()));
        });
        await handler.close();
        await downstream.close();
      },
    };
  } catch (error) {
    await downstream.close();
    throw error;
  }
}
