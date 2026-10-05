import { randomUUID } from "node:crypto";
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import type { Tool } from "@modelcontextprotocol/server";
import { AuditLog, type CallOutcome, type CallRecord } from "./audit-log.js";
import { GatewayStore, type UserId } from "./gateway-store.js";
import type { IntegrationRuntime } from "./integration-catalog.js";
import { makeClient } from "./mcp-client.js";

type Rejection = {
  userId: UserId;
  exposedTool: string;
  integrationId: string;
  downstreamTool: string;
  requestId: string | number | undefined;
  reason: "denied" | "invalid_arguments";
};

function failureOutcome(error: unknown): CallOutcome {
  if (error instanceof SdkError && error.code === SdkErrorCode.RequestTimeout) return "timeout";
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) return "timeout";
  if (error instanceof TypeError) return "unavailable";
  return "protocol_failure";
}

export class ToolCallOutcomes {
  constructor(
    private readonly audit: AuditLog,
    private readonly store: GatewayStore,
    private readonly downstreamTimeoutMs: number,
  ) {}

  private async record(
    target: Pick<CallRecord, "userId" | "integrationId" | "exposedTool" | "downstreamTool">,
    correlationId: string,
    started: number | undefined,
    outcome: CallOutcome,
  ) {
    await this.audit.record({
      userId: target.userId,
      integrationId: target.integrationId,
      exposedTool: target.exposedTool,
      downstreamTool: target.downstreamTool,
      correlationId, at: new Date().toISOString(),
      durationMs: started === undefined ? 0 : Math.round(performance.now() - started), outcome,
    });
  }

  async reject(rejection: Rejection) {
    const correlationId = randomUUID();
    await this.record(rejection, correlationId, undefined, rejection.reason);
    const invalidArguments = rejection.reason === "invalid_arguments";
    return {
      jsonrpc: "2.0" as const,
      id: rejection.requestId,
      error: {
        code: invalidArguments ? -32602 : -32001,
        message: `${invalidArguments ? "Invalid tool arguments" : "Tool unavailable"} (trace ${correlationId})`,
      },
    };
  }

  async execute(userId: UserId, integration: IntegrationRuntime, tool: Tool, args: Record<string, unknown>) {
    const { config } = integration;
    const exposedTool = `${config.id}__${tool.name}`;
    const target = { userId, integrationId: config.id, exposedTool, downstreamTool: tool.name };
    const correlationId = randomUUID();
    const started = performance.now();
    const failure = async (outcome: CallOutcome) => {
      await this.record(target, correlationId, started, outcome);
      return {
        isError: true,
        content: [{ type: "text" as const, text: `${outcome.replaceAll("_", " ")} (trace ${correlationId})` }],
        _meta: { "gateway/correlationId": correlationId, "gateway/outcome": outcome },
      };
    };

    if (integration.status === "unavailable") return failure("unavailable");
    const credential = this.store.getCredential(userId, config.id);
    if (!credential) return failure("denied");
    const { client, transport } = makeClient(`gateway-call-${config.id}`, config.url, credential);
    try {
      await client.connect(transport, { timeout: this.downstreamTimeoutMs });
      const result = await client.callTool(
        { name: tool.name, arguments: args },
        { timeout: this.downstreamTimeoutMs },
      );
      const outcome = result.isError ? "tool_error" : "success";
      await this.record(target, correlationId, started, outcome);
      return { ...result, _meta: { ...result._meta, "gateway/correlationId": correlationId, "gateway/outcome": outcome } };
    } catch (error) {
      return await failure(failureOutcome(error));
    } finally {
      await client.close();
    }
  }
}
