import { startGatewayServer } from "./gateway-server.js";

const port = Number(process.env.GATEWAY_PORT ?? 4100);
const gitlabUrl = process.env.GITLAB_MCP_URL ?? "http://127.0.0.1:4101/mcp";
const analyticsUrl = process.env.ANALYTICS_MCP_URL ?? "http://127.0.0.1:4102/mcp";
const server = await startGatewayServer({ port, gitlabUrl, analyticsUrl });
console.log(`MCP gateway listening at ${server.url}`);
