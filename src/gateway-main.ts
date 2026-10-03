import "dotenv/config";
import { startGatewayServer } from "./gateway-server.js";

const port = Number(process.env.GATEWAY_PORT ?? 4100);
const gitlabUrl = process.env.GITLAB_MCP_URL ?? "http://127.0.0.1:4101/mcp";
const analyticsUrl = process.env.ANALYTICS_MCP_URL ?? "http://127.0.0.1:4102/mcp";
const key = process.env.GATEWAY_ENCRYPTION_KEY;
const standardPassword = process.env.STANDARD_PASSWORD;
const adminPassword = process.env.ADMIN_PASSWORD;
if (!key || !standardPassword || !adminPassword) {
  throw new Error("Set GATEWAY_ENCRYPTION_KEY, STANDARD_PASSWORD, and ADMIN_PASSWORD in .env");
}
const server = await startGatewayServer({
  port,
  gitlabUrl,
  analyticsUrl,
  stateFile: process.env.GATEWAY_STATE_FILE ?? ".data/gateway-state.json",
  encryptionKey: Buffer.from(key, "base64"),
  seedPasswords: { standard: standardPassword, admin: adminPassword },
});
console.log(`MCP gateway listening at ${server.url}`);
