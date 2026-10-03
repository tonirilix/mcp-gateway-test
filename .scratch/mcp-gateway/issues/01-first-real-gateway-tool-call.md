# 01: First real gateway tool call

**What to build:** A learner can start a fictional GitLab MCP server and the gateway locally, use the small MCP test client to discover one GitLab tool through the gateway, and call it successfully. The client talks only to the gateway; both sides of the gateway use real MCP interactions.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] The test client connects to the gateway's single HTTP MCP endpoint using the chosen protocol revision and lists a GitLab tool discovered from the downstream MCP server.
- [x] The exposed tool has a stable application-prefixed name and preserves its useful description and input schema.
- [x] Calling the exposed tool returns the mock GitLab result through the gateway, with an end-to-end check that exercises the public MCP endpoint.
- [x] A documented local run starts the processes needed for this slice and shows the successful call.
