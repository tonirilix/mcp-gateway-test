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
  directory = await mkdtemp(join(tmpdir(), "mcp-gateway-demo-"));
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

async function connectClient(token: string) {
  const client = new Client(
    { name: "complete-demo-test", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return client;
}

test("a complete local demo routes both users, enforces policy, and explains a failure", async () => {
  const standard = await connectDemoUser(
    gateway.url,
    { gitlab: "gl-standard", analytics: "an-standard" },
    ["gitlab__list_issues", "gitlab__create_issue", "analytics__list_issues"],
  );
  const admin = await connectDemoUser(
    gateway.url,
    { analytics: "an-admin" },
    ["analytics__list_users", "analytics__create_user", "analytics__deactivate_user"],
    "admin",
  );
  const standardClient = await connectClient(standard.token);
  const adminClient = await connectClient(admin.token);
  try {
    expect((await standardClient.listTools()).tools.map((tool) => tool.name)).toEqual([
      "gitlab__list_issues", "gitlab__create_issue", "analytics__list_issues",
    ]);
    expect((await adminClient.listTools()).tools.map((tool) => tool.name)).toEqual([
      "analytics__list_users", "analytics__create_user", "analytics__deactivate_user",
    ]);

    const issue = await standardClient.callTool({
      name: "gitlab__create_issue", arguments: { projectPath: "team/demo", title: "Demo issue" },
    });
    expect(issue.content).toEqual([{ type: "text", text: "Created issue #103" }]);
    const analyticsResult = await standardClient.callTool({
      name: "analytics__list_issues", arguments: { workspace: "sales" },
    });
    expect(analyticsResult.content).toEqual([{ type: "text", text: "standard: AN-7 Pipeline lagging" }]);

    const createdUser = await adminClient.callTool({
      name: "analytics__create_user", arguments: { name: "Casey", email: "casey@example.test" },
    });
    expect(createdUser.content).toEqual([{ type: "text", text: "Created Analytics user U-2" }]);
    const deactivated = await adminClient.callTool({
      name: "analytics__deactivate_user", arguments: { userId: "U-2" },
    });
    expect(deactivated.content).toEqual([{ type: "text", text: "Deactivated Analytics user U-2" }]);

    await expect(standardClient.callTool({
      name: "analytics__create_user", arguments: { name: "Wrong", email: "wrong@example.test" },
    })).rejects.toThrow();

    await analytics.close();
    await fetch(new URL("/api/integrations/analytics/refresh", gateway.url), {
      method: "POST", headers: { Cookie: standard.cookie },
    });
    const catalog = await (await fetch(new URL("/api/catalog", gateway.url), { headers: { Cookie: standard.cookie } })).json();
    expect(catalog.integrations[1]).toMatchObject({ status: "unavailable", stale: true });
    const failed = await standardClient.callTool({ name: "analytics__list_issues", arguments: { workspace: "sales" } });
    expect(failed._meta?.["gateway/outcome"]).toBe("unavailable");

    const calls = await (await fetch(new URL("/api/calls", gateway.url), { headers: { Cookie: standard.cookie } })).json();
    expect(calls.calls.map((call: { outcome: string }) => call.outcome)).toEqual([
      "success", "success", "denied", "unavailable",
    ]);
    expect(calls.calls.at(-1).correlationId).toBe(failed._meta?.["gateway/correlationId"]);
  } finally {
    await standardClient.close();
    await adminClient.close();
  }
});
