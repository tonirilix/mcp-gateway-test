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

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "mcp-gateway-opt-in-"));
  gitlab = await startGitLabServer({ port: 0 });
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

async function setEnabled(cookie: string, name: string, enabled: boolean) {
  return fetch(new URL(`/api/tools/${name}/enabled`, gateway.url), {
    method: "PUT",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
}

test("each user opts into GitLab tools and disabled calls are denied", async () => {
  const standard = await connectDemoUser(gateway.url, { gitlab: "gl-standard" }, []);
  const client = new Client(
    { name: "opt-in-test", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url), {
      requestInit: { headers: { Authorization: `Bearer ${standard.token}` } },
    }));
    expect((await client.listTools()).tools).toEqual([]);

    expect((await setEnabled(standard.cookie, "gitlab__list_issues", true)).status).toBe(200);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["gitlab__list_issues"]);
    await expect(client.callTool({ name: "gitlab__create_issue", arguments: { projectPath: "team/demo", title: "Triage flaky tests" } })).rejects.toThrow();

    expect((await setEnabled(standard.cookie, "gitlab__create_issue", true)).status).toBe(200);
    const created = await client.callTool({ name: "gitlab__create_issue", arguments: { projectPath: "team/demo", title: "Triage flaky tests" } });
    expect(created.content).toEqual([{ type: "text", text: "Created issue #103" }]);

    expect((await setEnabled(standard.cookie, "gitlab__delete_issue", true)).status).toBe(200);
    const deleted = await client.callTool({ name: "gitlab__delete_issue", arguments: { projectPath: "team/demo", issueId: 103 } });
    expect(deleted.content).toEqual([{ type: "text", text: "Deleted issue #103" }]);

    expect((await setEnabled(standard.cookie, "gitlab__list_issues", false)).status).toBe(200);
    await expect(client.callTool({ name: "gitlab__list_issues", arguments: { projectPath: "team/demo" } })).rejects.toThrow();
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "gitlab__create_issue", "gitlab__delete_issue",
    ]);

    const catalog = await (await fetch(new URL("/api/catalog", gateway.url), { headers: { Cookie: standard.cookie } })).json();
    expect(catalog.integrations[0].tools).toMatchObject([
      { name: "gitlab__list_issues", behavior: "read", enabled: false },
      { name: "gitlab__create_issue", behavior: "write", enabled: true },
      { name: "gitlab__delete_issue", behavior: "write", enabled: true },
    ]);

    const admin = await connectDemoUser(gateway.url, { gitlab: "gl-admin" }, [], "admin");
    const adminClient = new Client(
      { name: "independent-opt-in-test", version: "0.1.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    try {
      await adminClient.connect(new StreamableHTTPClientTransport(new URL(gateway.url), {
        requestInit: { headers: { Authorization: `Bearer ${admin.token}` } },
      }));
      expect((await adminClient.listTools()).tools).toEqual([]);
    } finally {
      await adminClient.close();
    }
  } finally {
    await client.close();
  }
});
