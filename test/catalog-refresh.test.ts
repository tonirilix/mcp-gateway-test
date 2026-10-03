import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startGitLabServer } from "../src/gitlab-server.js";
import { startGatewayServer } from "../src/gateway-server.js";
import { connectDemoUser } from "./helpers.js";

let directory: string;
let gitlab: Awaited<ReturnType<typeof startGitLabServer>>;
let gateway: Awaited<ReturnType<typeof startGatewayServer>>;
let gitlabPort: number;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "mcp-gateway-refresh-"));
  gitlab = await startGitLabServer({ port: 0 });
  gitlabPort = Number(new URL(gitlab.url).port);
  gateway = await startGatewayServer({
    port: 0, gitlabUrl: gitlab.url, stateFile: join(directory, "state.json"),
    encryptionKey: Buffer.alloc(32, 7), seedPasswords: { standard: "standard-password", admin: "admin-password" },
  });
});

afterAll(async () => {
  await gateway?.close();
  await gitlab?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("refresh preserves stale tools, discovers new ones disabled, and invalidates changed tools", async () => {
  const identity = await connectDemoUser(
    gateway.url, { gitlab: "gl-standard" }, ["gitlab__list_issues", "gitlab__delete_issue"],
  );
  const client = new Client(
    { name: "refresh-test", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url), {
    requestInit: { headers: { Authorization: `Bearer ${identity.token}` } },
  }));

  const catalog = async () => (await fetch(new URL("/api/catalog", gateway.url), { headers: { Cookie: identity.cookie } })).json();
  const refresh = async () => fetch(new URL("/api/integrations/gitlab/refresh", gateway.url), {
    method: "POST", headers: { Cookie: identity.cookie },
  });

  try {
    await gitlab.close();
    expect((await refresh()).status).toBe(200);
    expect((await catalog()).integrations[0]).toMatchObject({ status: "unavailable", stale: true });
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("gitlab__list_issues");
    const failure = await client.callTool({ name: "gitlab__list_issues", arguments: { projectPath: "team/demo" } });
    expect(failure.isError).toBe(true);

    gitlab = await startGitLabServer({ port: gitlabPort, variant: "added" });
    expect((await refresh()).status).toBe(200);
    const addedCatalog = (await catalog()).integrations[0];
    expect(addedCatalog).toMatchObject({ status: "available", stale: false });
    expect(addedCatalog.tools.find((tool: { name: string }) => tool.name === "gitlab__get_project")).toMatchObject({ enabled: false });

    await gitlab.close();
    gitlab = await startGitLabServer({ port: gitlabPort, variant: "changed" });
    expect((await refresh()).status).toBe(200);
    const changed = (await catalog()).integrations[0].tools.find((tool: { name: string }) => tool.name === "gitlab__list_issues");
    expect(changed.inputSchema.required).toContain("state");
    expect(changed.enabled).toBe(false);
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("gitlab__list_issues");

    await gitlab.close();
    gitlab = await startGitLabServer({ port: gitlabPort, variant: "removed" });
    expect((await refresh()).status).toBe(200);
    expect((await catalog()).integrations[0].tools.map((tool: { name: string }) => tool.name)).not.toContain("gitlab__delete_issue");

    await gitlab.close();
    const restarted = await startGatewayServer({
      port: 0, gitlabUrl: gitlab.url, stateFile: join(directory, "state.json"),
      encryptionKey: Buffer.alloc(32, 7), seedPasswords: { standard: "standard-password", admin: "admin-password" },
    });
    try {
      const login = await fetch(new URL("/api/login", restarted.url), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "standard", password: "standard-password" }),
      });
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const saved = await (await fetch(new URL("/api/catalog", restarted.url), { headers: { Cookie: cookie } })).json();
      expect(saved.integrations[0]).toMatchObject({ status: "unavailable", stale: true });
      expect(saved.integrations[0].tools.map((tool: { name: string }) => tool.name)).toContain("gitlab__list_issues");
    } finally {
      await restarted.close();
    }
  } finally {
    await client.close();
  }
});
