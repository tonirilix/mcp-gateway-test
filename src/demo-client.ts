import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const gatewayUrl = process.env.GATEWAY_MCP_URL ?? "http://127.0.0.1:4100/mcp";
const client = new Client(
  { name: "gateway-demo-client", version: "0.1.0" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(gatewayUrl)));
  const { tools } = await client.listTools();
  console.log(`Discovered tools: ${tools.map((tool) => tool.name).join(", ")}`);

  const result = await client.callTool({
    name: "gitlab__list_issues",
    arguments: { projectPath: "team/demo" },
  });
  if (result.isError) {
    throw new Error(`Tool failed: ${JSON.stringify(result.content)}`);
  }
  console.log(JSON.stringify(result.content, null, 2));
} finally {
  await client.close();
}
