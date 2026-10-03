import { afterAll, beforeAll, expect, test } from "vitest";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { startGitLabServer } from "../src/gitlab-server.js";
import { startGatewayServer } from "../src/gateway-server.js";

let gitlab: Awaited<ReturnType<typeof startGitLabServer>>;
let gateway: Awaited<ReturnType<typeof startGatewayServer>>;

beforeAll(async () => {
  gitlab = await startGitLabServer({ port: 0 });
  gateway = await startGatewayServer({ port: 0, gitlabUrl: gitlab.url });
});

afterAll(async () => {
  await gateway?.close();
  await gitlab?.close();
});

test("a client discovers and calls a GitLab tool through the gateway", async () => {
  const client = new Client(
    { name: "gateway-e2e-test", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );

  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
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
      { type: "text", text: "#101 Fix login\n#102 Update docs" },
    ]);
  } finally {
    await client.close();
  }
});
