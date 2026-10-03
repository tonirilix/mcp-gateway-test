import { serve } from "@hono/node-server";
import { once } from "node:events";
import { createMcpHonoApp, localhostHostValidation } from "@modelcontextprotocol/hono";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { mockAuthFailure, mockCaller } from "./mock-auth.js";

export async function startAnalyticsServer({ port }: { port: number }) {
  const users = [{ id: "U-1", name: "Avery", email: "avery@example.test", active: true }];
  let nextUserId = 2;
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: "mock-analytics", version: "0.1.0" });
      server.registerTool(
        "list_issues",
        {
          description: "List issues in the mock Analytics workspace.",
          inputSchema: z.object({ workspace: z.string().describe("Analytics workspace name") }),
          annotations: { readOnlyHint: true, openWorldHint: false },
        },
        async ({ workspace }, context) => ({
          content: [{ type: "text", text: workspace === "sales" ? `${mockCaller(context.http?.req, "an")}: AN-7 Pipeline lagging` : `No issues found for ${workspace}` }],
        }),
      );
      server.registerTool(
        "list_users",
        {
          description: "List users in the mock Analytics application.",
          inputSchema: z.object({}),
          annotations: { readOnlyHint: true, openWorldHint: false },
        },
        async () => ({
          content: [{ type: "text", text: users.map((user) => `${user.id} ${user.name} (${user.active ? "active" : "inactive"})`).join("\n") }],
        }),
      );
      server.registerTool(
        "create_user",
        {
          description: "Create a user in the mock Analytics application.",
          inputSchema: z.object({ name: z.string().min(1), email: z.email() }),
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        },
        async ({ name, email }) => {
          const id = `U-${nextUserId++}`;
          users.push({ id, name, email, active: true });
          return { content: [{ type: "text", text: `Created Analytics user ${id}` }] };
        },
      );
      server.registerTool(
        "deactivate_user",
        {
          description: "Deactivate a user in the mock Analytics application.",
          inputSchema: z.object({ userId: z.string() }),
          annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        },
        async ({ userId }) => {
          const user = users.find((item) => item.id === userId);
          if (!user) return { isError: true, content: [{ type: "text", text: `Analytics user ${userId} not found` }] };
          user.active = false;
          return { content: [{ type: "text", text: `Deactivated Analytics user ${userId}` }] };
        },
      );
      return server;
    },
    { legacy: "reject" },
  );

  const app = createMcpHonoApp();
  app.use("*", localhostHostValidation());
  app.all("/mcp", (context) => mockAuthFailure(context.req.raw, "an") ?? handler.fetch(context.req.raw));

  const httpServer = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
  if (!httpServer.listening) await once(httpServer, "listening");
  const address = httpServer.address();
  if (!address || typeof address === "string") throw new Error("Could not determine mock Analytics server address");

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      await handler.close();
    },
  };
}
