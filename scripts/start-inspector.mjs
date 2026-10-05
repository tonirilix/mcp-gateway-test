import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const catalogPath = resolve(".data/inspector-catalog.json");
const gatewayUrl = process.env.GATEWAY_MCP_URL ??
  `http://127.0.0.1:${process.env.GATEWAY_PORT ?? 4100}/mcp`;

await mkdir(resolve(".data"), { recursive: true });
try {
  await writeFile(catalogPath, JSON.stringify({
    mcpServers: {
      "local-gateway": { type: "http", url: gatewayUrl, protocolEra: "modern" },
    },
  }, null, 2), { flag: "wx", mode: 0o600 });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}

const inspector = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["--yes", "@modelcontextprotocol/inspector@2", "--catalog", catalogPath],
  { stdio: "inherit" },
);
inspector.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
inspector.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
