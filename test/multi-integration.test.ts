import { afterAll, beforeAll, expect, test } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAnalyticsServer } from "../src/analytics-server.js";
import { startGitLabServer } from "../src/gitlab-server.js";
import { startGatewayServer } from "../src/gateway-server.js";
import { connectDemoUser } from "./helpers.js";

let gitlab: Awaited<ReturnType<typeof startGitLabServer>>;
let analytics: Awaited<ReturnType<typeof startAnalyticsServer>>;
let gateway: Awaited<ReturnType<typeof startGatewayServer>>;
let directory: string;
let identity: Awaited<ReturnType<typeof connectDemoUser>>;

beforeAll(async () => {
  gitlab = await startGitLabServer({ port: 0 });
  analytics = await startAnalyticsServer({ port: 0 });
  directory = await mkdtemp(join(tmpdir(), "mcp-gateway-multi-"));
  gateway = await startGatewayServer({
    port: 0,
    gitlabUrl: gitlab.url,
    analyticsUrl: analytics.url,
    stateFile: join(directory, "state.json"),
    encryptionKey: Buffer.alloc(32, 7),
    seedPasswords: { standard: "standard-password", admin: "admin-password" },
  });
  identity = await connectDemoUser(
    gateway.url,
    { gitlab: "gl-standard", analytics: "an-standard" },
    ["gitlab__list_issues", "analytics__list_issues"],
  );
});

afterAll(async () => {
  await gateway?.close();
  await analytics?.close();
  await gitlab?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("both integrations appear in MCP and the portal catalog without name collisions", async () => {
  const client = new Client(
    { name: "multi-integration-test", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url), {
      requestInit: { headers: { Authorization: `Bearer ${identity.token}` } },
    }));
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
    expect(result.content).toEqual([{ type: "text", text: "standard: AN-7 Pipeline lagging" }]);

    const catalogResponse = await fetch(new URL("/api/catalog", gateway.url), { headers: { Cookie: identity.cookie } });
    expect(catalogResponse.status).toBe(200);
    const catalog = await catalogResponse.json();
    expect(catalog.integrations.map((integration: { id: string }) => integration.id)).toEqual(["gitlab", "analytics"]);
    expect(catalog.integrations[0].tools[0]).toMatchObject({ name: "gitlab__list_issues", behavior: "read" });
    expect(catalog.integrations[1].tools[0]).toMatchObject({ name: "analytics__list_issues", behavior: "read" });
  } finally {
    await client.close();
  }
});
