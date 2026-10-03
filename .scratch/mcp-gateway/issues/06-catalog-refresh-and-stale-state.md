# 06: Catalog refresh and stale state

**What to build:** A portal user can refresh downstream tool discovery and see whether a catalog is current. New or materially changed tools require fresh opt-in, while an unavailable server leaves a clearly marked last-known catalog for explanation and diagnosis.

**Blocked by:** 04: Per-user tool opt-in.

**Status:** ready-for-agent

- [ ] Refresh uses downstream MCP discovery and updates the portal catalog and gateway routing map.
- [ ] A newly discovered tool begins disabled for every user, and a tool removed by a successful refresh disappears from effective MCP lists.
- [ ] A materially changed definition or curated behavior classification invalidates prior opt-in until the user enables that version of the tool.
- [ ] When a downstream server cannot be refreshed, the portal shows its last-known tools as stale with an unavailable status.
- [ ] A call to a previously listed tool on an unavailable server fails within a bounded time; an end-to-end check demonstrates the stale state and failure.
