import { serve } from "@hono/node-server";
import { once } from "node:events";
import { createMcpHonoApp, localhostHostValidation } from "@modelcontextprotocol/hono";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { mockAuthFailure, mockCaller } from "./mock-auth.js";

export async function startGitLabServer({ port }: { port: number }) {
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: "mock-gitlab", version: "0.1.0" });
      server.registerTool(
        "list_issues",
        {
          description: "List issues in the mock GitLab project.",
          inputSchema: z.object({
            projectPath: z.string().describe("GitLab project path, such as team/demo"),
          }),
          annotations: { readOnlyHint: true, openWorldHint: false },
        },
        async ({ projectPath }, context) => ({
          content: [
            {
              type: "text",
              text:
                projectPath === "team/demo"
                  ? `${mockCaller(context.http?.req, "gl")}: #101 Fix login\n#102 Update docs`
                  : `No issues found for ${projectPath}`,
            },
          ],
        }),
      );
      return server;
    },
    { legacy: "reject" },
  );

  const app = createMcpHonoApp();
  app.use("*", localhostHostValidation());
  app.all("/mcp", (context) => mockAuthFailure(context.req.raw, "gl") ?? handler.fetch(context.req.raw));

  const httpServer = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
  if (!httpServer.listening) await once(httpServer, "listening");
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine mock GitLab server address");
  }

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
