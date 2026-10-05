import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export function makeClient(name: string, url: string, token?: string) {
  const client = new Client(
    { name, version: "0.1.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(url), token ? {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  } : undefined);
  return { client, transport };
}
