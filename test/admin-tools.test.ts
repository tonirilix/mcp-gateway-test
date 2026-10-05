import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startAnalyticsServer } from "../src/analytics-server.js";
import { startGitLabServer } from "../src/gitlab-server.js";
import { startGatewayServer } from "../src/gateway-server.js";
import { connectDemoUser } from "./helpers.js";

let directory: string;
let gitlab: Awaited<ReturnType<typeof startGitLabServer>>;
let analytics: Awaited<ReturnType<typeof startAnalyticsServer>>;
let gateway: Awaited<ReturnType<typeof startGatewayServer>>;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "mcp-gateway-admin-"));
  gitlab = await startGitLabServer({ port: 0 });
  analytics = await startAnalyticsServer({ port: 0 });
  gateway = await startGatewayServer({
    port: 0, gitlabUrl: gitlab.url, analyticsUrl: analytics.url,
    stateFile: join(directory, "state.json"), encryptionKey: Buffer.alloc(32, 7),
    seedPasswords: { standard: "standard-password", admin: "admin-password" },
  });
});

afterAll(async () => {
  await gateway?.close();
  await analytics?.close();
  await gitlab?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

function mcpClient(url: string, token: string) {
  const client = new Client(
    { name: "admin-policy-test", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  return { client, transport: new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }) };
}

test("Analytics user management is admin-only while ordinary tools remain opt-in", async () => {
  const standard = await connectDemoUser(gateway.url, { analytics: "an-standard" }, ["analytics__list_users"]);
  const admin = await connectDemoUser(gateway.url, { analytics: "an-admin" }, ["analytics__list_users"], "admin");

  const standardCatalog = await (await fetch(new URL("/api/catalog", gateway.url), { headers: { Cookie: standard.cookie } })).json();
  expect(standardCatalog.integrations[1].tools).toMatchObject([
    { name: "analytics__list_issues", behavior: "read", eligible: true },
    { name: "analytics__list_users", behavior: "read", eligible: true },
    { name: "analytics__create_user", behavior: "write", adminOnly: true, eligible: false },
    { name: "analytics__deactivate_user", behavior: "write", adminOnly: true, eligible: false },
  ]);

  const denied = await fetch(new URL("/api/tools/analytics__create_user/enabled", gateway.url), {
    method: "PUT", headers: { Cookie: standard.cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  });
  expect(denied.status).toBe(403);

  const standardMcp = mcpClient(gateway.url, standard.token);
  await standardMcp.client.connect(standardMcp.transport);
  try {
    expect((await standardMcp.client.listTools()).tools.map((tool) => tool.name)).toEqual(["analytics__list_users"]);
    await expect(standardMcp.client.callTool({
      name: "analytics__create_user", arguments: { name: "Casey", email: "casey@example.test" },
    })).rejects.toThrow();
  } finally {
    await standardMcp.client.close();
  }

  for (const name of ["analytics__create_user", "analytics__deactivate_user"]) {
    const response = await fetch(new URL(`/api/tools/${name}/enabled`, gateway.url), {
      method: "PUT", headers: { Cookie: admin.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(response.status).toBe(200);
  }

  const adminMcp = mcpClient(gateway.url, admin.token);
  await adminMcp.client.connect(adminMcp.transport);
  try {
    const created = await adminMcp.client.callTool({
      name: "analytics__create_user", arguments: { name: "Casey", email: "casey@example.test" },
    });
    expect(created.content).toEqual([{ type: "text", text: "Created Analytics user U-2" }]);
    const before = await adminMcp.client.callTool({ name: "analytics__list_users", arguments: {} });
    expect(JSON.stringify(before.content)).toContain("Casey (active)");

    const deactivated = await adminMcp.client.callTool({ name: "analytics__deactivate_user", arguments: { userId: "U-2" } });
    expect(deactivated.content).toEqual([{ type: "text", text: "Deactivated Analytics user U-2" }]);
    const after = await adminMcp.client.callTool({ name: "analytics__list_users", arguments: {} });
    expect(JSON.stringify(after.content)).toContain("Casey (inactive)");
  } finally {
    await adminMcp.client.close();
  }
});
