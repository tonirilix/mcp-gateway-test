# MCP Gateway

The gateway presents tools from trusted downstream MCP integrations to individual users.

## Language

**Integration**:
A trusted downstream MCP server whose tools the gateway can discover and route to.

**Discovered tool**:
A tool reported by an integration during discovery, before gateway policy and a user's choices are applied.

**Catalog snapshot**:
The last successfully discovered tool definitions for an integration. It remains visible as stale when the integration is unavailable.

**Effective tool**:
A discovered tool that a user is eligible to use, has opted into, and has a credential for. The user's MCP tool list contains only effective tools.

**Opt-in**:
A user's choice to enable a specific eligible tool. It can be recorded before the user connects the integration and does not by itself make the tool effective.

**Call outcome**:
The gateway's classification of an attempted tool call, including preflight rejections, downstream tool errors, transport failures, and success. Each recorded outcome has a correlation ID visible to the caller.
