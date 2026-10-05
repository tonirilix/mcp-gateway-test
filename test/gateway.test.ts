import { afterAll, beforeAll, expect, test } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startGitLabServer } from "../src/gitlab-server.js";
import { startGatewayServer } from "../src/gateway-server.js";
import { connectDemoUser } from "./helpers.js";

let gitlab: Awaited<ReturnType<typeof startGitLabServer>>;
let gateway: Awaited<ReturnType<typeof startGatewayServer>>;
let directory: string;
let token: string;

beforeAll(async () => {
  gitlab = await startGitLabServer({ port: 0 });
  directory = await mkdtemp(join(tmpdir(), "mcp-gateway-first-"));
  gateway = await startGatewayServer({
    port: 0, gitlabUrl: gitlab.url, stateFile: join(directory, "state.json"),
    encryptionKey: Buffer.alloc(32, 7), seedPasswords: { standard: "standard-password", admin: "admin-password" },
  });
  token = (await connectDemoUser(gateway.url)).token;
});

afterAll(async () => {
  await gateway?.close();
  await gitlab?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("a client discovers and calls a GitLab tool through the gateway", async () => {
  const client = new Client(
    { name: "gateway-e2e-test", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );

  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }));
    expect(client.getProtocolEra()).toBe("modern");

    const { tools } = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "gitlab__list_issues",
      description: "List issues in the mock GitLab project.",
      inputSchema: {
        type: "object",
        properties: { projectPath: { type: "string" } },
        required: ["projectPath"],
      },
    });

    const result = await client.callTool({
      name: "gitlab__list_issues",
      arguments: { projectPath: "team/demo" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "standard: #101 Fix login\n#102 Update docs" },
    ]);
  } finally {
    await client.close();
  }
});
