import "dotenv/config";
import { startGatewayServer } from "./gateway-server.js";
import { localGatewaySettings } from "./local-config.js";

const gitlabUrl = process.env.GITLAB_MCP_URL ?? "http://127.0.0.1:4101/mcp";
const analyticsUrl = process.env.ANALYTICS_MCP_URL ?? "http://127.0.0.1:4102/mcp";
const server = await startGatewayServer({
  ...localGatewaySettings(),
  gitlabUrl,
  analyticsUrl,
});
console.log(`MCP gateway listening at ${server.url}`);
