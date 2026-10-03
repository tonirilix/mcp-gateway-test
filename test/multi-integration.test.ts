import { afterAll, beforeAll, expect, test } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startAnalyticsServer } from "../src/analytics-server.js";
import { startGitLabServer } from "../src/gitlab-server.js";
import { startGatewayServer } from "../src/gateway-server.js";

let gitlab: Awaited<ReturnType<typeof startGitLabServer>>;
let analytics: Awaited<ReturnType<typeof startAnalyticsServer>>;
let gateway: Awaited<ReturnType<typeof startGatewayServer>>;

beforeAll(async () => {
  gitlab = await startGitLabServer({ port: 0 });
  analytics = await startAnalyticsServer({ port: 0 });
  gateway = await startGatewayServer({
    port: 0,
    gitlabUrl: gitlab.url,
    analyticsUrl: analytics.url,
  });
});

afterAll(async () => {
  await gateway?.close();
  await analytics?.close();
  await gitlab?.close();
});

test("both integrations appear in MCP and the portal catalog without name collisions", async () => {
  const client = new Client(
    { name: "multi-integration-test", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "gitlab__list_issues",
      "analytics__list_issues",
    ]);
    expect(tools[1]).toMatchObject({
      description: "List issues in the mock Analytics workspace.",
      inputSchema: {
        type: "object",
        properties: { workspace: { type: "string" } },
        required: ["workspace"],
      },
    });

    const result = await client.callTool({
      name: "analytics__list_issues",
      arguments: { workspace: "sales" },
    });
    expect(result.content).toEqual([{ type: "text", text: "AN-7 Pipeline lagging" }]);

    const catalogResponse = await fetch(new URL("/api/catalog", gateway.url));
    expect(catalogResponse.status).toBe(200);
    const catalog = await catalogResponse.json();
    expect(catalog).toMatchObject({
      integrations: [
        { id: "gitlab", status: "available", tools: [{ name: "gitlab__list_issues", behavior: "read" }] },
        { id: "analytics", status: "available", tools: [{ name: "analytics__list_issues", behavior: "read" }] },
      ],
    });
  } finally {
    await client.close();
  }
});
