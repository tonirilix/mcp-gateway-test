import { serve } from "@hono/node-server";
import { once } from "node:events";
import { createMcpHonoApp, localhostHostValidation } from "@modelcontextprotocol/hono";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { mockAuthFailure, mockCaller } from "./mock-auth.js";

export async function startGitLabServer({
  port,
  variant = "base",
}: {
  port: number;
  variant?: "base" | "added" | "changed" | "removed" | "protocol_failure";
}) {
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
          inputSchema: variant === "changed"
            ? z.object({ projectPath: z.string().describe("GitLab project path, such as team/demo"), state: z.enum(["open", "closed"]) })
            : z.object({ projectPath: z.string().describe("GitLab project path, such as team/demo") }),
          annotations: { readOnlyHint: true, openWorldHint: false },
        },
        async ({ projectPath }, context) => {
          if (projectPath === "slow") await new Promise((resolve) => setTimeout(resolve, 500));
          if (projectPath === "tool-error") {
            return { isError: true, content: [{ type: "text", text: "Mock GitLab tool error" }] };
          }
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
      if (variant !== "removed") server.registerTool(
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
      if (variant === "added") server.registerTool(
        "get_project",
        {
          description: "Get a mock GitLab project summary.",
          inputSchema: z.object({ projectPath: z.string() }),
          annotations: { readOnlyHint: true, openWorldHint: false },
        },
        async ({ projectPath }) => ({ content: [{ type: "text", text: `Project ${projectPath}` }] }),
      );
      return server;
    },
    { legacy: "reject" },
  );

  const app = createMcpHonoApp();
  app.use("*", localhostHostValidation());
  app.all("/mcp", async (context) => {
    const rejected = mockAuthFailure(context.req.raw, "gl");
    if (rejected) return rejected;
    if (variant === "protocol_failure" && context.req.header("Mcp-Method") === "tools/call") {
      return context.text("Mock downstream protocol failure", 500);
    }
    return await handler.fetch(context.req.raw);
  });

  const httpServer = serve({ fetch: app.fetch, hostname: "127.0.0.1", port });
  if (!httpServer.listening) await once(httpServer, "listening");
  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine mock GitLab server address");
  }

  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
      await handler.close();
    },
  };
}
