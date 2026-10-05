import type { Tool } from "@modelcontextprotocol/server";
import { GatewayStore, type UserId } from "./gateway-store.js";

type Integration = { config: { id: string }; tools: Tool[] };
type ToolPolicy = { behavior: "read" | "write"; adminOnly: boolean };

const policies: Record<string, ToolPolicy> = {
  gitlab__list_issues: { behavior: "read", adminOnly: false },
  gitlab__get_project: { behavior: "read", adminOnly: false },
  gitlab__create_issue: { behavior: "write", adminOnly: false },
  gitlab__delete_issue: { behavior: "write", adminOnly: false },
  analytics__list_issues: { behavior: "read", adminOnly: false },
  analytics__list_users: { behavior: "read", adminOnly: false },
  analytics__create_user: { behavior: "write", adminOnly: true },
  analytics__deactivate_user: { behavior: "write", adminOnly: true },
};

export function policyFor(integrationId: string, toolName: string) {
  return policies[`${integrationId}__${toolName}`];
}

export class EffectiveTools<T extends Integration> {
  constructor(private readonly integrations: T[], private readonly store: GatewayStore) {}

  private assess(userId: UserId, integration: T, tool: Tool) {
    const exposedName = `${integration.config.id}__${tool.name}`;
    const policy = policyFor(integration.config.id, tool.name);
    const eligible = Boolean(policy && (!policy.adminOnly || userId === "admin"));
    const connected = this.store.hasCredential(userId, integration.config.id);
    const enabled = this.store.isEnabled(userId, exposedName);
    return {
      integration, tool, exposedName, policy, eligible, connected, enabled,
      effective: eligible && connected && enabled,
    };
  }

  resolve(userId: UserId, name: string) {
    for (const integration of this.integrations) {
      const tool = integration.tools.find((candidate) => `${integration.config.id}__${candidate.name}` === name);
      if (tool) return this.assess(userId, integration, tool);
    }
    return undefined;
  }

  forUser(userId: UserId) {
    return this.integrations.flatMap((integration) =>
      integration.tools.map((tool) => this.assess(userId, integration, tool)).filter((item) => item.effective),
    );
  }

  catalogFor(userId: UserId, integration: T) {
    return integration.tools.map((tool) => {
      const decision = this.assess(userId, integration, tool);
      return {
        name: decision.exposedName,
        originalName: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        behavior: decision.policy?.behavior ?? "unclassified",
        adminOnly: decision.policy?.adminOnly ?? false,
        eligible: decision.eligible,
        enabled: decision.enabled,
      };
    });
  }
}
