import { mkdtemp, readFile, rm } from "node:fs/promises";
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
  directory = await mkdtemp(join(tmpdir(), "mcp-gateway-audit-"));
  gitlab = await startGitLabServer({ port: 0 });
  gitlabPort = Number(new URL(gitlab.url).port);
  gateway = await startGatewayServer({
    port: 0, gitlabUrl: gitlab.url, stateFile: join(directory, "state.json"),
    encryptionKey: Buffer.alloc(32, 7), seedPasswords: { standard: "standard-password", admin: "admin-password" },
    downstreamTimeoutMs: 100,
  });
});

afterAll(async () => {
  await gateway?.close();
  await gitlab?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("calls expose correlation IDs and audit distinct outcomes without secrets", async () => {
  const identity = await connectDemoUser(gateway.url, { gitlab: "gl-standard" }, ["gitlab__list_issues"]);
  const client = new Client(
    { name: "audit-test", version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url), {
    requestInit: { headers: { Authorization: `Bearer ${identity.token}` } },
  }));

  const call = (projectPath: string) => client.callTool({ name: "gitlab__list_issues", arguments: { projectPath } });
  const records = async () => {
    const response = await fetch(new URL("/api/calls", gateway.url), { headers: { Cookie: identity.cookie } });
    expect(response.status).toBe(200);
    return (await response.json() as { calls: Array<{ outcome: string; correlationId: string; userId: string }> }).calls;
  };

  try {
    const success = await call("team/demo");
    expect(success.isError).not.toBe(true);
    const successId = success._meta?.["gateway/correlationId"];
    expect(typeof successId).toBe("string");

    const toolError = await call("tool-error");
    expect(toolError.isError).toBe(true);
    expect(toolError._meta?.["gateway/outcome"]).toBe("tool_error");

    const timeout = await call("slow");
    expect(timeout.isError).toBe(true);
    expect(timeout._meta?.["gateway/outcome"]).toBe("timeout");

    await expect(client.callTool({
      name: "gitlab__create_issue", arguments: { projectPath: "team/demo", title: "Secret argument" },
    })).rejects.toThrow();

    await gitlab.close();
    await fetch(new URL("/api/integrations/gitlab/refresh", gateway.url), {
      method: "POST", headers: { Cookie: identity.cookie },
    });
    const unavailable = await call("team/demo");
    expect(unavailable.isError).toBe(true);
    expect(unavailable._meta?.["gateway/outcome"]).toBe("unavailable");

    gitlab = await startGitLabServer({ port: gitlabPort, variant: "protocol_failure" });
    await fetch(new URL("/api/integrations/gitlab/refresh", gateway.url), {
      method: "POST", headers: { Cookie: identity.cookie },
    });
    const protocolFailure = await call("team/demo");
    expect(protocolFailure.isError).toBe(true);
    expect(protocolFailure._meta?.["gateway/outcome"]).toBe("protocol_failure");

    const calls = await records();
    expect(calls.map((record) => record.outcome)).toEqual([
      "success", "tool_error", "timeout", "denied", "unavailable", "protocol_failure",
    ]);
    expect(calls[0]).toMatchObject({ userId: "standard", correlationId: successId });
    const auditText = await readFile(join(directory, "state.json.audit.jsonl"), "utf8");
    expect(auditText).not.toContain("gl-standard");
    expect(auditText).not.toContain(identity.token);
    expect(auditText).not.toContain("Secret argument");
  } finally {
    await client.close();
  }
});
