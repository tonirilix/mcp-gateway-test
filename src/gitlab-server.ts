import { serve } from "@hono/node-server";
import { once } from "node:events";
import { createMcpHonoApp, localhostHostValidation } from "@modelcontextprotocol/hono";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { mockAuthFailure, mockCaller } from "./mock-auth.js";

export async function startGitLabServer({ port }: { port: number }) {
  const issues = new Map<string, Array<{ id: number; title: string }>>([
    ["team/demo", [{ id: 101, title: "Fix login" }, { id: 102, title: "Update docs" }]],
  ]);
  let nextId = 103;
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
        async ({ projectPath }, context) => {
          const found = issues.get(projectPath) ?? [];
          return { content: [{
            type: "text",
            text: found.length
              ? `${mockCaller(context.http?.req, "gl")}: ${found.map((issue) => `#${issue.id} ${issue.title}`).join("\n")}`
              : `No issues found for ${projectPath}`,
          }] };
        },
      );
      server.registerTool(
        "create_issue",
        {
          description: "Create an issue in the mock GitLab project.",
          inputSchema: z.object({ projectPath: z.string(), title: z.string().min(1) }),
          annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        },
        async ({ projectPath, title }) => {
          const id = nextId++;
          const projectIssues = issues.get(projectPath) ?? [];
          projectIssues.push({ id, title });
          issues.set(projectPath, projectIssues);
          return { content: [{ type: "text", text: `Created issue #${id}` }] };
        },
      );
      server.registerTool(
        "delete_issue",
        {
          description: "Delete an issue from the mock GitLab project.",
          inputSchema: z.object({ projectPath: z.string(), issueId: z.number().int() }),
          annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        },
        async ({ projectPath, issueId }) => {
          const projectIssues = issues.get(projectPath) ?? [];
          const index = projectIssues.findIndex((issue) => issue.id === issueId);
          if (index < 0) return { isError: true, content: [{ type: "text", text: `Issue #${issueId} not found` }] };
          projectIssues.splice(index, 1);
          return { content: [{ type: "text", text: `Deleted issue #${issueId}` }] };
        },
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
