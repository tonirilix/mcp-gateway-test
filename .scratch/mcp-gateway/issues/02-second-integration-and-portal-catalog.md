# 02: Second integration and portal catalog

**What to build:** A learner can see GitLab and Analytics together in a modest portal catalog, then use the test client to discover and call a tool from each application through the same gateway endpoint. The two downstream catalogs come from real MCP discovery.

**Blocked by:** 01: First real gateway tool call.

**Status:** resolved

- [x] The portal lists both integrations, their discovered tools, descriptions, input schemas, and curated read/write labels.
- [x] Namespaced tool names remain unambiguous even when two downstream servers use the same original tool name.
- [x] The test client calls one tool from each integration through the gateway and receives the corresponding downstream result.
- [x] The gateway routes from its discovered mapping and fixed integration configuration; a tool name cannot select an arbitrary destination.
