import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const gatewayUrl = process.env.GATEWAY_MCP_URL ?? "http://127.0.0.1:4100/mcp";
const gatewayToken = process.env.GATEWAY_TOKEN;
if (!gatewayToken) throw new Error("Set GATEWAY_TOKEN to the token created in the portal");
const toolName = process.argv[2] ?? "gitlab__list_issues";
const rawArguments = process.argv[3] ?? '{"projectPath":"team/demo"}';
const toolArguments = JSON.parse(rawArguments) as Record<string, unknown>;
const client = new Client(
  { name: "gateway-demo-client", version: "0.1.0" },
  { versionNegotiation: { mode: { pin: "2026-07-28" } } },
);

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(gatewayUrl), {
    requestInit: { headers: { Authorization: `Bearer ${gatewayToken}` } },
  }));
  const { tools } = await client.listTools();
  console.log(`Discovered tools: ${tools.map((tool) => tool.name).join(", ")}`);

  const result = await client.callTool({
    name: toolName,
    arguments: toolArguments,
  });
  if (result.isError) {
    throw new Error(`Tool failed: ${JSON.stringify(result.content)}`);
  }
  console.log(JSON.stringify({ content: result.content, metadata: result._meta }, null, 2));
} finally {
  await client.close();
}
