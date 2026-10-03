import { startAnalyticsServer } from "./analytics-server.js";

const port = Number(process.env.ANALYTICS_PORT ?? 4102);
const server = await startAnalyticsServer({ port });
console.log(`Mock Analytics MCP server listening at ${server.url}`);
