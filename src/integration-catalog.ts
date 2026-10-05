import { createHash } from "node:crypto";
import type { Tool } from "@modelcontextprotocol/server";
import { GatewayStore } from "./gateway-store.js";
import { makeClient } from "./mcp-client.js";
import { policyFor } from "./effective-tools.js";

export type IntegrationConfig = { id: string; name: string; url: string };
export type IntegrationRuntime = {
  config: IntegrationConfig;
  tools: Tool[];
  status: "available" | "unavailable";
  capturedAt?: string;
};

export class IntegrationCatalog {
  private readonly integrations: IntegrationRuntime[];

  private constructor(configs: IntegrationConfig[], private readonly store: GatewayStore) {
    this.integrations = configs.map((config) => {
      const cached = store.getCatalog(config.id);
      return { config, tools: cached?.tools ?? [], status: "unavailable", capturedAt: cached?.capturedAt };
    });
  }

  static async open(configs: IntegrationConfig[], store: GatewayStore) {
    const catalog = new IntegrationCatalog(configs, store);
    for (const integration of catalog.integrations) await catalog.refresh(integration.config.id);
    return catalog;
  }

  all(): readonly IntegrationRuntime[] {
    return this.integrations;
  }

  find(id: string) {
    return this.integrations.find(({ config }) => config.id === id);
  }

  async refresh(id: string) {
    const integration = this.find(id);
    if (!integration) return undefined;
    const { config } = integration;
    const { client, transport } = makeClient(`gateway-discovery-${config.id}`, config.url);
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      const fingerprints = Object.fromEntries(tools.map((tool) => [
        `${config.id}__${tool.name}`,
        createHash("sha256").update(JSON.stringify({
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          policy: policyFor(config.id, tool.name),
        })).digest("hex"),
      ]));
      const previous = this.store.getCatalog(config.id)?.fingerprints ?? {};
      const invalidatedNames = Object.keys({ ...previous, ...fingerprints })
        .filter((name) => previous[name] !== fingerprints[name]);
      await this.store.replaceCatalog(config.id, tools, fingerprints, invalidatedNames);
      integration.tools = tools;
      integration.status = "available";
      integration.capturedAt = this.store.getCatalog(config.id)?.capturedAt;
    } catch {
      integration.status = "unavailable";
    } finally {
      await client.close();
    }
    return integration.status;
  }
}
