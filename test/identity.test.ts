import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startAnalyticsServer } from "../src/analytics-server.js";
import { startGitLabServer } from "../src/gitlab-server.js";
import { startGatewayServer } from "../src/gateway-server.js";

let directory: string;
let gitlab: Awaited<ReturnType<typeof startGitLabServer>>;
let analytics: Awaited<ReturnType<typeof startAnalyticsServer>>;
let gateway: Awaited<ReturnType<typeof startGatewayServer>>;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "mcp-gateway-identity-"));
  gitlab = await startGitLabServer({ port: 0 });
  analytics = await startAnalyticsServer({ port: 0 });
  gateway = await startGatewayServer({
    port: 0,
    gitlabUrl: gitlab.url,
    analyticsUrl: analytics.url,
    stateFile: join(directory, "state.json"),
    encryptionKey: Buffer.alloc(32, 7),
    seedPasswords: { standard: "standard-password", admin: "admin-password" },
  });
});

afterAll(async () => {
  await gateway?.close();
  await analytics?.close();
  await gitlab?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function login(username: string, password: string) {
  const response = await fetch(new URL("/api/login", gateway.url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  return cookie!;
}

async function configure(cookie: string, integration: string, credential: string) {
  const response = await fetch(new URL(`/api/integrations/${integration}/credential`, gateway.url), {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ token: credential }),
  });
  expect(response.status).toBe(200);
}

async function issueToken(cookie: string) {
  const response = await fetch(new URL("/api/token", gateway.url), {
    method: "POST",
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
  return (await response.json() as { token: string }).token;
}

test("two portal users connect and call GitLab under separate identities", async () => {
  const standardCookie = await login("standard", "standard-password");
  const adminCookie = await login("admin", "admin-password");
  await configure(standardCookie, "gitlab", "gl-standard");
  await configure(adminCookie, "gitlab", "gl-admin");

  const standardToken = await issueToken(standardCookie);
  const adminToken = await issueToken(adminCookie);

  for (const [token, expectedUser] of [[standardToken, "standard"], [adminToken, "admin"]]) {
    const client = new Client(
      { name: "identity-test", version: "0.1.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }));
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("gitlab__list_issues");
      const result = await client.callTool({ name: "gitlab__list_issues", arguments: { projectPath: "team/demo" } });
      expect(result.content).toEqual([{ type: "text", text: `${expectedUser}: #101 Fix login\n#102 Update docs` }]);
    } finally {
      await client.close();
    }
  }

  const standardCatalog = await fetch(new URL("/api/catalog", gateway.url), { headers: { Cookie: standardCookie } });
  expect(standardCatalog.status).toBe(200);
  const catalog = await standardCatalog.json();
  expect(catalog.integrations).toMatchObject([
    { id: "gitlab", connected: true },
    { id: "analytics", connected: false },
  ]);
  expect(JSON.stringify(catalog)).not.toContain("gl-standard");

  const stored = await readFile(join(directory, "state.json"), "utf8");
  expect(stored).not.toContain("gl-standard");
  expect(stored).not.toContain(standardToken);
  expect(stored).not.toContain("standard-password");
});

test("missing or invalid gateway tokens cannot use MCP", async () => {
  for (const authorization of [undefined, "Bearer invalid"]) {
    const headers = new Headers({
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/list",
    });
    if (authorization) headers.set("Authorization", authorization);
    const response = await fetch(new URL(gateway.url), {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
  }
});
